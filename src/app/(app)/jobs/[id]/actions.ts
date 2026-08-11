"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { recordAudit } from "@/lib/audit";
import { syncJobInBackground } from "@/lib/calendar/sync";
import { clockAuthority, judgeClockEdit } from "@/lib/clock-limits";
import { getCompanySettings } from "@/lib/company";
import { parseDatetimeLocalInZone, roundToInterval } from "@/lib/datetime";
import { db } from "@/lib/db";
import { deliverableLabel, resolveDeliverableRules } from "@/lib/deliverables";
import { flag, optionalText } from "@/lib/form";
import {
  jobRuleSheet,
  removeJobCustomRule,
  saveJobRule,
} from "@/lib/job-deliverables";
import { isJobField, JOB_FIELDS, type JobFieldName } from "@/lib/job-fields";
import { resolvePayRate } from "@/lib/pay-rates";
import { notify } from "@/lib/notifications";
import { canOnJob, resolveJobSupervisor } from "@/lib/scope";
import { getSessionUser, permissionScope, type SessionUser } from "@/lib/session";
import { adjustmentMinutes } from "@/lib/time-tracking";
import {
  ContactType,
  DeliverableCategory,
  JobOutcome,
  PayType as JobPayType,
  type Prisma,
} from "@prisma-client";

export type ActionResult = { ok: true } | { ok: false; error: string };

const ok: ActionResult = { ok: true };
const fail = (error: string): ActionResult => ({ ok: false, error });

type JobContext = {
  user: SessionUser;
  job: {
    id: string;
    projectId: string | null;
    createdById: string;
    breakPaid: boolean;
    lifecycle: string;
    assigneeIds: string[];
    /**
     * Whether the caller is leading this job.
     *
     * The lead is on site and answerable for what it records, so several
     * decisions that are otherwise a supervisor's are theirs too.
     */
    isLead: boolean;
    /** The site's zone: what a planner means when they type a time. */
    timeZone: string;
  };
};

/** Loads the job plus the caller, with just enough to answer permission checks. */
async function loadContext(jobId: string): Promise<JobContext | null> {
  const user = await getSessionUser();
  if (!user) return null;

  const job = await db.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      projectId: true,
      createdById: true,
      breakPaid: true,
      lifecycle: true,
      site: { select: { timeZone: true } },
      assignments: { select: { userId: true, isLead: true } },
    },
  });
  if (!job) return null;

  const company = await getCompanySettings();

  return {
    user,
    job: {
      id: job.id,
      projectId: job.projectId,
      createdById: job.createdById,
      breakPaid: job.breakPaid,
      lifecycle: job.lifecycle,
      assigneeIds: job.assignments.map((assignment) => assignment.userId),
      isLead: job.assignments.some(
        (assignment) => assignment.userId === user.id && assignment.isLead,
      ),
      timeZone: job.site.timeZone ?? company.defaultTimeZone,
    },
  };
}

function touch(jobId: string) {
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/jobs");
}

// ---------------------------------------------------------------------------
// Time clock
// ---------------------------------------------------------------------------

/**
 * Works out the instant to record, snapping to the company interval and
 * refusing an adjustment larger than a tech is allowed to make for themselves.
 * Supervisors and above are uncapped — they are the ones who fix mistakes.
 */
async function resolveClockTime(
  user: SessionUser,
  requestedIso: string | null,
): Promise<{ at: Date; source: "NOW" | "ADJUSTED"; raw: Date } | { error: string }> {
  const company = await getCompanySettings();
  const now = new Date();

  if (!requestedIso) {
    return {
      at: roundToInterval(now, company.timeRoundingMinutes),
      source: "NOW",
      raw: now,
    };
  }

  const requested = new Date(requestedIso);
  if (Number.isNaN(requested.getTime())) return { error: "Invalid time." };

  const snapped = roundToInterval(requested, company.timeRoundingMinutes);
  const scope = permissionScope(user, "job.adjust_time");
  if (!scope) return { error: "You cannot adjust clock times." };

  if (scope === "OWN") {
    const drift = adjustmentMinutes(snapped, now);
    if (drift > company.techTimeAdjustLimit) {
      return {
        error: `You can only shift your own clock by ${company.techTimeAdjustLimit} minutes. Ask a supervisor for anything further.`,
      };
    }
  }

  return { at: snapped, source: "ADJUSTED", raw: now };
}

export async function clockIn(formData: FormData): Promise<ActionResult> {
  const jobId = String(formData.get("jobId") ?? "");
  const context = await loadContext(jobId);
  if (!context) return fail("Job not found.");

  const { user, job } = context;
  if (!(await canOnJob(user, "job.clock_in", job))) {
    return fail("You cannot clock in on this job.");
  }

  const assignment = await db.jobAssignment.findUnique({
    where: { jobId_userId: { jobId, userId: user.id } },
    select: { id: true },
  });
  if (!assignment) return fail("You are not assigned to this job.");

  const open = await db.visit.findFirst({
    where: { assignmentId: assignment.id, clockOutAt: null },
    select: { id: true },
  });
  if (open) return fail("You are already clocked in.");

  const resolved = await resolveClockTime(
    user,
    (formData.get("at") as string) || null,
  );
  if ("error" in resolved) return fail(resolved.error);

  await db.$transaction(async (tx) => {
    await tx.visit.create({
      data: {
        assignmentId: assignment.id,
        clockInAt: resolved.at,
        clockInSource: resolved.source,
        clockInRawAt: resolved.raw,
      },
    });

    // A job someone is standing on is in progress, whatever it said before.
    await tx.job.update({
      where: { id: jobId },
      data: { lifecycle: "IN_PROGRESS" },
    });
  });

  // The event has been sitting on the planned time; it now knows when the day
  // actually started, which is what a supervisor's day view is for.
  syncJobInBackground(jobId);

  await recordAudit({
    actorId: user.id,
    entityType: "Visit",
    entityId: assignment.id,
    jobId,
    action: "clock_in",
    detail: { at: resolved.at.toISOString(), source: resolved.source },
  });

  touch(jobId);
  return ok;
}

export async function clockOut(formData: FormData): Promise<ActionResult> {
  return performClockOut(
    String(formData.get("jobId") ?? ""),
    (formData.get("at") as string) || null,
  );
}

/**
 * Shared by the plain Clock out button and by the last step of the guided
 * checkout, so both end up writing the visit the same way.
 */
