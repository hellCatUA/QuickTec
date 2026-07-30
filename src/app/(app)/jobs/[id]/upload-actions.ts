"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { recordAudit } from "@/lib/audit";
import { getCompanySettings } from "@/lib/company";
import { isoDateInZone } from "@/lib/datetime";
import { db } from "@/lib/db";
import { deliverableLabel } from "@/lib/deliverables";
import { processImage, processSignature, watermarkText } from "@/lib/images";
import { canOnJob } from "@/lib/scope";
import { getSessionUser, type SessionUser } from "@/lib/session";
import { deleteFile, storeFile } from "@/lib/storage";
import {
  DeliverableCategory,
  ReimbursementType,
  SignatureKind,
} from "@prisma-client";

export type ActionResult = { ok: true; id?: string } | { ok: false; error: string };

const ok = (id?: string): ActionResult => ({ ok: true, id });
const fail = (error: string): ActionResult => ({ ok: false, error });

/** 20 MB. A 48-megapixel HEIC is about 5 MB, so this leaves plenty of room. */
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

type JobForUpload = {
  id: string;
  projectId: string | null;
  createdById: string;
  assigneeIds: string[];
  customerCode: string;
  siteNumber: string;
  externalAssignmentId: string | null;
  timeZone: string;
  firstClockIn: Date | null;
};

async function loadJob(jobId: string): Promise<JobForUpload | null> {
  const job = await db.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      projectId: true,
      createdById: true,
      externalAssignmentId: true,
      customer: { select: { code: true } },
      site: { select: { siteNumber: true, timeZone: true } },
      assignments: {
        select: {
          userId: true,
          visits: {
            orderBy: { clockInAt: "asc" },
            take: 1,
            select: { clockInAt: true },
          },
        },
      },
    },
  });
  if (!job) return null;

  const company = await getCompanySettings();
  const clockIns = job.assignments
    .flatMap((assignment) => assignment.visits)
    .map((visit) => visit.clockInAt);

  return {
    id: job.id,
    projectId: job.projectId,
    createdById: job.createdById,
    assigneeIds: job.assignments.map((assignment) => assignment.userId),
    customerCode: job.customer.code,
    siteNumber: job.site.siteNumber,
    externalAssignmentId: job.externalAssignmentId,
    timeZone: job.site.timeZone ?? company.defaultTimeZone,
    firstClockIn:
      clockIns.length > 0
        ? new Date(Math.min(...clockIns.map((date) => date.getTime())))
        : null,
  };
}

async function requireUpload(
  jobId: string,
): Promise<{ user: SessionUser; job: JobForUpload } | { error: string }> {
  const user = await getSessionUser();
  if (!user) return { error: "Not signed in." };

  const job = await loadJob(jobId);
  if (!job) return { error: "Job not found." };

  if (!(await canOnJob(user, "deliverable.upload", job))) {
    return { error: "You cannot upload to this job." };
  }

  return { user, job };
}

/**
 * Runs a photo through the pipeline and writes it.
 *
 * The stamp uses the crew's first clock-in rather than today, so a photo
 * uploaded the morning after a late finish still carries the date the work
 * actually happened.
 */
async function storeUpload(
  job: JobForUpload,
  user: SessionUser,
  file: File,
  options: { watermark: boolean },
): Promise<{ attachmentId: string } | { error: string }> {
  if (file.size === 0) return { error: "That file is empty." };
  if (file.size > MAX_UPLOAD_BYTES) {
    return { error: "That file is larger than 20 MB." };
  }

  const input = Buffer.from(await file.arrayBuffer());
  const company = await getCompanySettings();

  const stamp =
    options.watermark && company.watermarkEnabled
      ? watermarkText({
          date: isoDateInZone(job.firstClockIn ?? new Date(), job.timeZone),
          assignmentId: job.externalAssignmentId,
          customerCode: job.customerCode,
          siteNumber: job.siteNumber,
        })
      : null;

  let processed;
  try {
    processed = await processImage(input, file.type, stamp);
  } catch {
    return {
      error:
        "That file could not be read as a photo or PDF. Try taking the picture again.",
    };
  }

  const stored = await storeFile(job.id, processed.data, processed.mimeType);

  const attachment = await db.attachment.create({
    data: {
      storagePath: stored.storagePath,
      originalName: file.name || "upload",
      mimeType: processed.mimeType,
      sizeBytes: stored.sizeBytes,
      width: processed.width,
      height: processed.height,
      capturedAt: processed.capturedAt,
      gpsLat: processed.gpsLat,
      gpsLng: processed.gpsLng,
      watermarked: processed.watermarked,
      uploadedById: user.id,
    },
    select: { id: true },
  });

  return { attachmentId: attachment.id };
}

