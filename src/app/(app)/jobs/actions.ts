"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { recordAudit } from "@/lib/audit";
import { syncJobInBackground } from "@/lib/calendar/sync";
import { getCompanySettings } from "@/lib/company";
import { parseDatetimeLocalInZone } from "@/lib/datetime";
import { db } from "@/lib/db";
import { ruleSheet } from "@/lib/deliverables";
import { flag, optionalText } from "@/lib/form";
import { copyTemplateToJob, storeDocument } from "@/lib/job-documents";
import {
  allocateIntWo,
  allocateRevisitIntWo,
  revisitAssignmentId,
} from "@/lib/int-wo";
import { notify } from "@/lib/notifications";
import { resolvePayRate } from "@/lib/pay-rates";
import { formatPhone } from "@/lib/phone";
import { REVISIT_CARRIES, type RevisitCarry } from "@/lib/revisit";
import { canOnJob, resolveJobSupervisor } from "@/lib/scope";
import { timeZoneForZip } from "@/lib/us-regions";
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

  // What the job will have to produce. The checklist on the form starts from
  // the project's sheet, so an untouched one means "as the project says" —
  // which is the project's own rows, not an empty list.
  const jobRules = (
    input.deliverableRules
      ? ruleSheet(input.deliverableRules)
      : project && project.deliverableRules.length > 0
        ? ruleSheet(project.deliverableRules)
        : // Nothing chosen and no project sheet to copy: no rows, so the job
          // keeps following the ad-hoc defaults.
          []
  ).map((rule) => ({
    category: rule.category,
    customLabel: rule.category === "CUSTOM" ? rule.customLabel : null,
    enabled: rule.enabled,
    required: rule.enabled && rule.required,
    requiresPhoto: rule.requiresPhoto,
    requiresText: rule.requiresText,
    order: rule.order,
  }));

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
        // The job carries its own copy from the start, so later edits to the
        // project cannot silently change what work already scheduled demands.
        // The planner's own choices win where they made any; otherwise it is
        // the project's sheet, and a job with no project keeps the ad-hoc
        // defaults by having no rows at all.
        deliverableRules:
          jobRules.length > 0 ? { create: jobRules } : undefined,
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
      // Normalised where it is stored, like every other phone on the record.
      phone: formatPhone(input.dispatchPhone[index] ?? "") || null,
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
  /** Who is going back. Ticked from the original crew, and editable. */
  crewIds: z.array(z.string()).default([]),
  leadId: optionalText,
  /**
   * Which parts of the original this one starts from.
   *
   * A list rather than a flag per field, so adding something that can be
   * carried is one name in REVISIT_CARRIES and one checkbox, not a schema
   * change and a migration.
   */
  carry: z.array(z.enum(REVISIT_CARRIES)).default([]),
  /** Fresh resolution, or the rate each person was actually on last time. */
  rates: z.enum(["fresh", "keep"]).default("fresh"),
});