async function performClockOut(
  jobId: string,
  requestedIso: string | null,
): Promise<ActionResult> {
  const context = await loadContext(jobId);
  if (!context) return fail("Job not found.");

  const { user, job } = context;
  if (!(await canOnJob(user, "job.clock_in", job))) {
    return fail("You cannot clock out on this job.");
  }

  const assignment = await db.jobAssignment.findUnique({
    where: { jobId_userId: { jobId, userId: user.id } },
    select: { id: true },
  });
  if (!assignment) return fail("You are not assigned to this job.");

  const visit = await db.visit.findFirst({
    where: { assignmentId: assignment.id, clockOutAt: null },
    orderBy: { clockInAt: "desc" },
    select: { id: true, clockInAt: true, breaks: { where: { endAt: null } } },
  });
  if (!visit) return fail("You are not clocked in.");

  const resolved = await resolveClockTime(user, requestedIso);
  if ("error" in resolved) return fail(resolved.error);

  if (resolved.at.getTime() <= visit.clockInAt.getTime()) {
    return fail("Clock-out has to be after clock-in.");
  }

  await db.$transaction(async (tx) => {
    // A break left running would otherwise keep accruing past the visit and
    // quietly eat into the tech's paid time.
    for (const entry of visit.breaks) {
      await tx.breakPeriod.update({
        where: { id: entry.id },
        data: { endAt: resolved.at },
      });
    }

    await tx.visit.update({
      where: { id: visit.id },
      data: {
        clockOutAt: resolved.at,
        clockOutSource: resolved.source,
        clockOutRawAt: resolved.raw,
      },
    });

    const stillOpen = await tx.visit.count({
      where: { assignment: { jobId }, clockOutAt: null },
    });

    if (stillOpen === 0) {
      await tx.job.update({
        where: { id: jobId },
        data: { lifecycle: "PENDING_REVIEW" },
      });
    }
  });

  await recordAudit({
    actorId: user.id,
    entityType: "Visit",
    entityId: visit.id,
    jobId,
    action: "clock_out",
    detail: { at: resolved.at.toISOString(), source: resolved.source },
  });

  // The event has been running on the estimate until now; this is the moment
  // it can tell the truth about the day.
  syncJobInBackground(jobId);
  touch(jobId);
  return ok;
}

const checkoutSchema = z.object({
  jobId: z.string().min(1),
  outcome: z.enum(JobOutcome),
  releaseCode: z.string().trim().max(120).optional(),
  noReleaseCode: z.string().optional(),
  at: z.string().optional(),
});

/**
 * Final step of the guided checkout.
 *
 * Everything the wizard collected along the way — signatures, contacts,
 * deliverables — was already saved as it was captured, so a tech who loses
 * signal halfway does not have to start again. This commits only the outcome,
 * the release code and the clock-out itself, and refuses to close a job that
 * is still missing a required sign-off unless someone with the override says
 * so.
 */
export async function completeCheckout(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = checkoutSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(z.prettifyError(parsed.error));

  const { jobId, outcome, releaseCode, at } = parsed.data;
  const noReleaseCode = parsed.data.noReleaseCode === "true";

  const context = await loadContext(jobId);
  if (!context) return fail("Job not found.");
  const { user, job } = context;

  if (!(await canOnJob(user, "job.set_outcome_status", job))) {
    return fail("You cannot set the outcome on this job.");
  }

  if (!noReleaseCode && !releaseCode) {
    return fail(
      "Enter the release code, or confirm there isn't one with No release code.",
    );
  }

  const missing = await missingRequiredDeliverables(jobId);
  if (missing.length > 0) {
    const canOverride = await canOnJob(user, "job.override_missing_signoff", job);
    if (!canOverride) {
      return fail(
        `Still missing: ${missing.join(", ")}. A manager has to approve closing without these.`,
      );
    }
  }

  await db.job.update({
    where: { id: jobId },
    data: {
      outcome,
      releaseCode: noReleaseCode ? null : (releaseCode ?? null),
      noReleaseCode,
    },
  });

  await recordAudit({
    actorId: user.id,
    entityType: "Job",
    entityId: jobId,
    jobId,
    action: "checkout_completed",
    detail: {
      outcome,
      noReleaseCode,
      overrodeMissing: missing.length > 0 ? missing.join(", ") : null,
    },
  });

  return performClockOut(jobId, at || null);
}

/**
 * Required deliverable sections with nothing in them. Job-level rules win over
 * the project's, matching what the job page shows.
 */
export async function missingRequiredDeliverables(
  jobId: string,
): Promise<string[]> {
  const job = await db.job.findUnique({
    where: { id: jobId },
    select: {
      deliverableRules: {
        where: { projectId: null },
        select: {
          category: true,
          customLabel: true,
          enabled: true,
          required: true,
          requiresPhoto: true,
          requiresText: true,
          order: true,
        },
      },
      project: {
        select: {
          deliverableRules: {
            where: { jobId: null },
            select: {
              category: true,
              customLabel: true,
              enabled: true,
              required: true,
              requiresPhoto: true,
              requiresText: true,
              order: true,
            },
          },
        },
      },
      deliverables: { select: { category: true } },
    },
  });
  if (!job) return [];

  const rules = resolveDeliverableRules(
    job.deliverableRules,
    job.project?.deliverableRules ?? [],
  );
  const present = new Set(job.deliverables.map((item) => item.category));

  return rules
    .filter((rule) => rule.required && !present.has(rule.category))
    .map((rule) => deliverableLabel(rule.category, rule.customLabel));
}

export async function toggleBreak(formData: FormData): Promise<ActionResult> {
  const jobId = String(formData.get("jobId") ?? "");
  const context = await loadContext(jobId);
  if (!context) return fail("Job not found.");

  const { user, job } = context;
  if (!(await canOnJob(user, "job.clock_in", job))) {
    return fail("You cannot record breaks on this job.");
  }

  const assignment = await db.jobAssignment.findUnique({
    where: { jobId_userId: { jobId, userId: user.id } },
    select: { id: true },
  });
  if (!assignment) return fail("You are not assigned to this job.");

  const visit = await db.visit.findFirst({
    where: { assignmentId: assignment.id, clockOutAt: null },
    orderBy: { clockInAt: "desc" },
    select: { id: true, breaks: { where: { endAt: null }, select: { id: true } } },
  });
  if (!visit) return fail("Clock in before taking a break.");

  const now = new Date();
  const running = visit.breaks[0];

  if (running) {
    await db.breakPeriod.update({
      where: { id: running.id },
      data: { endAt: now },
    });
  } else {
    await db.breakPeriod.create({
      data: {
        visitId: visit.id,
        startAt: now,
        // Whether a break is paid is a property of the job, decided when it was
        // planned — never something the tech picks in the moment.
        paid: job.breakPaid,
      },
    });
  }

  await recordAudit({
    actorId: user.id,
    entityType: "BreakPeriod",
    entityId: visit.id,
    jobId,
    action: running ? "break_end" : "break_start",
    detail: { paid: job.breakPaid },
  });

  touch(jobId);
  return ok;
}

// ---------------------------------------------------------------------------
// Field editing
// ---------------------------------------------------------------------------

function coerceField(
  field: JobFieldName,
  raw: string,
  timeZone: string,
): { value: Prisma.JobUpdateInput[JobFieldName] } | { error: string } {
  const trimmed = raw.trim();
  const kind = JOB_FIELDS[field].kind;

  if (kind === "number") {
    if (trimmed === "") return { value: null };
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return { error: `${JOB_FIELDS[field].label} must be a positive number.` };
    }
    return { value: Math.round(parsed) };
  }

  if (kind === "datetime") {
    if (trimmed === "") return { value: null };
    // The input holds site-local time, which is what the planner typed and
    // what the page rendered. Reading it as anything else moves the job.
    const parsed = parseDatetimeLocalInZone(trimmed, timeZone);
    if (!parsed) {
      return { error: `${JOB_FIELDS[field].label} is not a valid date.` };
    }
    return { value: parsed };
  }

  return { value: trimmed === "" ? null : trimmed };
}