function touch(jobId: string) {
  revalidatePath(`/jobs/${jobId}`);
}

// ---------------------------------------------------------------------------
// Deliverables
// ---------------------------------------------------------------------------

const deliverableSchema = z.object({
  jobId: z.string().min(1),
  category: z.enum(DeliverableCategory),
  customLabel: z.string().trim().max(80).optional(),
  textValue: z.string().trim().max(4000).optional(),
});

export async function saveDeliverable(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = deliverableSchema.safeParse({
    jobId: formData.get("jobId"),
    category: formData.get("category"),
    customLabel: formData.get("customLabel") ?? undefined,
    textValue: formData.get("textValue") ?? undefined,
  });
  if (!parsed.success) return fail(z.prettifyError(parsed.error));

  const context = await requireUpload(parsed.data.jobId);
  if ("error" in context) return fail(context.error);
  const { user, job } = context;

  const { category, customLabel, textValue } = parsed.data;
  if (category === "CUSTOM" && !customLabel) {
    return fail("Give the custom section a name.");
  }

  const files = formData
    .getAll("files")
    .filter((entry): entry is File => entry instanceof File && entry.size > 0);

  if (files.length === 0 && !textValue) {
    return fail("Add a photo or some text.");
  }

  if (files.length > 0) {
    const company = await getCompanySettings();
    const existing = await db.attachment.count({
      where: { deliverableItem: { jobId: job.id } },
    });
    if (existing + files.length > company.maxPhotosPerJob) {
      return fail(
        `That would take this job past ${company.maxPhotosPerJob} photos. Remove some first.`,
      );
    }
  }

  const assignment = await db.jobAssignment.findUnique({
    where: { jobId_userId: { jobId: job.id, userId: user.id } },
    select: { id: true },
  });

  // Deliverables are attributed per tech so the ZIP can be foldered by
  // category and then by who took the photos.
  const item = await db.deliverableItem.create({
    data: {
      jobId: job.id,
      assignmentId: assignment?.id ?? null,
      category,
      customLabel: customLabel || null,
      textValue: textValue || null,
    },
    select: { id: true },
  });

  const failures: string[] = [];
  for (const file of files) {
    const result = await storeUpload(job, user, file, { watermark: true });
    if ("error" in result) {
      failures.push(`${file.name}: ${result.error}`);
      continue;
    }
    await db.attachment.update({
      where: { id: result.attachmentId },
      data: { deliverableItemId: item.id },
    });
  }

  // An item with neither photos nor text is noise; drop it rather than leave
  // an empty row in the report.
  const stored = await db.attachment.count({
    where: { deliverableItemId: item.id },
  });
  if (stored === 0 && !textValue) {
    await db.deliverableItem.delete({ where: { id: item.id } });
    return fail(failures.join("; ") || "Nothing was saved.");
  }

  await recordAudit({
    actorId: user.id,
    entityType: "DeliverableItem",
    entityId: item.id,
    jobId: job.id,
    action: "deliverable_added",
    detail: {
      category,
      label: deliverableLabel(category, customLabel),
      photos: stored,
    },
  });

  touch(job.id);
  return failures.length > 0 ? fail(failures.join("; ")) : ok(item.id);
}

