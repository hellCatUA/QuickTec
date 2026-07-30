"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { recordAudit } from "@/lib/audit";
import { syncJobInBackground } from "@/lib/calendar/sync";
import { getCompanySettings } from "@/lib/company";
import { db } from "@/lib/db";
import { optionalText } from "@/lib/form";
import {
  allocateIntWo,
  allocateRevisitIntWo,
  revisitAssignmentId,
} from "@/lib/int-wo";
import { resolvePayRate } from "@/lib/pay-rates";
import { resolveJobSupervisor } from "@/lib/scope";
import { can, requirePermission } from "@/lib/session";
import { jobFormSchema } from "./schema";

export type ActionResult = { ok: true; id?: string } | { ok: false; error: string };



export async function createJob(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requirePermission("job.create");

  const parsed = jobFormSchema.safeParse({
    ...Object.fromEntries(formData),
    assigneeIds: formData.getAll("assigneeIds").map(String).filter(Boolean),
  });
  if (!parsed.success) {
    return { ok: false, error: z.prettifyError(parsed.error) };
  }

  const input = parsed.data;

  const site = await db.site.findUnique({
    where: { id: input.siteId },
    select: { customerId: true, timeZone: true },
  });
  if (!site) return { ok: false, error: "Site not found." };

  const project = input.projectId
    ? await db.project.findUnique({
        where: { id: input.projectId },
        select: {
          id: true,
          externalProjectId: true,
          breakPaid: true,
          travelReimbursement: true,
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
      })
    : null;

  if (input.projectId && !project) {
    return { ok: false, error: "Project not found." };
  }

  const company = await getCompanySettings();
  const timeZone = site.timeZone ?? company.defaultTimeZone;

  const scheduledStart = input.scheduledStart
    ? new Date(input.scheduledStart)
    : null;
  if (scheduledStart && Number.isNaN(scheduledStart.getTime())) {
    return { ok: false, error: "Scheduled time is not a valid date." };
  }

  // A tech creating their own job cannot self-approve it; it goes in pending
  // and they carry on working while a supervisor catches up.
  const needsApproval = !can(actor, "job.approve_report");

  const assigneeIds = Array.from(new Set(input.assigneeIds));
  if (assigneeIds.length > 0 && !can(actor, "job.assign")) {
    return { ok: false, error: "You cannot assign techs to a job." };
  }

  // A tech cannot assign anybody, so an ad-hoc job would be raised with no
  // crew at all and they could not clock in on the work they are standing in
  // front of. Raising it is what puts them on it.
  if (
    assigneeIds.length === 0 &&
    !can(actor, "job.assign") &&
    can(actor, "job.clock_in")
  ) {
    assigneeIds.push(actor.id);
  }

  const rates = await Promise.all(
    assigneeIds.map(async (userId) => ({
      userId,
      rate: await resolvePayRate(userId, project?.id ?? null, input.clientId),
      supervisorId: await resolveJobSupervisor(userId, project?.id ?? null),
    })),
  );

  // The lead defaults to whoever on site outranks a plain tech; an explicit
  // choice from the planner wins.
  const staff = await db.user.findMany({
    where: { id: { in: assigneeIds } },
    select: { id: true, baseRole: true },
  });
  const defaultLead =
    staff.find((person) => person.baseRole !== "TECH")?.id ?? assigneeIds[0];
  const leadId =
    input.leadId && assigneeIds.includes(input.leadId)
      ? input.leadId
      : defaultLead;

  const job = await db.$transaction(async (tx) => {
    const { intWoId, sequence } = await allocateIntWo(tx, {
      projectId: project?.id ?? null,
      externalProjectId: project?.externalProjectId ?? null,
      effectiveDate: scheduledStart ?? new Date(),
      timeZone,
    });

    return tx.job.create({
      data: {
        intWoId,
        intWoSequence: sequence,
        title: input.title,
        clientId: input.clientId,
        customerId: site.customerId,
        siteId: input.siteId,
        projectId: project?.id ?? null,
        externalAssignmentId: input.externalAssignmentId,
        ticketNumber: input.ticketNumber,
        incNumber: input.incNumber,
        scheduledStart,
        estimateMinutes: input.estimateMinutes,
        techsRequired: input.techsRequired ?? 1,
        scopeOfWork: input.scopeOfWork,
        // The project supplies the default; the planner can still overrule it
        // for this job, which is a real case — a long day where breaks are
        // covered on work that normally does not.
        breakPaid: input.breakPaid,
        lifecycle: needsApproval
          ? "PENDING_APPROVAL"
          : scheduledStart
            ? "SCHEDULED"
            : "DRAFT",
        createdById: actor.id,
        // Copy the project's deliverable rules onto the job so later edits to
        // the project cannot silently change what a scheduled job demands.
        deliverableRules: project
          ? {
              create: project.deliverableRules.map((rule) => ({
                category: rule.category,
                customLabel: rule.customLabel,
                enabled: rule.enabled,
                required: rule.required,
                requiresPhoto: rule.requiresPhoto,
                requiresText: rule.requiresText,
                order: rule.order,
              })),
            }
          : undefined,
        assignments: {
          create: rates.map(({ userId, rate, supervisorId }) => ({
            userId,
            supervisorId,
            isLead: userId === leadId,
            payType: rate.payType,
            payRate: rate.rate,
            payRateNote:
              rate.source === "none"
                ? "No rate configured — defaulted to non-billable"
                : null,
            travelReimbursement:
              rate.travelReimbursement ??
              project?.travelReimbursement?.toString() ??
              null,
          })),
        },
      },
      select: { id: true, intWoId: true },
    });
  });

  await recordAudit({
    actorId: actor.id,
    entityType: "Job",
    entityId: job.id,
    jobId: job.id,
    action: "created",
    detail: {
      intWoId: job.intWoId,
      assignees: assigneeIds.length,
      pendingApproval: needsApproval,
    },
  });

  // Also on the project's own history, so "five jobs were added in March" is
  // answerable from the project rather than by trawling the job list.
  if (project) {
    await recordAudit({
      actorId: actor.id,
      entityType: "Job",
      entityId: job.id,
      projectId: project.id,
      action: "project_job_created",
      detail: { who: job.intWoId, to: input.title },
    });
  }

  syncJobInBackground(job.id);
  revalidatePath("/jobs");
  return { ok: true, id: job.id };
}

const revisitSchema = z.object({
  parentJobId: z.string().min(1),
  /** "same" reuses the parent's Assignment ID with an R- prefix. */
  assignmentIdMode: z.enum(["same", "new"]),
  externalAssignmentId: optionalText,
  scheduledStart: optionalText,
  title: optionalText,
});

export async function createRevisit(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requirePermission("job.create");

  const parsed = revisitSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: z.prettifyError(parsed.error) };
  }

  const input = parsed.data;

  const parent = await db.job.findUnique({
    where: { id: input.parentJobId },
    select: {
      id: true,
      title: true,
      clientId: true,
      customerId: true,
      siteId: true,
      projectId: true,
      externalAssignmentId: true,
      ticketNumber: true,
      incNumber: true,
      estimateMinutes: true,
      techsRequired: true,
      scopeOfWork: true,
      breakPaid: true,
      site: { select: { timeZone: true } },
      deliverableRules: {
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
  });

  if (!parent) return { ok: false, error: "Original job not found." };

  if (input.assignmentIdMode === "new" && !input.externalAssignmentId) {
    return { ok: false, error: "Enter the new Assignment ID from the client." };
  }

  const company = await getCompanySettings();
  const timeZone = parent.site.timeZone ?? company.defaultTimeZone;

  const scheduledStart = input.scheduledStart
    ? new Date(input.scheduledStart)
    : null;
  if (scheduledStart && Number.isNaN(scheduledStart.getTime())) {
    return { ok: false, error: "Scheduled time is not a valid date." };
  }

  const assignmentId =
    input.assignmentIdMode === "same"
      ? revisitAssignmentId(parent.externalAssignmentId)
      : input.externalAssignmentId;

  const job = await db.$transaction(async (tx) => {
    const { intWoId, sequence, revisitNumber } = await allocateRevisitIntWo(tx, {
      parentJobId: parent.id,
      effectiveDate: scheduledStart ?? new Date(),
      timeZone,
    });

    return tx.job.create({
      data: {
        intWoId,
        intWoSequence: sequence,
        revisitNumber,
        // Chain every revisit off the original so R-numbers keep counting up
        // rather than restarting from a revisit of a revisit.
        parentJobId: parent.id,
        title: input.title ?? `${parent.title} (revisit ${revisitNumber})`,
        clientId: parent.clientId,
        customerId: parent.customerId,
        siteId: parent.siteId,
        projectId: parent.projectId,
        externalAssignmentId: assignmentId,
        ticketNumber: parent.ticketNumber,
        incNumber: parent.incNumber,
        scheduledStart,
        estimateMinutes: parent.estimateMinutes,
        techsRequired: parent.techsRequired,
        scopeOfWork: parent.scopeOfWork,
        breakPaid: parent.breakPaid,
        lifecycle: scheduledStart ? "SCHEDULED" : "DRAFT",
        createdById: actor.id,
        deliverableRules: {
          create: parent.deliverableRules.map((rule) => ({
            category: rule.category,
            customLabel: rule.customLabel,
            enabled: rule.enabled,
            required: rule.required,
            requiresPhoto: rule.requiresPhoto,
            requiresText: rule.requiresText,
            order: rule.order,
          })),
        },
      },
      select: { id: true, intWoId: true },
    });
  });

  await recordAudit({
    actorId: actor.id,
    entityType: "Job",
    entityId: job.id,
    jobId: job.id,
    action: "revisit_created",
    detail: { intWoId: job.intWoId, parentJobId: parent.id },
  });

  await recordAudit({
    actorId: actor.id,
    entityType: "Job",
    entityId: parent.id,
    jobId: parent.id,
    action: "revisit_scheduled",
    detail: { revisitJobId: job.id, intWoId: job.intWoId },
  });

  if (parent.projectId) {
    await recordAudit({
      actorId: actor.id,
      entityType: "Job",
      entityId: job.id,
      projectId: parent.projectId,
      action: "revisit_created",
      detail: { who: job.intWoId },
    });
  }

  revalidatePath("/jobs");
  revalidatePath(`/jobs/${parent.id}`);
  return { ok: true, id: job.id };
}

export async function approveJob(formData: FormData): Promise<ActionResult> {
  const actor = await requirePermission("job.approve_report");
  const jobId = String(formData.get("jobId") ?? "");
  if (!jobId) return { ok: false, error: "Missing job" };

  const job = await db.job.findUnique({
    where: { id: jobId },
    select: { lifecycle: true, scheduledStart: true },
  });
  if (!job) return { ok: false, error: "Job not found" };

  if (job.lifecycle !== "PENDING_APPROVAL") {
    return { ok: false, error: "This job is not waiting for approval." };
  }

  await db.job.update({
    where: { id: jobId },
    data: {
      lifecycle: job.scheduledStart ? "SCHEDULED" : "DRAFT",
      approvedById: actor.id,
      approvedAt: new Date(),
    },
  });

  await recordAudit({
    actorId: actor.id,
    entityType: "Job",
    entityId: jobId,
    jobId,
    action: "ad_hoc_approved",
  });

  revalidatePath("/jobs");
  revalidatePath(`/jobs/${jobId}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Sites created while planning or on site
// ---------------------------------------------------------------------------

const quickSiteSchema = z.object({
  customerId: optionalText,
  /** Used when the customer is new too — a brand nobody has logged yet. */
  customerName: optionalText,
  customerCode: optionalText,
  siteNumber: z.string().trim().min(1, "Enter the site number"),
  addressLine1: optionalText,
  city: optionalText,
  state: optionalText,
  postalCode: optionalText,
});

/**
 * Creates a site from whatever is known at the time.
 *
 * A site number is very often not known in advance — it turns up in a phone
 * call or on the door — so anyone who can raise a job can add one, and the
 * address is recorded if they have it rather than demanded before they can
 * carry on. The directory is where a site gets tidied up afterwards.
 */
export async function quickCreateSite(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requirePermission("job.create");

  const parsed = quickSiteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: z.prettifyError(parsed.error) };
  }
  const input = parsed.data;

  let customerId = input.customerId;

  if (!customerId) {
    if (!input.customerName) {
      return { ok: false, error: "Pick a customer, or name a new one." };
    }

    // A code is what shows up as "SBUX #24541", so derive one rather than
    // making somebody invent it mid-call.
    const code = (input.customerCode ?? input.customerName)
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 8);
    if (!code) return { ok: false, error: "That customer name has no letters." };

    const existing = await db.customer.findUnique({ where: { code } });
    customerId =
      existing?.id ??
      (
        await db.customer.create({
          data: { name: input.customerName, code },
        })
      ).id;
  }

  const duplicate = await db.site.findUnique({
    where: {
      customerId_siteNumber: { customerId, siteNumber: input.siteNumber },
    },
    select: { id: true },
  });
  if (duplicate) return { ok: true, id: duplicate.id };

  const site = await db.site.create({
    data: {
      customerId,
      siteNumber: input.siteNumber,
      addressLine1: input.addressLine1 ?? "",
      city: input.city ?? "",
      state: input.state ?? "",
      postalCode: input.postalCode ?? "",
    },
  });

  await recordAudit({
    actorId: actor.id,
    entityType: "Site",
    entityId: site.id,
    action: "created",
    detail: { siteNumber: site.siteNumber, city: site.city },
  });

  revalidatePath("/jobs/new");
  return { ok: true, id: site.id };
}