export async function saveJobField(formData: FormData): Promise<ActionResult> {
  const jobId = String(formData.get("jobId") ?? "");
  const field = String(formData.get("field") ?? "");
  if (!isJobField(field)) return fail("Unknown field.");

  const context = await loadContext(jobId);
  if (!context) return fail("Job not found.");
  const { user, job } = context;

  const current = await db.job.findUnique({
    where: { id: jobId },
    select: { [field]: true } as Record<string, true>,
  });
  const previous = (current as Record<string, unknown> | null)?.[field] ?? null;
  const isEmpty = previous === null || previous === "";

  const meta = JOB_FIELDS[field];
  const canEditPlanned = await canOnJob(user, "job.edit_planned_fields", job);
  const canFill = await canOnJob(user, "job.fill_missing_field", job);

  if (meta.planned && !isEmpty && !canEditPlanned) {
    return fail(
      "This field is already set. Use Suggest change so a supervisor can approve it.",
    );
  }
  if (!canEditPlanned && !canFill) {
    return fail("You cannot change this field.");
  }

  const coerced = coerceField(
    field,
    String(formData.get("value") ?? ""),
    job.timeZone,
  );
  if ("error" in coerced) return fail(coerced.error);

  await db.job.update({
    where: { id: jobId },
    data: { [field]: coerced.value } as Prisma.JobUpdateInput,
  });

  await recordAudit({
    actorId: user.id,
    entityType: "Job",
    entityId: jobId,
    jobId,
    // Distinguished in the timeline because filling a gap on site and
    // overruling a planner are different acts.
    action: isEmpty ? "field_filled" : "field_edited",
    detail: {
      field,
      from: previous === null ? null : String(previous),
      to: coerced.value === null ? null : String(coerced.value),
    },
  });

  // When the job moves, the crew's calendars have to move with it.
  if (field === "scheduledStart" || field === "estimateMinutes") {
    syncJobInBackground(jobId);
  }

  touch(jobId);
  return ok;
}

// ---------------------------------------------------------------------------
// Crew
// ---------------------------------------------------------------------------

/**
 * Adds a tech to a job that is already running.
 *
 * The rate is resolved the same way it is at creation, so a tech pulled in
 * halfway through is paid by the same rules as the one who was planned in —
 * and the rate is a copy, so re-rating a project later cannot rewrite work
 * that has already happened.
 */
export async function assignTech(formData: FormData): Promise<ActionResult> {
  const jobId = String(formData.get("jobId") ?? "");
  const userId = String(formData.get("userId") ?? "");

  const context = await loadContext(jobId);
  if (!context) return fail("Job not found.");
  const { user, job } = context;

  if (!(await canOnJob(user, "job.assign", job))) {
    return fail("You cannot assign techs to this job.");
  }
  if (job.assigneeIds.includes(userId)) return fail("Already on this job.");

  const person = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, active: true },
  });
  if (!person || !person.active) return fail("That person is not available.");

  const details = await db.job.findUniqueOrThrow({
    where: { id: jobId },
    select: {
      clientId: true,
      projectId: true,
      payType: true,
      payRate: true,
      travelReimbursement: true,
      project: { select: { travelReimbursement: true } },
    },
  });

  const resolved = await resolvePayRate(userId, details.projectId, details.clientId);
  const supervisorId = await resolveJobSupervisor(userId, details.projectId);

  // A rate set on the job is a decision about the work, so it applies to
  // whoever is on it — including somebody added afterwards. Reading it from
  // the job rather than from the assignments that happened to exist when it
  // was set is the difference between that working and only appearing to.
  const rate = details.payType
    ? {
        payType: details.payType,
        rate: details.payRate?.toString() ?? "0",
        travelReimbursement: details.travelReimbursement?.toString() ?? null,
        source: "job" as const,
      }
    : resolved;

  await db.jobAssignment.create({
    data: {
      jobId,
      userId,
      supervisorId,
      // The lead is set deliberately, never by arriving second.
      isLead: job.assigneeIds.length === 0,
      payType: rate.payType,
      payRate: rate.rate,
      payRateNote:
        rate.source === "job"
          ? "Set on this job"
          : rate.source === "none"
            ? "No rate configured — defaulted to non-billable"
            : null,
      travelReimbursement:
        rate.travelReimbursement ??
        details.project?.travelReimbursement?.toString() ??
        null,
    },
  });

  await recordAudit({
    actorId: user.id,
    entityType: "Job",
    entityId: jobId,
    jobId,
    action: "tech_assigned",
    detail: { who: person.name, payType: rate.payType, rate: rate.rate },
  });

  const jobRef = await db.job.findUniqueOrThrow({
    where: { id: jobId },
    select: { title: true, intWoId: true },
  });

  await notify({
    userId,
    actorId: user.id,
    kind: "job_assigned",
    title: `You are on ${jobRef.title}`,
    body: jobRef.intWoId,
    href: `/jobs/${jobId}`,
    jobId,
  });
  // Their supervisor pays for this time, so they hear about it too.
  if (supervisorId) {
    await notify({
      userId: supervisorId,
      actorId: user.id,
      kind: "job_assigned",
      title: `${person.name} was put on ${jobRef.title}`,
      body: jobRef.intWoId,
      href: `/jobs/${jobId}`,
      jobId,
    });
  }

  syncJobInBackground(jobId);
  touch(jobId);
  return ok;
}

/**
 * Takes a tech off a job.
 *
 * Refused once they have clocked in: their hours are the payroll record, and
 * dropping the assignment would take the time with it. Reassigning after that
 * point means adding the new tech, not erasing the old one.
 */
export async function unassignTech(formData: FormData): Promise<ActionResult> {
  const jobId = String(formData.get("jobId") ?? "");
  const userId = String(formData.get("userId") ?? "");
  // Optional, and worth asking for: "why is somebody else going instead" is the
  // question the timeline gets read for.
  const reason = String(formData.get("reason") ?? "").trim() || null;

  const context = await loadContext(jobId);
  if (!context) return fail("Job not found.");
  const { user, job } = context;

  if (!(await canOnJob(user, "job.reassign", job))) {
    return fail("You cannot change the crew on this job.");
  }

  const assignment = await db.jobAssignment.findUnique({
    where: { jobId_userId: { jobId, userId } },
    select: {
      id: true,
      user: { select: { name: true } },
      _count: { select: { visits: true, deliverables: true } },
    },
  });
  if (!assignment) return fail("They are not on this job.");

  if (assignment._count.visits > 0) {
    return fail(
      `${assignment.user.name} has already clocked in on this job. Their time stays on the record — add the replacement instead.`,
    );
  }
  if (assignment._count.deliverables > 0) {
    return fail(
      `${assignment.user.name} has already uploaded work here. Their deliverables stay on the record — add the replacement instead.`,
    );
  }

  await db.jobAssignment.delete({ where: { id: assignment.id } });

  await recordAudit({
    actorId: user.id,
    entityType: "Job",
    entityId: jobId,
    jobId,
    action: "tech_unassigned",
    detail: { who: assignment.user.name, reason: reason ?? undefined },
  });

  const removedFrom = await db.job.findUniqueOrThrow({
    where: { id: jobId },
    select: { title: true, intWoId: true },
  });

  await notify({
    userId,
    actorId: user.id,
    kind: "job_unassigned",
    title: `You are no longer on ${removedFrom.title}`,
    body: reason ?? removedFrom.intWoId,
    href: `/jobs/${jobId}`,
    jobId,
  });

  // Removes their copy of the event, so nobody drives to a job they are no
  // longer on.
  syncJobInBackground(jobId);
  touch(jobId);
  return ok;
}