export async function deleteDeliverableItem(
  formData: FormData,
): Promise<ActionResult> {
  const id = String(formData.get("id") ?? "");

  const item = await db.deliverableItem.findUnique({
    where: { id },
    select: {
      jobId: true,
      category: true,
      customLabel: true,
      assignment: { select: { userId: true } },
      attachments: { select: { id: true, storagePath: true } },
    },
  });
  if (!item) return fail("Not found.");

  const user = await getSessionUser();
  if (!user) return fail("Not signed in.");

  const job = await loadJob(item.jobId);
  if (!job) return fail("Job not found.");

  // A tech may clear up their own upload; removing someone else's needs the
  // wider permission.
  const isOwn = item.assignment?.userId === user.id;
  const allowed = isOwn
    ? await canOnJob(user, "deliverable.delete", job)
    : await canOnJob(user, "deliverable.delete", job) &&
      (await canOnJob(user, "job.approve_report", job));

  if (!allowed) return fail("You cannot remove this.");

  for (const attachment of item.attachments) {
    await deleteFile(attachment.storagePath);
  }
  await db.deliverableItem.delete({ where: { id } });

  await recordAudit({
    actorId: user.id,
    entityType: "DeliverableItem",
    entityId: id,
    jobId: item.jobId,
    action: "deliverable_removed",
    detail: { category: item.category },
  });

  touch(item.jobId);
  return ok();
}

// ---------------------------------------------------------------------------
// The representing company's work order
// ---------------------------------------------------------------------------

/**
 * Files the WO the representing company issued.
 *
 * It is the paperwork the whole job is answerable to — the scope, the site,
 * what was agreed — and until now it lived in somebody's inbox, which meant
 * the tech standing at the door could not read it. Several are allowed: a WO
 * gets revised, and the superseded one is still what somebody was told on the
 * day.
 *
 * Not a deliverable: deliverables are the crew's output and are foldered by
 * tech in the export. This is an input.
 */
export async function uploadWorkOrder(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const jobId = String(formData.get("jobId") ?? "");

  const user = await getSessionUser();
  if (!user) return fail("Not signed in.");

  const job = await loadJob(jobId);
  if (!job) return fail("Job not found.");

  // Whoever plans the job is who receives the WO. A tech may read it but not
  // replace it — the document is the record of what was agreed.
  if (!(await canOnJob(user, "job.edit_planned_fields", job))) {
    return fail("You cannot attach a work order to this job.");
  }

  const files = formData
    .getAll("files")
    .filter((entry): entry is File => entry instanceof File && entry.size > 0);
  if (files.length === 0) return fail("Choose a file first.");

  const failures: string[] = [];
  let stored = 0;

  for (const file of files) {
    // No watermark: this is their document, and stamping it would misrepresent
    // it as ours.
    const result = await storeUpload(job, user, file, { watermark: false });
    if ("error" in result) {
      failures.push(`${file.name}: ${result.error}`);
      continue;
    }
    await db.attachment.update({
      where: { id: result.attachmentId },
      data: { workOrderJobId: job.id },
    });
    stored++;
  }

  if (stored === 0) return fail(failures.join("; ") || "Nothing was saved.");

  await recordAudit({
    actorId: user.id,
    entityType: "Job",
    entityId: job.id,
    jobId: job.id,
    action: "work_order_attached",
    detail: { files: stored, name: files[0]?.name ?? null },
  });

  touch(job.id);
  return failures.length > 0 ? fail(failures.join("; ")) : ok();
}

export async function deleteWorkOrder(
  formData: FormData,
): Promise<ActionResult> {
  const id = String(formData.get("id") ?? "");

  const attachment = await db.attachment.findUnique({
    where: { id },
    select: { id: true, storagePath: true, originalName: true, workOrderJobId: true },
  });
  if (!attachment?.workOrderJobId) return fail("Not found.");

  const user = await getSessionUser();
  if (!user) return fail("Not signed in.");

  const job = await loadJob(attachment.workOrderJobId);
  if (!job) return fail("Job not found.");

  if (!(await canOnJob(user, "job.edit_planned_fields", job))) {
    return fail("You cannot remove this work order.");
  }

  await deleteFile(attachment.storagePath);
  await db.attachment.delete({ where: { id } });

  await recordAudit({
    actorId: user.id,
    entityType: "Job",
    entityId: job.id,
    jobId: job.id,
    action: "work_order_removed",
    detail: { name: attachment.originalName },
  });

  touch(job.id);
  return ok();
}