export async function createRevisit(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requirePermission("job.create");

  const parsed = revisitSchema.safeParse({
    ...Object.fromEntries(formData),
    crewIds: formData.getAll("crewIds").map(String).filter(Boolean),
    carry: formData.getAll("carry").map(String).filter(Boolean),
  });
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
      payType: true,
      payRate: true,
      travelReimbursement: true,
      pmContactId: true,
      site: { select: { timeZone: true } },
      extraTickets: {
        orderBy: { order: "asc" },
        select: { number: true, order: true },
      },
      dispatchContacts: {
        orderBy: { order: "asc" },
        select: {
          label: true,
          name: true,
          phone: true,
          email: true,
          note: true,
          order: true,
        },
      },
      // The blank itself is not copied across — two jobs pointing at one file
      // is how deleting the first breaks the second. What is carried is which
      // company blank it came from, and a fresh copy is taken from that.
      documents: {
        where: { jobDocumentKind: "SIGN_OFF", sourceTemplateId: { not: null } },
        select: { sourceTemplateId: true },
      },
      createdById: true,
      project: { select: { managerId: true } },
      // Who worked it, so the same people can be sent back without being
      // looked up and re-added by hand.
      assignments: {
        select: {
          userId: true,
          isLead: true,
          supervisorId: true,
          payType: true,
          payRate: true,
          payRateNote: true,
          payOverridden: true,
          travelReimbursement: true,
          user: { select: { name: true, directSupervisorId: true } },
        },
      },
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

  // Holding job.create is not the question — the question is whether this
  // person may act on THIS job. The page asks it before rendering the form,
  // but the action is directly postable with any parentJobId, and it copies
  // pay rates, copies the coordinator's phone and email, creates crew
  // assignments and moves the parent out of the revisit queue. Asked here too,
  // against the parent, the same way the page asks it.
  const mayRevisit =
    (await canOnJob(actor, "job.view", {
      projectId: parent.projectId,
      assigneeIds: parent.assignments.map((entry) => entry.userId),
      createdById: parent.createdById,
    })) &&
    (actor.baseRole === "MANAGER" ||
      actor.baseRole === "ADMINISTRATOR" ||
      parent.project?.managerId === actor.id ||
      parent.assignments.some(
        (entry) =>
          entry.supervisorId === actor.id ||
          entry.user.directSupervisorId === actor.id,
      ));
  if (!mayRevisit) {
    return { ok: false, error: "You cannot schedule a revisit of that job." };
  }

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

  // Who is going back.
  //
  // A revisit used to be created with nobody on it. Everything else was
  // carried over — the site, the numbers, the scope, the deliverable sheet —
  // so it read as the same job, and then the person who was told to go back
  // could not clock in on it, because as far as the record was concerned they
  // were not on the job at all. A tech cannot see a job they are not on
  // either, so it did not even fail loudly; it just was not there.
  const carries = new Set<RevisitCarry>(input.carry);
  const wanted = new Set(input.crewIds);
  const crew = parent.assignments.filter((entry) => wanted.has(entry.userId));

  if (crew.length > 0 && !can(actor, "job.assign")) {
    return { ok: false, error: "You cannot assign techs to a job." };
  }

  const carried = await Promise.all(
    crew.map(async (entry) => {
      const supervisorId = await resolveJobSupervisor(
        entry.userId,
        parent.projectId,
      );

      // A rate somebody was deliberately put on — a trainee, a favour — is a
      // decision about that person and travels with them whatever else was
      // chosen. Beyond that it is the planner's call: resolve afresh, because
      // a revisit is a new job and last month's rate may not be what they are
      // on now, or keep exactly what they were paid last time.
      if (entry.payOverridden || input.rates === "keep") {
        return {
          userId: entry.userId,
          supervisorId,
          payType: entry.payType,
          payRate: entry.payRate.toString(),
          // The exception flag is theirs, not this form's: it means "leave
          // this person alone when the job's pay is set", and carrying a rate
          // forward is not the same claim.
          payOverridden: entry.payOverridden,
          payRateNote:
            entry.payRateNote ??
            (entry.payOverridden ? null : "Carried from the original visit"),
          travelReimbursement: entry.travelReimbursement?.toString() ?? null,
        };
      }

      const resolved = await resolvePayRate(
        entry.userId,
        parent.projectId,
        parent.clientId,
      );
      return {
        userId: entry.userId,
        supervisorId,
        payType: resolved.payType,
        payRate: resolved.rate,
        payRateNote:
          resolved.source === "none"
            ? "No rate configured — defaulted to non-billable"
            : null,
        payOverridden: false,
        travelReimbursement: resolved.travelReimbursement ?? null,
      };
    }),
  );

  // Whoever led it last time keeps it, unless the planner said otherwise or
  // that person is not among those going back.
  const leadId =
    input.leadId && wanted.has(input.leadId)
      ? input.leadId
      : (crew.find((entry) => entry.isLead)?.userId ?? crew[0]?.userId ?? null);

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
        ticketNumber: carries.has("tickets") ? parent.ticketNumber : null,
        incNumber: carries.has("tickets") ? parent.incNumber : null,
        extraTickets:
          carries.has("tickets") && parent.extraTickets.length > 0
            ? { create: parent.extraTickets.map((row) => ({ ...row })) }
            : undefined,
        scheduledStart,
        estimateMinutes: carries.has("estimate")
          ? parent.estimateMinutes
          : null,
        techsRequired: carries.has("estimate") ? parent.techsRequired : 1,
        scopeOfWork: carries.has("scope") ? parent.scopeOfWork : null,
        // The break rule travels with pay, being the same kind of decision.
        // Unticked, the revisit falls back to what the project says, which is
        // where a job with nobody's opinion on it should start.
        breakPaid: carries.has("pay") ? parent.breakPaid : true,
        payType: carries.has("pay") ? parent.payType : null,
        payRate: carries.has("pay") ? parent.payRate : null,
        travelReimbursement: carries.has("pay")
          ? parent.travelReimbursement
          : null,
        pmContactId: carries.has("dispatch") ? parent.pmContactId : null,
        dispatchContacts:
          carries.has("dispatch") && parent.dispatchContacts.length > 0
            ? { create: parent.dispatchContacts.map((row) => ({ ...row })) }
            : undefined,
        lifecycle: scheduledStart ? "SCHEDULED" : "DRAFT",
        createdById: actor.id,
        assignments:
          carried.length > 0
            ? {
                create: carried.map((entry) => ({
                  userId: entry.userId,
                  supervisorId: entry.supervisorId,
                  isLead: entry.userId === leadId,
                  payType: entry.payType,
                  payRate: entry.payRate,
                  payRateNote: entry.payRateNote,
                  payOverridden: entry.payOverridden,
                  travelReimbursement: entry.travelReimbursement,
                })),
              }
            : undefined,
        // Unticked leaves the revisit with no rows of its own, which is how a
        // job says "whatever the project asks for" rather than "nothing".
        deliverableRules:
          carries.has("deliverables") && parent.deliverableRules.length > 0
            ? {
                create: parent.deliverableRules.map((rule) => ({
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
      },
      select: { id: true, intWoId: true },
    });
  });

  // Their sign-off blank, taken fresh from the company template the original
  // used rather than pointed at the original's own file.
  if (carries.has("signOff")) {
    const templateIds = Array.from(
      new Set(
        parent.documents
          .map((document) => document.sourceTemplateId)
          .filter((id): id is string => Boolean(id)),
      ),
    );
    const allowed = await db.clientDocumentTemplate.findMany({
      where: { id: { in: templateIds }, clientId: parent.clientId },
      select: { id: true },
    });
    for (const template of allowed) {
      await copyTemplateToJob(template.id, job.id, actor.id);
    }
  }

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

  // The flag was a request for exactly this, and it has now been answered. A
  // queue that only ever grows is one people stop opening, so booking the
  // return trip is what takes the job back out of it.
  await db.job.updateMany({
    where: { id: parent.id, internalStatus: "REVISIT_REQUIRED" },
    data: { internalStatus: "RESCHEDULED" },
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

/**
 * Whether this person may sign off this particular job.
 *
 * Holding job.approve_report is not the question — a supervisor holds it at
 * project scope, and the id in a form is whatever was posted. Both approvals
 * below go through here so that reach is checked against the job in hand.
 */
async function approverFor(jobId: string) {
  const actor = await requirePermission("job.approve_report");

  const job = await db.job.findUnique({
    where: { id: jobId },
    select: {
      lifecycle: true,
      scheduledStart: true,
      projectId: true,
      createdById: true,
      assignments: { select: { userId: true } },
    },
  });
  if (!job) return { ok: false, error: "Job not found" } as const;

  const allowed = await canOnJob(actor, "job.approve_report", {
    projectId: job.projectId,
    assigneeIds: job.assignments.map((assignment) => assignment.userId),
    createdById: job.createdById,
  });
  if (!allowed) {
    return { ok: false, error: "This job is not yours to approve." } as const;
  }

  return { ok: true, actor, job } as const;
}

export async function approveJob(formData: FormData): Promise<ActionResult> {
  const jobId = String(formData.get("jobId") ?? "");
  if (!jobId) return { ok: false, error: "Missing job" };

  const found = await approverFor(jobId);
  if (!found.ok) return { ok: false, error: found.error };
  const { actor, job } = found;

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

  // It was raised by somebody who could not approve it, so its crew were put
  // on a job that had no standing. Now it has one, and their calendars should
  // agree.
  syncJobInBackground(jobId);

  revalidatePath("/jobs");
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/approvals");
  return { ok: true };
}

/**
 * The final read-through: the job is finished and the report stands.
 *
 * Checking out puts a job in PENDING_REVIEW and, until now, nothing took it
 * out again — every job the company had ever finished sat waiting on a button
 * that did not exist. This is that button.
 *
 * It is deliberately not a second gate on the work: checkout already refused
 * to finish without what the job asked for. What a reviewer is saying here is
 * "this is what we send the client and what we pay against". Anything they
 * disagree with, they can still change on the page before signing it off —
 * they hold the rights to — and the timeline records both.
 *
 * Approving your own job is allowed. The alternative deadlocks the case this
 * company actually has: a manager who is also on the crew, whose reports would
 * otherwise wait forever on somebody senior to them who does not exist. Who
 * signed it off is recorded either way, which is the part that matters.
 */
export async function approveReport(formData: FormData): Promise<ActionResult> {
  const jobId = String(formData.get("jobId") ?? "");
  if (!jobId) return { ok: false, error: "Missing job" };

  const found = await approverFor(jobId);
  if (!found.ok) return { ok: false, error: found.error };
  const { actor, job } = found;

  if (job.lifecycle !== "PENDING_REVIEW") {
    return {
      ok: false,
      error:
        job.lifecycle === "APPROVED"
          ? "This report has already been approved."
          : "This job has not been checked out yet.",
    };
  }

  await db.job.update({
    where: { id: jobId },
    data: {
      lifecycle: "APPROVED",
      approvedById: actor.id,
      approvedAt: new Date(),
    },
  });

  await recordAudit({
    actorId: actor.id,
    entityType: "Job",
    entityId: jobId,
    jobId,
    action: "report_approved",
  });

  // The crew are told, because it happened rather than because they must do
  // anything: their week can be run once the jobs in it are signed off, and
  // "still waiting on my supervisor" is otherwise invisible to them.
  for (const assignment of job.assignments) {
    await notify({
      userId: assignment.userId,
      actorId: actor.id,
      kind: "report_approved",
      title: "Report approved",
      href: `/jobs/${jobId}`,
      jobId,
    });
  }

  revalidatePath("/jobs");
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/approvals");
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
      // The ZIP already says which clock this place is on, and a site left on
      // the company default shows a Dallas job in Los Angeles time — wrong in
      // a way nobody sees until payroll.
      timeZone: timeZoneForZip(input.postalCode),
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