/** Moves the lead. Exactly one per job, so the old one is cleared first. */
export async function setLeadTech(formData: FormData): Promise<ActionResult> {
  const jobId = String(formData.get("jobId") ?? "");
  const userId = String(formData.get("userId") ?? "");

  const context = await loadContext(jobId);
  if (!context) return fail("Job not found.");
  const { user, job } = context;

  if (!(await canOnJob(user, "job.assign", job))) {
    return fail("You cannot change the lead on this job.");
  }

  const assignment = await db.jobAssignment.findUnique({
    where: { jobId_userId: { jobId, userId } },
    select: { id: true, isLead: true, user: { select: { name: true } } },
  });
  if (!assignment) return fail("They are not on this job.");
  if (assignment.isLead) return ok;

  await db.$transaction([
    db.jobAssignment.updateMany({ where: { jobId }, data: { isLead: false } }),
    db.jobAssignment.update({
      where: { id: assignment.id },
      data: { isLead: true },
    }),
  ]);

  await recordAudit({
    actorId: user.id,
    entityType: "Job",
    entityId: jobId,
    jobId,
    action: "lead_changed",
    detail: { who: assignment.user.name },
  });

  const leadOn = await db.job.findUniqueOrThrow({
    where: { id: jobId },
    select: { title: true, intWoId: true },
  });
  await notify({
    userId,
    actorId: user.id,
    kind: "job_lead",
    title: `You are lead on ${leadOn.title}`,
    body: leadOn.intWoId,
    href: `/jobs/${jobId}`,
    jobId,
  });

  touch(jobId);
  return ok;
}

const suggestSchema = z.object({
  jobId: z.string().min(1),
  field: z.string().refine(isJobField, "Unknown field"),
  value: z.string(),
  reason: z.string().trim().max(500).optional(),
});

export async function suggestChange(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = suggestSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(z.prettifyError(parsed.error));

  const { jobId, field, value, reason } = parsed.data;

  const context = await loadContext(jobId);
  if (!context) return fail("Job not found.");
  const { user, job } = context;

  if (!(await canOnJob(user, "job.suggest_change", job))) {
    return fail("You cannot suggest changes on this job.");
  }

  const current = await db.job.findUnique({
    where: { id: jobId },
    select: { [field]: true } as Record<string, true>,
  });
  const previous = (current as Record<string, unknown> | null)?.[field] ?? null;

  if (String(previous ?? "") === value.trim()) {
    return fail("That is the value already on the job.");
  }

  const duplicate = await db.changeRequest.findFirst({
    where: {
      jobId,
      fieldPath: field,
      status: "PENDING",
      requestedById: user.id,
    },
    select: { id: true },
  });
  if (duplicate) {
    return fail("You already have a pending suggestion for this field.");
  }

  await db.changeRequest.create({
    data: {
      jobId,
      requestedById: user.id,
      fieldPath: field,
      oldValue: previous === null ? null : String(previous),
      newValue: value.trim() || null,
      reason: reason || null,
    },
  });

  await recordAudit({
    actorId: user.id,
    entityType: "ChangeRequest",
    entityId: jobId,
    jobId,
    action: "change_suggested",
    detail: { field },
  });

  touch(jobId);
  return ok;
}

export async function reviewChangeRequest(
  formData: FormData,
): Promise<ActionResult> {
  const requestId = String(formData.get("requestId") ?? "");
  const approve = formData.get("decision") === "approve";

  const request = await db.changeRequest.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      jobId: true,
      fieldPath: true,
      newValue: true,
      status: true,
    },
  });
  if (!request) return fail("Suggestion not found.");
  if (request.status !== "PENDING") return fail("Already reviewed.");

  const context = await loadContext(request.jobId);
  if (!context) return fail("Job not found.");
  const { user, job } = context;

  if (!(await canOnJob(user, "job.approve_change", job))) {
    return fail("You cannot approve changes on this job.");
  }
  if (!isJobField(request.fieldPath)) {
    return fail("That field no longer exists.");
  }

  const coerced = coerceField(
    request.fieldPath,
    request.newValue ?? "",
    job.timeZone,
  );
  if ("error" in coerced) return fail(coerced.error);

  await db.$transaction(async (tx) => {
    await tx.changeRequest.update({
      where: { id: request.id },
      data: {
        status: approve ? "APPROVED" : "REJECTED",
        reviewedById: user.id,
        reviewedAt: new Date(),
        reviewNote: (formData.get("note") as string) || null,
      },
    });

    if (approve) {
      await tx.job.update({
        where: { id: request.jobId },
        data: { [request.fieldPath]: coerced.value } as Prisma.JobUpdateInput,
      });
    }
  });

  await recordAudit({
    actorId: user.id,
    entityType: "ChangeRequest",
    entityId: request.id,
    jobId: request.jobId,
    action: approve ? "change_approved" : "change_rejected",
    detail: { field: request.fieldPath },
  });

  touch(request.jobId);
  return ok;
}

// ---------------------------------------------------------------------------
// Points of contact
// ---------------------------------------------------------------------------

const contactSchema = z.object({
  jobId: z.string().min(1),
  type: z.enum(ContactType),
  name: z.string().trim().min(1, "Name is required"),
  phone: z.string().trim().optional(),
  email: z.string().trim().optional(),
});

export async function addPointOfContact(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = contactSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(z.prettifyError(parsed.error));

  const { jobId, type, name, phone, email } = parsed.data;

  const context = await loadContext(jobId);
  if (!context) return fail("Job not found.");
  const { user, job } = context;

  // Points of contact are recorded on site as the work happens, so filling
  // them is part of doing the job rather than editing the plan.
  if (!(await canOnJob(user, "job.fill_missing_field", job))) {
    return fail("You cannot record contacts on this job.");
  }

  if (type !== "MOD") {
    const existing = await db.pointOfContact.count({ where: { jobId, type } });
    if (existing > 0) {
      return fail(`There is already a ${type} recorded on this job.`);
    }
  }

  const count = await db.pointOfContact.count({ where: { jobId, type } });

  await db.pointOfContact.create({
    data: {
      jobId,
      type,
      name,
      phone: phone || null,
      email: email || null,
      order: count,
    },
  });

  await recordAudit({
    actorId: user.id,
    entityType: "PointOfContact",
    entityId: jobId,
    jobId,
    action: "contact_added",
    detail: { type, name },
  });

  touch(jobId);
  return ok;
}