// ---------------------------------------------------------------------------
// Reimbursements
// ---------------------------------------------------------------------------

const reimbursementSchema = z.object({
  jobId: z.string().min(1),
  type: z.enum(ReimbursementType),
  label: z.string().trim().max(120).optional(),
  amount: z
    .string()
    .trim()
    .refine((value) => Number.isFinite(Number(value)) && Number(value) > 0, {
      message: "Enter an amount greater than zero",
    }),
  note: z.string().trim().max(500).optional(),
});

export async function saveReimbursement(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = reimbursementSchema.safeParse({
    jobId: formData.get("jobId"),
    type: formData.get("type"),
    label: formData.get("label") ?? undefined,
    amount: formData.get("amount") ?? "",
    note: formData.get("note") ?? undefined,
  });
  if (!parsed.success) return fail(z.prettifyError(parsed.error));

  const context = await requireUpload(parsed.data.jobId);
  if ("error" in context) return fail(context.error);
  const { user, job } = context;

  const { type, label, amount, note } = parsed.data;

  // Materials and hotels are named in the export; parking and tolls are
  // labelled by their type, so a name would be redundant.
  if ((type === "MATERIAL" || type === "HOTEL") && !label) {
    return fail(
      type === "MATERIAL" ? "Name the material." : "Name the hotel.",
    );
  }

  const files = formData
    .getAll("files")
    .filter((entry): entry is File => entry instanceof File && entry.size > 0);

  // A receipt is the evidence for the claim. Materials are the one case where
  // the photo is genuinely optional.
  if (type !== "MATERIAL" && files.length === 0) {
    return fail("A receipt photo is required for this claim.");
  }

  const reimbursement = await db.reimbursement.create({
    data: {
      jobId: job.id,
      assignmentId: (
        await db.jobAssignment.findUnique({
          where: { jobId_userId: { jobId: job.id, userId: user.id } },
          select: { id: true },
        })
      )?.id,
      type,
      label: label || null,
      amount,
      note: note || null,
    },
    select: { id: true },
  });

  for (const file of files) {
    const result = await storeUpload(job, user, file, { watermark: false });
    if ("error" in result) continue;
    await db.attachment.update({
      where: { id: result.attachmentId },
      data: { reimbursementId: reimbursement.id },
    });
  }

  await recordAudit({
    actorId: user.id,
    entityType: "Reimbursement",
    entityId: reimbursement.id,
    jobId: job.id,
    action: "reimbursement_added",
    detail: { type, label: label ?? null, amount },
  });

  touch(job.id);
  return ok(reimbursement.id);
}

export async function deleteReimbursement(
  formData: FormData,
): Promise<ActionResult> {
  const id = String(formData.get("id") ?? "");

  const reimbursement = await db.reimbursement.findUnique({
    where: { id },
    select: {
      jobId: true,
      type: true,
      assignment: { select: { userId: true } },
      attachments: { select: { storagePath: true } },
    },
  });
  if (!reimbursement) return fail("Not found.");

  const user = await getSessionUser();
  if (!user) return fail("Not signed in.");

  const job = await loadJob(reimbursement.jobId);
  if (!job) return fail("Job not found.");

  const isOwn = reimbursement.assignment?.userId === user.id;
  if (!isOwn && !(await canOnJob(user, "job.approve_report", job))) {
    return fail("You cannot remove someone else's claim.");
  }

  for (const attachment of reimbursement.attachments) {
    await deleteFile(attachment.storagePath);
  }
  await db.reimbursement.delete({ where: { id } });

  await recordAudit({
    actorId: user.id,
    entityType: "Reimbursement",
    entityId: id,
    jobId: reimbursement.jobId,
    action: "reimbursement_removed",
    detail: { type: reimbursement.type },
  });

  touch(reimbursement.jobId);
  return ok();
}

