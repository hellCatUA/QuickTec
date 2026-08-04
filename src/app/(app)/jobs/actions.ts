"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { recordAudit } from "@/lib/audit";
import { syncJobInBackground } from "@/lib/calendar/sync";
import { getCompanySettings } from "@/lib/company";
import { parseDatetimeLocalInZone } from "@/lib/datetime";
import { db } from "@/lib/db";
import { flag, optionalText } from "@/lib/form";
import { copyTemplateToJob, storeDocument } from "@/lib/job-documents";
import {
  allocateIntWo,
  allocateRevisitIntWo,
  revisitAssignmentId,
} from "@/lib/int-wo";
import { resolvePayRate } from "@/lib/pay-rates";
import { resolveJobSupervisor } from "@/lib/scope";
import { can, requirePermission } from "@/lib/session";
import { PayType } from "@prisma-client";
import { jobFormSchema } from "./schema";

export type ActionResult =
  | { ok: true; id?: string; warning?: string }
  | { ok: false; error: string };

/** quickCreateSite also hands back the customer code, so the picker can label
 *  the row it has just added without another round trip. */
export type SiteResult =
  | { ok: true; id: string; customerCode: string }
  | { ok: false; error: string };



export async function createJob(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requirePermission("job.create");

  const parsed = jobFormSchema.safeParse({
    ...Object.fromEntries(formData),
    assigneeIds: formData.getAll("assigneeIds").map(String).filter(Boolean),
    templateIds: formData.getAll("templateIds").map(String).filter(Boolean),
    extraTickets: formData.getAll("extraTickets").map(String),
    dispatchLabel: formData.getAll("dispatchLabel").map(String),
    dispatchName: formData.getAll("dispatchName").map(String),
    dispatchPhone: formData.getAll("dispatchPhone").map(String),
    dispatchEmail: formData.getAll("dispatchEmail").map(String),
    dispatchNote: formData.getAll("dispatchNote").map(String),
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
          defaultJobTitle: true,
          pmContactId: true,
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

  // A datetime-local input submits site-local wall time with no offset, so
  // `new Date` of it would be read in the server's zone — UTC in the
  // container — and the job would land hours from where it was planned.
  const scheduledStart = input.scheduledStart
    ? parseDatetimeLocalInZone(input.scheduledStart, timeZone)
    : null;
  if (input.scheduledStart && !scheduledStart) {
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

  if (input.payType && !(input.payType in PayType)) {
    return { ok: false, error: "Unknown pay type." };
  }
  // A rate with no type is a number nobody can interpret; a type with no rate
  // pays zero without saying so.
  if (Boolean(input.payType) !== Boolean(input.payRate)) {
    return {
      ok: false,
      error: "Set both the pay type and the rate for this job, or neither.",
    };
  }
  if ((input.payType || input.travelReimbursement) && !can(actor, "pay.edit_rates")) {
    return { ok: false, error: "You cannot set pay on a job." };
  }

  const rates = await Promise.all(
    assigneeIds.map(async (userId) => {
      const resolved = await resolvePayRate(
        userId,
        project?.id ?? null,
        input.clientId,
      );
      const supervisorId = await resolveJobSupervisor(
        userId,
        project?.id ?? null,
      );

      // Blank leaves the usual chain alone — each tech's own rate, then the
      // project's. A value here is a decision about this job and overrides
      // both, which is the case the field exists for.
      if (!input.payType) return { userId, rate: resolved, supervisorId };

      return {
        userId,
        supervisorId,
        rate: {
          ...resolved,
          payType: input.payType as PayType,
          rate: input.payRate!,
          source: "job" as const,
        },
      };
    }),
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
        // Whoever the coordinator is right now. Copied rather than looked up
        // through the project, so a handover later leaves the jobs already
        // planned under the person who actually ran them.
        pmContactId: project?.pmContactId ?? null,
        customerId: site.customerId,
        siteId: input.siteId,
        projectId: project?.id ?? null,
        externalAssignmentId: input.externalAssignmentId,
        ticketNumber: input.ticketNumber,
        // Anything typed after the first, in order. Blank rows are somebody
        // pressing the plus and changing their mind.
        extraTickets: {
          create: input.extraTickets
            .map((number) => number.trim())
            .filter(Boolean)
            .map((number, order) => ({ number, order })),
        },
        incNumber: input.incNumber,
        scheduledStart,
        estimateMinutes: input.estimateMinutes,
        techsRequired: input.techsRequired ?? 1,
        scopeOfWork: input.scopeOfWork,
        // The project supplies the default; the planner can still overrule it
        // for this job, which is a real case — a long day where breaks are
        // covered on work that normally does not.
        breakPaid: input.breakPaid,
        // On the job, so somebody assigned tomorrow gets the same decision.
        payType: (input.payType as PayType | null) ?? null,
        payRate: input.payRate,
        travelReimbursement: input.travelReimbursement,
        noWorkOrder: input.noWorkOrder,
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
              rate.source === "job"
                ? "Set on this job"
                : rate.source === "none"
                  ? "No rate configured — defaulted to non-billable"
                  : null,
            travelReimbursement:
              input.travelReimbursement ??
              rate.travelReimbursement ??
              project?.travelReimbursement?.toString() ??
              null,
          })),
        },
      },
      select: { id: true, intWoId: true },
    });
  });

  // Numbers for this job alone. The project's own travel with every job under
  // it and are not copied here — two rows saying the same thing is how one of
  // them ends up stale.
  const dispatch = input.dispatchLabel
    .map((label, index) => ({
      label: label.trim(),
      name: input.dispatchName[index]?.trim() || null,
      phone: input.dispatchPhone[index]?.trim() || null,
      email: input.dispatchEmail[index]?.trim() || null,
      note: input.dispatchNote[index]?.trim() || null,
      order: index,
    }))
    .filter((contact) => contact.label !== "");

  if (dispatch.length > 0) {
    await db.dispatchContact.createMany({
      data: dispatch.map((contact) => ({ ...contact, jobId: job.id })),
    });
  }

  // The company's standing blanks come across as copies, so replacing a
  // template next year cannot change what a job that ran this year went out on.
  if (input.templateIds.length > 0) {
    const allowed = await db.clientDocumentTemplate.findMany({
      where: { id: { in: input.templateIds }, clientId: input.clientId },
      select: { id: true },
    });
    for (const template of allowed) {
      await copyTemplateToJob(template.id, job.id, actor.id);
    }
  }

  // Paperwork the planner is holding right now. The work order often arrives
  // by email the evening before, and making them raise the job and then go
  // back into it to attach the PDF is how it ends up attached by nobody.
  //
  // A file that will not store does not undo the job — it exists, it is
  // scheduled, and the same upload is on its page waiting to be retried.
  const documentUploads: [string, "CLIENT_WORK_ORDER" | "SIGN_OFF"][] = [
    ["workOrderFiles", "CLIENT_WORK_ORDER"],
    ["signOffFiles", "SIGN_OFF"],
  ];
  const uploadFailures: string[] = [];

  for (const [field, kind] of documentUploads) {
    const files = formData
      .getAll(field)
      .filter((entry): entry is File => entry instanceof File && entry.size > 0);

    for (const file of files) {
      const stored = await storeDocument(file, actor.id, job.id);
      if ("error" in stored) {
        uploadFailures.push(`${file.name}: ${stored.error}`);
        continue;
      }
      await db.attachment.update({
        where: { id: stored.id },
        data: { jobDocumentId: job.id, jobDocumentKind: kind },
      });
    }
  }

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
  // Said rather than swallowed: the job is real either way, and somebody has
  // to know the PDF they picked is not on it.
  return uploadFailures.length > 0
    ? { ok: true, id: job.id, warning: `The job was created, but its paperwork was not attached — ${uploadFailures.join("; ")}` }
    : { ok: true, id: job.id };
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

  // A datetime-local input submits site-local wall time with no offset, so
  // `new Date` of it would be read in the server's zone — UTC in the
  // container — and the job would land hours from where it was planned.
  const scheduledStart = input.scheduledStart
    ? parseDatetimeLocalInZone(input.scheduledStart, timeZone)
    : null;
  if (input.scheduledStart && !scheduledStart) {
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
  siteNumber: optionalText,
  /// The number is not known yet; a placeholder stands in until somebody on
  /// the door replaces it.
  numberPending: flag,
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
  _prev: SiteResult | null,
  formData: FormData,
): Promise<SiteResult> {
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

  if (!input.numberPending && !input.siteNumber) {
    return { ok: false, error: "Enter the site number, or add it without one." };
  }

  if (input.siteNumber) {
    const duplicate = await db.site.findUnique({
      where: {
        customerId_siteNumber: { customerId, siteNumber: input.siteNumber },
      },
      select: { id: true, customer: { select: { code: true } } },
    });
    if (duplicate) {
      return { ok: true, id: duplicate.id, customerCode: duplicate.customer.code };
    }
  }

  // A pending site gets a placeholder rather than an empty string: the number
  // is half of a site's identity and two blanks would collide on the unique
  // key, merging two jobs onto one site that is neither of them.
  const siteNumber = input.siteNumber ?? `TBD-${randomUUID().slice(0, 8)}`;

  const site = await db.site.create({
    data: {
      customerId,
      siteNumber,
      numberPending: input.numberPending,
      addressLine1: input.addressLine1 ?? "",
      city: input.city ?? "",
      state: input.state ?? "",
      postalCode: input.postalCode ?? "",
    },
    select: { id: true, siteNumber: true, city: true, customer: { select: { code: true } } },
  });

  await recordAudit({
    actorId: actor.id,
    entityType: "Site",
    entityId: site.id,
    action: "created",
    detail: { siteNumber: site.siteNumber, city: site.city },
  });

  revalidatePath("/jobs/new");
  return { ok: true, id: site.id, customerCode: site.customer.code };
}