export async function deletePointOfContact(
  formData: FormData,
): Promise<ActionResult> {
  const id = String(formData.get("id") ?? "");
  const contact = await db.pointOfContact.findUnique({
    where: { id },
    select: { jobId: true, type: true, name: true },
  });
  if (!contact) return fail("Contact not found.");

  const context = await loadContext(contact.jobId);
  if (!context) return fail("Job not found.");
  const { user, job } = context;

  if (!(await canOnJob(user, "job.fill_missing_field", job))) {
    return fail("You cannot change contacts on this job.");
  }

  await db.pointOfContact.delete({ where: { id } });

  await recordAudit({
    actorId: user.id,
    entityType: "PointOfContact",
    entityId: id,
    jobId: contact.jobId,
    action: "contact_removed",
    detail: { type: contact.type, name: contact.name },
  });

  touch(contact.jobId);
  return ok;
}

// ---------------------------------------------------------------------------
// Scope checklist and work performed
// ---------------------------------------------------------------------------

export async function toggleScopeCheck(
  formData: FormData,
): Promise<ActionResult> {
  const jobId = String(formData.get("jobId") ?? "");
  const lineKey = String(formData.get("lineKey") ?? "");
  const checked = formData.get("checked") === "true";
  if (!lineKey) return fail("Missing checklist item.");

  const context = await loadContext(jobId);
  if (!context) return fail("Job not found.");
  const { user, job } = context;

  // Ticking off work is part of doing it, so anyone who can clock in can tick.
  if (!(await canOnJob(user, "job.clock_in", job))) {
    return fail("You cannot update this checklist.");
  }

  await db.jobScopeCheck.upsert({
    where: { jobId_lineKey: { jobId, lineKey } },
    update: {
      checked,
      checkedById: checked ? user.id : null,
      checkedAt: checked ? new Date() : null,
    },
    create: {
      jobId,
      lineKey,
      checked,
      checkedById: checked ? user.id : null,
      checkedAt: checked ? new Date() : null,
    },
  });

  touch(jobId);
  return ok;
}

export async function saveWorkPerformed(
  formData: FormData,
): Promise<ActionResult> {
  const jobId = String(formData.get("jobId") ?? "");
  const text = String(formData.get("value") ?? "");

  const context = await loadContext(jobId);
  if (!context) return fail("Job not found.");
  const { user, job } = context;

  if (!(await canOnJob(user, "job.clock_in", job))) {
    return fail("You cannot write on this job.");
  }

  const assignment = await db.jobAssignment.findUnique({
    where: { jobId_userId: { jobId, userId: user.id } },
    select: { id: true },
  });
  if (!assignment) return fail("You are not assigned to this job.");

  await db.jobAssignment.update({
    where: { id: assignment.id },
    data: { workPerformed: text.trim() || null },
  });

  // Deliberately not revalidated: this is called on a debounce while the tech
  // is typing, and re-rendering the page under them would move the cursor.
  return ok;
}

export async function saveMergedWorkPerformed(
  formData: FormData,
): Promise<ActionResult> {
  const jobId = String(formData.get("jobId") ?? "");
  const text = String(formData.get("value") ?? "");

  const context = await loadContext(jobId);
  if (!context) return fail("Job not found.");
  const { user, job } = context;

  const assignment = await db.jobAssignment.findUnique({
    where: { jobId_userId: { jobId, userId: user.id } },
    select: { isLead: true },
  });

  // The merged narrative belongs to the lead tech, or to anyone who can
  // approve the report — a supervisor tidying it up afterwards.
  const allowed =
    assignment?.isLead || (await canOnJob(user, "job.approve_report", job));
  if (!allowed) {
    return fail("Only the lead tech or a supervisor can merge the summary.");
  }

  await db.job.update({
    where: { id: jobId },
    data: { workPerformedMerged: text.trim() || null },
  });

  return ok;
}

/**
 * Switches whether this job's breaks are paid.
 *
 * Not just a label: every break already recorded carries its own copy, which
 * is what payroll reads. Changing the rule has to reach those too, or the
 * change is cosmetic and the money comes out by the old one. The project
 * supplies the default; a job can still differ from it.
 */
export async function setBreakPaid(formData: FormData): Promise<ActionResult> {
  const jobId = String(formData.get("jobId") ?? "");
  const paid = String(formData.get("paid") ?? "") === "true";

  const context = await loadContext(jobId);
  if (!context) return fail("Job not found.");
  const { user, job } = context;

  if (!(await canOnJob(user, "job.edit_planned_fields", job))) {
    return fail("You cannot change how breaks are paid on this job.");
  }
  if (job.breakPaid === paid) return ok;

  await db.$transaction([
    db.job.update({ where: { id: jobId }, data: { breakPaid: paid } }),
    db.breakPeriod.updateMany({
      where: { visit: { assignment: { jobId } } },
      data: { paid },
    }),
  ]);

  await recordAudit({
    actorId: user.id,
    entityType: "Job",
    entityId: jobId,
    jobId,
    action: "field_edited",
    detail: {
      field: "Breaks are paid",
      from: String(job.breakPaid),
      to: String(paid),
    },
  });

  touch(jobId);
  return ok;
}

/**
 * Fills in a site number that was not known when the job was raised.
 *
 * Dispatch often gives a customer and a city and nothing else; the number is
 * on the door. Anyone who can clock in here can set it, because they are the
 * person standing in front of it — and getting it recorded while they are
 * there is the whole point.
 */
export async function setSiteNumber(formData: FormData): Promise<ActionResult> {
  const jobId = String(formData.get("jobId") ?? "");
  const siteNumber = String(formData.get("siteNumber") ?? "").trim();

  if (!siteNumber) return fail("Enter the site number.");

  const context = await loadContext(jobId);
  if (!context) return fail("Job not found.");
  const { user, job } = context;

  if (!(await canOnJob(user, "job.clock_in", job))) {
    return fail("You cannot change this site.");
  }

  const target = await db.job.findUniqueOrThrow({
    where: { id: jobId },
    select: {
      site: {
        select: { id: true, customerId: true, siteNumber: true, numberPending: true },
      },
    },
  });
  if (!target.site.numberPending) {
    return fail("This site already has a number. Edit it in the directory.");
  }

  // The real site may already exist — somebody worked it last year under the
  // number that has just been read off the door. Move the job onto it rather
  // than creating a second one, so the site history stays in one place.
  const existing = await db.site.findUnique({
    where: {
      customerId_siteNumber: { customerId: target.site.customerId, siteNumber },
    },
    select: { id: true },
  });

  if (existing && existing.id !== target.site.id) {
    await db.job.update({ where: { id: jobId }, data: { siteId: existing.id } });
    // The placeholder is only ever referenced by this job, so it goes.
    await db.site
      .delete({ where: { id: target.site.id } })
      .catch(() => undefined);
  } else {
    await db.site.update({
      where: { id: target.site.id },
      data: { siteNumber, numberPending: false },
    });
  }

  await recordAudit({
    actorId: user.id,
    entityType: "Job",
    entityId: jobId,
    jobId,
    action: "field_edited",
    detail: { field: "Site ID", from: null, to: siteNumber },
  });

  touch(jobId);
  return ok;
}

// ---------------------------------------------------------------------------
// Dispatch numbers for this job
// ---------------------------------------------------------------------------