// ---------------------------------------------------------------------------
// Signatures
// ---------------------------------------------------------------------------

const signatureSchema = z.object({
  jobId: z.string().min(1),
  kind: z.enum(SignatureKind),
  signerName: z.string().trim().min(1, "Who is signing?"),
  pointOfContactId: z.string().optional(),
  skipped: z.string().optional(),
  skippedReason: z.string().trim().max(200).optional(),
  /** data:image/png;base64,… from the signature pad. */
  image: z.string().optional(),
});

export async function saveSignature(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = signatureSchema.safeParse({
    jobId: formData.get("jobId"),
    kind: formData.get("kind"),
    signerName: formData.get("signerName") ?? "",
    pointOfContactId: formData.get("pointOfContactId") ?? undefined,
    skipped: formData.get("skipped") ?? undefined,
    skippedReason: formData.get("skippedReason") ?? undefined,
    image: formData.get("image") ?? undefined,
  });
  if (!parsed.success) return fail(z.prettifyError(parsed.error));

  const context = await requireUpload(parsed.data.jobId);
  if ("error" in context) return fail(context.error);
  const { user, job } = context;

  const { kind, signerName, pointOfContactId, image } = parsed.data;
  const skipped = parsed.data.skipped === "true";

  const assignment = await db.jobAssignment.findUnique({
    where: { jobId_userId: { jobId: job.id, userId: user.id } },
    select: { id: true },
  });

  if (kind === "TECH" && !assignment) {
    return fail("Only an assigned tech can sign as the tech.");
  }

  let attachmentId: string | null = null;

  if (!skipped) {
    if (!image?.startsWith("data:image/png;base64,")) {
      return fail("No signature was captured.");
    }

    const raw = Buffer.from(image.split(",")[1] ?? "", "base64");
    if (raw.byteLength === 0) return fail("No signature was captured.");

    const processed = await processSignature(raw);
    const stored = await storeFile(job.id, processed.data, processed.mimeType);

    const attachment = await db.attachment.create({
      data: {
        storagePath: stored.storagePath,
        // Names the file the way the export expects it: MOD-Jane Doe-Signature
        originalName: `${kind}-${signerName}-Signature.png`,
        mimeType: processed.mimeType,
        sizeBytes: stored.sizeBytes,
        width: processed.width,
        height: processed.height,
        uploadedById: user.id,
      },
      select: { id: true },
    });
    attachmentId = attachment.id;
  }

  // Re-signing replaces rather than stacks: a second MOD signature for the
  // same person means the first attempt was wrong.
  const existing = await db.signature.findFirst({
    where: {
      jobId: job.id,
      kind,
      ...(kind === "TECH"
        ? { assignmentId: assignment?.id }
        : { pointOfContactId: pointOfContactId || null }),
    },
    select: { id: true, attachment: { select: { id: true, storagePath: true } } },
  });

  if (existing?.attachment) {
    await deleteFile(existing.attachment.storagePath);
    await db.attachment.delete({ where: { id: existing.attachment.id } });
  }

  const data = {
    jobId: job.id,
    kind,
    signerName,
    pointOfContactId: kind === "MOD" ? pointOfContactId || null : null,
    assignmentId: kind === "TECH" ? (assignment?.id ?? null) : null,
    attachmentId,
    skipped,
    skippedReason: skipped ? (parsed.data.skippedReason ?? null) : null,
    signedAt: skipped ? null : new Date(),
  };

  const signature = existing
    ? await db.signature.update({ where: { id: existing.id }, data })
    : await db.signature.create({ data });

  await recordAudit({
    actorId: user.id,
    entityType: "Signature",
    entityId: signature.id,
    jobId: job.id,
    action: skipped ? "signature_skipped" : "signature_captured",
    detail: { kind, signerName },
  });

  touch(job.id);
  return ok(signature.id);
}