/**
 * Adds a number to reach mid-job.
 *
 * The project's contacts travel with every job under it; these belong to this
 * one — a bridge line that only exists today, a duty manager's mobile read out
 * on the call. Anyone who can plan the job can add one, because the person who
 * takes the call is the person who has the number.
 */
export async function addJobDispatchContact(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const jobId = String(formData.get("jobId") ?? "");
  const label = String(formData.get("label") ?? "").trim();
  if (!label) return fail("Say who they are.");

  const context = await loadContext(jobId);
  if (!context) return fail("Job not found.");
  const { user, job } = context;

  if (!(await canOnJob(user, "job.edit_planned_fields", job))) {
    return fail("You cannot add contacts to this job.");
  }

  const last = await db.dispatchContact.findFirst({
    where: { jobId },
    orderBy: { order: "desc" },
    select: { order: true },
  });

  const contact = await db.dispatchContact.create({
    data: {
      jobId,
      label,
      name: String(formData.get("name") ?? "").trim() || null,
      phone: String(formData.get("phone") ?? "").trim() || null,
      email: String(formData.get("email") ?? "").trim() || null,
      note: String(formData.get("note") ?? "").trim() || null,
      order: (last?.order ?? -1) + 1,
    },
    select: { id: true },
  });

  await recordAudit({
    actorId: user.id,
    entityType: "DispatchContact",
    entityId: contact.id,
    jobId,
    action: "dispatch_added",
    detail: { who: label },
  });

  touch(jobId);
  return ok;
}

export async function deleteJobDispatchContact(
  formData: FormData,
): Promise<ActionResult> {
  const id = String(formData.get("id") ?? "");

  const contact = await db.dispatchContact.findUnique({
    where: { id },
    select: { id: true, jobId: true, label: true },
  });
  // Project contacts are managed on the project; this only ever removes one
  // that belongs to the job itself.
  if (!contact?.jobId) return fail("Not found.");

  const context = await loadContext(contact.jobId);
  if (!context) return fail("Job not found.");
  const { user, job } = context;

  if (!(await canOnJob(user, "job.edit_planned_fields", job))) {
    return fail("You cannot remove contacts from this job.");
  }

  await db.dispatchContact.delete({ where: { id } });

  await recordAudit({
    actorId: user.id,
    entityType: "DispatchContact",
    entityId: id,
    jobId: contact.jobId,
    action: "dispatch_removed",
    detail: { who: contact.label },
  });

  touch(contact.jobId);
  return ok;
}

// ---------------------------------------------------------------------------
// What this job pays
// ---------------------------------------------------------------------------

/**
 * Sets the rate and travel money for everybody on this job.
 *
 * A rate arrives from the tech, the project or the company, and every so often
 * a single job is none of those — overtime rates for a weekend cutover, a flat
 * fee somebody negotiated. Per job rather than per tech on the job: the
 * negotiation was about the work, and two people doing the same work on the
 * same night at different rates is a mistake far more often than an intent.
 *
 * Payroll lines snapshot what they were built from, so anything already paid
 * keeps the number it was paid at. A week that has been approved is refused
 * anyway — the screen would then disagree with the payment.
 */
export async function setJobPay(formData: FormData): Promise<ActionResult> {
  const jobId = String(formData.get("jobId") ?? "");
  const payType = String(formData.get("payType") ?? "").trim();
  const payRate = String(formData.get("payRate") ?? "").trim();
  const travel = String(formData.get("travelReimbursement") ?? "").trim();

  const context = await loadContext(jobId);
  if (!context) return fail("Job not found.");
  const { user, job } = context;

  if (!(await canOnJob(user, "pay.edit_rates", job))) {
    return fail("You cannot change what this job pays.");
  }

  if (!payType || !(payType in JobPayType)) return fail("Pick a pay type.");
  const rate = Number(payRate);
  if (!Number.isFinite(rate) || rate < 0) {
    return fail("Enter a rate of zero or more.");
  }
  const travelAmount = travel === "" ? null : Number(travel);
  if (travelAmount !== null && (!Number.isFinite(travelAmount) || travelAmount < 0)) {
    return fail("Enter a travel amount of zero or more.");
  }

  const settled = await db.payrollLine.count({
    where: {
      assignment: { jobId },
      payrollPeriod: { status: { not: "DRAFT" } },
    },
  });
  if (settled > 0) {
    return fail(
      "This job is in a payroll week that has already been approved. Changing the rate now would disagree with what was paid.",
    );
  }

  const before = await db.jobAssignment.findMany({
    where: { jobId },
    select: { payType: true, payRate: true },
  });

  await db.$transaction([
    // On the job, so somebody assigned tomorrow gets it too.
    db.job.update({
      where: { id: jobId },
      data: {
        payType: payType as JobPayType,
        payRate: payRate,
        travelReimbursement: travelAmount === null ? null : travel,
      },
    }),
    // Anybody deliberately put on a different rate keeps it — saying so is
    // the whole point of having said so.
    db.jobAssignment.updateMany({
      where: { jobId, payOverridden: false },
      data: {
        payType: payType as JobPayType,
        payRate: payRate,
        payRateNote: "Set on this job",
        travelReimbursement: travelAmount === null ? null : travel,
      },
    }),
  ]);

  await recordAudit({
    actorId: user.id,
    entityType: "Job",
    entityId: jobId,
    jobId,
    action: "pay_changed",
    detail: {
      field: "Pay",
      from: before[0]
        ? `${before[0].payType} ${before[0].payRate.toString()}`
        : null,
      to: `${payType} ${payRate}`,
      who: `${before.length} on the job`,
    },
  });

  touch(jobId);
  return ok;
}

/**
 * Puts one person on a different rate from the rest of the job.
 *
 * A trainee shadowing at half rate, somebody brought in on a favour, a
 * subcontractor whose number was agreed separately. The reason is required:
 * a rate that differs from everybody else's on the same night is a question
 * somebody will ask in three months, and the answer belongs next to it rather
 * than in whoever's memory.
 *
 * Marked as overridden, so setting the job's pay afterwards leaves it alone.
 */
export async function setAssignmentPay(
  formData: FormData,
): Promise<ActionResult> {
  const assignmentId = String(formData.get("assignmentId") ?? "");
  const payType = String(formData.get("payType") ?? "").trim();
  const payRate = String(formData.get("payRate") ?? "").trim();
  const travel = String(formData.get("travelReimbursement") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();

  const assignment = await db.jobAssignment.findUnique({
    where: { id: assignmentId },
    select: { id: true, jobId: true, user: { select: { name: true } } },
  });
  if (!assignment) return fail("Not found.");

  const context = await loadContext(assignment.jobId);
  if (!context) return fail("Job not found.");
  const { user, job } = context;

  if (!(await canOnJob(user, "pay.edit_rates", job))) {
    return fail("You cannot change what this job pays.");
  }
  if (!payType || !(payType in JobPayType)) return fail("Pick a pay type.");
  if (!reason) return fail("Say why this person is on a different rate.");

  const rate = Number(payRate);
  if (!Number.isFinite(rate) || rate < 0) {
    return fail("Enter a rate of zero or more.");
  }
  const travelAmount = travel === "" ? null : Number(travel);
  if (travelAmount !== null && (!Number.isFinite(travelAmount) || travelAmount < 0)) {
    return fail("Enter a travel amount of zero or more.");
  }

  const settled = await db.payrollLine.count({
    where: { assignmentId, payrollPeriod: { status: { not: "DRAFT" } } },
  });
  if (settled > 0) {
    return fail(
      "This person's week has already been approved. Changing the rate now would disagree with what was paid.",
    );
  }

  await db.jobAssignment.update({
    where: { id: assignmentId },
    data: {
      payType: payType as JobPayType,
      payRate,
      payRateNote: reason,
      travelReimbursement: travelAmount === null ? null : travel,
      payOverridden: true,
    },
  });

  await recordAudit({
    actorId: user.id,
    entityType: "JobAssignment",
    entityId: assignmentId,
    jobId: assignment.jobId,
    action: "pay_overridden",
    detail: {
      who: assignment.user.name,
      to: `${payType} ${payRate}`,
      reason,
    },
  });

  touch(assignment.jobId);
  return ok;
}

/** Puts them back on whatever the job pays everybody else. */
export async function clearAssignmentPay(
  formData: FormData,
): Promise<ActionResult> {
  const assignmentId = String(formData.get("assignmentId") ?? "");

  const assignment = await db.jobAssignment.findUnique({
    where: { id: assignmentId },
    select: {
      id: true,
      jobId: true,
      userId: true,
      user: { select: { name: true } },
      job: {
        select: {
          clientId: true,
          projectId: true,
          payType: true,
          payRate: true,
          travelReimbursement: true,
        },
      },
    },
  });
  if (!assignment) return fail("Not found.");

  const context = await loadContext(assignment.jobId);
  if (!context) return fail("Job not found.");
  const { user, job } = context;

  if (!(await canOnJob(user, "pay.edit_rates", job))) {
    return fail("You cannot change what this job pays.");
  }

  const settled = await db.payrollLine.count({
    where: { assignmentId, payrollPeriod: { status: { not: "DRAFT" } } },
  });
  if (settled > 0) {
    return fail(
      "This person's week has already been approved. Changing the rate now would disagree with what was paid.",
    );
  }

  // Back to whatever they would have got had nobody intervened: the job's own
  // rate if it has one, otherwise the ordinary resolution.
  const resolved = assignment.job.payType
    ? {
        payType: assignment.job.payType,
        rate: assignment.job.payRate?.toString() ?? "0",
        travelReimbursement:
          assignment.job.travelReimbursement?.toString() ?? null,
        source: "job" as const,
      }
    : await resolvePayRate(
        assignment.userId,
        assignment.job.projectId,
        assignment.job.clientId,
      );

  await db.jobAssignment.update({
    where: { id: assignmentId },
    data: {
      payType: resolved.payType,
      payRate: resolved.rate,
      payRateNote:
        resolved.source === "job"
          ? "Set on this job"
          : resolved.source === "none"
            ? "No rate configured — defaulted to non-billable"
            : null,
      travelReimbursement: resolved.travelReimbursement,
      payOverridden: false,
    },
  });

  await recordAudit({
    actorId: user.id,
    entityType: "JobAssignment",
    entityId: assignmentId,
    jobId: assignment.jobId,
    action: "pay_override_cleared",
    detail: {
      who: assignment.user.name,
      to: `${resolved.payType} ${resolved.rate}`,
    },
  });

  touch(assignment.jobId);
  return ok;
}

// ---------------------------------------------------------------------------
// Ticket numbers beyond the first
// ---------------------------------------------------------------------------

/**
 * Adds a ticket the job also answers to.
 *
 * The primary lives on the job itself and goes through the usual planned-field
 * machinery — change requests and all. These are the ones after it, and they
 * are added and removed outright: a second ticket is a fact somebody was told
 * on the phone, not a value worth arguing over.
 */
export async function addJobTicket(formData: FormData): Promise<ActionResult> {
  const jobId = String(formData.get("jobId") ?? "");
  const number = String(formData.get("number") ?? "").trim();

  if (!number) return fail("Enter the ticket number.");
  if (number.length > 64) return fail("That is too long for a ticket number.");

  const context = await loadContext(jobId);
  if (!context) return fail("Job not found.");
  const { user, job } = context;

  if (!(await canOnJob(user, "job.fill_missing_field", job))) {
    return fail("You cannot change this job's tickets.");
  }

  const existing = await db.job.findUniqueOrThrow({
    where: { id: jobId },
    select: {
      ticketNumber: true,
      extraTickets: { select: { number: true }, orderBy: { order: "desc" }, take: 1 },
    },
  });

  // The primary is the first ticket. Somebody adding one to a job that has
  // none meant to set the primary, not to create a secondary with no primary.
  if (!existing.ticketNumber?.trim()) {
    await db.job.update({ where: { id: jobId }, data: { ticketNumber: number } });
  } else {
    const last = await db.jobTicket.findFirst({
      where: { jobId },
      orderBy: { order: "desc" },
      select: { order: true },
    });
    const duplicate = await db.jobTicket.findFirst({
      where: { jobId, number },
      select: { id: true },
    });
    if (duplicate || existing.ticketNumber.trim() === number) {
      return fail("This job already has that ticket.");
    }
    await db.jobTicket.create({
      data: { jobId, number, order: (last?.order ?? -1) + 1 },
    });
  }

  await recordAudit({
    actorId: user.id,
    entityType: "Job",
    entityId: jobId,
    jobId,
    action: "updated",
    detail: { field: "Ticket #", to: number },
  });

  revalidatePath(`/jobs/${jobId}`);
  return ok;
}

export async function deleteJobTicket(formData: FormData): Promise<ActionResult> {
  const id = String(formData.get("id") ?? "");

  const ticket = await db.jobTicket.findUnique({
    where: { id },
    select: { id: true, number: true, jobId: true },
  });
  if (!ticket) return fail("Not found.");

  const context = await loadContext(ticket.jobId);
  if (!context) return fail("Job not found.");
  const { user, job } = context;

  if (!(await canOnJob(user, "job.fill_missing_field", job))) {
    return fail("You cannot change this job's tickets.");
  }

  await db.jobTicket.delete({ where: { id } });

  await recordAudit({
    actorId: user.id,
    entityType: "Job",
    entityId: ticket.jobId,
    jobId: ticket.jobId,
    action: "updated",
    detail: { field: "Ticket #", from: ticket.number },
  });

  revalidatePath(`/jobs/${ticket.jobId}`);
  return ok;
}

// ---------------------------------------------------------------------------
// What this job has to produce
// ---------------------------------------------------------------------------

const jobRuleSchema = z.object({
  jobId: z.string().min(1),
  category: z.enum(DeliverableCategory),
  customLabel: optionalText,
  enabled: flag,
  required: flag,
  requiresPhoto: flag,
  requiresText: flag,
  /** Custom sections are taken away rather than switched off. */
  remove: flag,
});

/**
 * Switches a deliverable section on or off for this job alone.
 *
 * The project's sheet is a default. A job that needs old serials recorded when
 * the project never asks for them, or one where the customer waives the
 * post-install photos, is planning rather than an exception — so it is decided
 * here and stays with the job.
 */
export async function saveJobDeliverableRule(
  formData: FormData,
): Promise<ActionResult> {
  const parsed = jobRuleSchema.safeParse({
    ...Object.fromEntries(formData),
    enabled: formData.get("enabled") === "true",
    required: formData.get("required") === "true",
    requiresPhoto: formData.get("requiresPhoto") === "true",
    requiresText: formData.get("requiresText") === "true",
    remove: formData.get("remove") === "true",
  });
  if (!parsed.success) return fail(z.prettifyError(parsed.error));

  const { jobId, category, remove, ...rule } = parsed.data;

  const context = await loadContext(jobId);
  if (!context) return fail("Job not found.");

  const { user, job } = context;

  // Turning a section on is adding somewhere to put what is in front of you,
  // and anyone who can upload to the job can want that. Demanding one, or
  // removing one that was planned, decides what checkout will refuse — that
  // stays with a supervisor or the person leading the job.
  if (!(await canOnJob(user, "deliverable.upload", job))) {
    return fail("You cannot change what this job has to produce.");
  }

  const mayRequire =
    job.isLead || (await canOnJob(user, "job.edit_planned_fields", job));

  if (!mayRequire) {
    const current = (await jobRuleSheet(jobId))?.find(
      (item) =>
        item.category === category &&
        (category !== "CUSTOM" || item.customLabel === rule.customLabel),
    );
    if (rule.required) {
      return fail("Only a supervisor or the job's lead can make a section required.");
    }
    if (remove || (current?.enabled && !rule.enabled)) {
      return fail("Only a supervisor or the job's lead can remove a section.");
    }
  }

  if (remove) {
    if (category !== "CUSTOM" || !rule.customLabel) {
      // The fixed nine are switched off, not deleted: "off" should stay a
      // decision somebody made rather than a row that happens to be missing.
      return fail("Only a custom section can be removed.");
    }
    await removeJobCustomRule(jobId, rule.customLabel);

    await recordAudit({
      actorId: user.id,
      entityType: "Job",
      entityId: jobId,
      jobId,
      projectId: job.projectId,
      action: "updated",
      detail: { field: `Deliverables — ${rule.customLabel}`, to: "removed" },
    });

    touch(jobId);
    return ok;
  }

  if (category === "CUSTOM" && !rule.customLabel) {
    return fail("Give the section a name.");
  }

  // A section that is off cannot also be mandatory; letting both be true would
  // block checkout on something the tech is never shown.
  const normalised = {
    ...rule,
    customLabel: category === "CUSTOM" ? rule.customLabel : null,
    required: rule.enabled && rule.required,
  };

  await saveJobRule(jobId, { category, ...normalised });

  await recordAudit({
    actorId: user.id,
    entityType: "Job",
    entityId: jobId,
    jobId,
    projectId: job.projectId,
    action: "updated",
    detail: {
      field: `Deliverables — ${deliverableLabel(category, normalised.customLabel)}`,
      to: normalised.enabled
        ? normalised.required
          ? "required"
          : "optional"
        : "off",
    },
  });

  touch(jobId);
  return ok;
}

// ---------------------------------------------------------------------------
// Moving a clock that is already recorded
// ---------------------------------------------------------------------------

const visitTimeSchema = z.object({
  visitId: z.string().min(1),
  field: z.enum(["clockIn", "clockOut"]),
  /** A datetime-local from the browser, read in the site's zone. */
  at: z.string().min(1),
  reason: optionalText,
});

/**
 * Corrects a clock-in or clock-out after the fact.
 *
 * How far anybody may move one is decided in clock-limits.ts, away from here,
 * because it is the calculation that settles what a person is paid. This does
 * the three things that follow from its answer: write it, send it to whoever
 * pays for the time, or refuse.
 */
export async function adjustVisitTime(
  formData: FormData,
): Promise<ActionResult> {
  const parsed = visitTimeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(z.prettifyError(parsed.error));

  const { visitId, field, reason } = parsed.data;

  const visit = await db.visit.findUnique({
    where: { id: visitId },
    select: {
      id: true,
      clockInAt: true,
      clockOutAt: true,
      assignment: {
        select: {
          jobId: true,
          userId: true,
          supervisorId: true,
          // Both, because they can differ: the assignment records who answered
          // for this person on this job, and their standing supervisor covers
          // a job raised before that was written down.
          user: { select: { name: true, directSupervisorId: true } },
        },
      },
    },
  });
  if (!visit) return fail("That visit is no longer here.");

  const context = await loadContext(visit.assignment.jobId);
  if (!context) return fail("Job not found.");
  const { user, job } = context;

  if (!(await canOnJob(user, "job.adjust_time", job))) {
    return fail("You cannot change clock times on this job.");
  }

  const from = field === "clockIn" ? visit.clockInAt : visit.clockOutAt;
  if (!from) return fail("That clock has not been stopped yet.");

  const to = parseDatetimeLocalInZone(parsed.data.at, job.timeZone);
  if (!to) return fail("That is not a valid time.");

  const company = await getCompanySettings();
  const snapped = roundToInterval(to, company.timeRoundingMinutes);

  const project = job.projectId
    ? await db.project.findUnique({
        where: { id: job.projectId },
        select: { managerId: true },
      })
    : null;

  const authority = clockAuthority({
    scope: permissionScope(user, "job.adjust_time"),
    isDirectSupervisor:
      visit.assignment.supervisorId === user.id ||
      visit.assignment.user.directSupervisorId === user.id,
    isProjectManager: project?.managerId === user.id,
    isLead: job.isLead,
    isSupervisor: user.baseRole !== "TECH",
  });

  const verdict = judgeClockEdit(authority, { field, from, to: snapped });

  if (verdict.outcome === "refuse") return fail(verdict.reason);

  if (verdict.outcome === "approval") {
    // Not written. The person who pays for the time decides, and until they do
    // the record says what actually happened rather than what was asked for.
    await db.changeRequest.create({
      data: {
        jobId: job.id,
        requestedById: user.id,
        fieldPath: `visit.${visitId}.${field}`,
        oldValue: from.toISOString(),
        newValue: snapped.toISOString(),
        reason: reason ?? verdict.reason,
      },
    });

    // No notification: notifications are for things that happened, and this is
    // something to decide. The request itself is what reaches the approvals
    // inbox, which is where decisions are answered.
    touch(job.id);
    return fail(verdict.reason);
  }

  await db.visit.update({
    where: { id: visitId },
    data:
      field === "clockIn"
        ? { clockInAt: snapped, clockInSource: "ADJUSTED" }
        : { clockOutAt: snapped, clockOutSource: "ADJUSTED" },
  });

  await recordAudit({
    actorId: user.id,
    entityType: "Visit",
    entityId: visitId,
    jobId: job.id,
    action: "time_adjusted",
    detail: {
      field,
      who: visit.assignment.user.name,
      from: from.toISOString(),
      to: snapped.toISOString(),
      reason: reason ?? null,
    },
  });

  // The event has been telling a supervisor's day view the old time.
  syncJobInBackground(job.id);
  touch(job.id);
  return ok;
}
