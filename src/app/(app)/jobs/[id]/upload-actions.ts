"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { recordAudit } from "@/lib/audit";
import { getCompanySettings } from "@/lib/company";
import { isoDateInZone } from "@/lib/datetime";
import { db } from "@/lib/db";
import { deliverableLabel } from "@/lib/deliverables";
import {
  isPdf,
  looksLikeImage,
  processImage,
  processSignature,
  watermarkText,
} from "@/lib/images";
import { DOCUMENT_LABELS, storeDocument } from "@/lib/job-documents";
import { canOnJob } from "@/lib/scope";
import { getSessionUser, type SessionUser } from "@/lib/session";
import { deleteFile, storeFile, storageErrorMessage } from "@/lib/storage";
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

/**
 * How many photos are processed at once.
 *
 * A tech selects the whole section's worth in one go, and one at a time made
 * six photos take six times as long while three cores sat idle. Bounded rather
 * than unbounded because each one holds its decoded pixels in memory for the
 * moment it is being worked on, and a phone can hand over twenty.
 */
const UPLOAD_CONCURRENCY = 3;

/**
 * Runs a job over each item, a few at a time, keeping the results in order.
 *
 * Order matters: the failures reported back name their file, and photos read
 * better in the order they were picked.
 */
async function inBatches<T, R>(
  items: T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let start = 0; start < items.length; start += limit) {
    results.push(
      ...(await Promise.all(items.slice(start, start + limit).map(run))),
    );
  }
  return results;
}

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
  } catch (error) {
    // Swallowing this is how "I cannot upload any photo" became unanswerable:
    // one message blamed the picture whatever had actually gone wrong, and
    // nothing was written down anywhere.
    console.error(
      `[upload] processing ${file.name || "a photo"} failed`,
      error,
    );

    // A file that is not a picture is the tech's to fix. Anything else is
    // ours, and telling them to retake the photo would send them back out for
    // nothing.
    if (!looksLikeImage(input) && !isPdf(file.type, input)) {
      return {
        error:
          "That file could not be read as a photo or PDF. Try taking the picture again.",
      };
    }

    return {
      error:
        "The photo reached the server but could not be processed there. This is not something retaking it will fix — send this to whoever runs the server, and check Photo pipeline under Settings → Integrations.",
    };
  }

  let stored;
  try {
    stored = await storeFile(job.id, processed.data, processed.mimeType);
  } catch (error) {
    console.error("[upload] storing a photo failed", error);
    return { error: storageErrorMessage(error) };
  }

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
  const results = await inBatches(files, UPLOAD_CONCURRENCY, (file) =>
    storeUpload(job, user, file, { watermark: true }),
  );

  for (const [index, result] of results.entries()) {
    if ("error" in result) {
      failures.push(`${files[index].name}: ${result.error}`);
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
// The representing company's paperwork
// ---------------------------------------------------------------------------

/**
 * Files the WO the company issued, or the sign-off blank the tech will get
 * signed.
 *
 * The WO is the paperwork the whole job is answerable to — the scope, the
 * site, what was agreed — and it used to live in somebody's inbox, which meant
 * the tech standing at the door could not read it. Several of each are
 * allowed: a WO gets revised, and the superseded one is still what somebody
 * was told on the day.
 *
 * Anyone on the job may attach one. The planner usually has the WO when they
 * raise the job, but often does not, and the tech who is sent the PDF at eight
 * in the morning is the only person who can put it where the crew will see it.
 * Removing somebody else's needs the wider permission.
 *
 * Not a deliverable: deliverables are the crew's output and are foldered by
 * tech in the export. This is an input.
 */
export async function uploadJobDocument(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const jobId = String(formData.get("jobId") ?? "");
  const kind = String(formData.get("kind") ?? "");
  if (kind !== "CLIENT_WORK_ORDER" && kind !== "SIGN_OFF") {
    return fail("Unknown document type.");
  }

  const context = await requireUpload(jobId);
  if ("error" in context) return fail(context.error);
  const { user, job } = context;

  const files = formData
    .getAll("files")
    .filter((entry): entry is File => entry instanceof File && entry.size > 0);
  if (files.length === 0) return fail("Choose a file first.");

  const failures: string[] = [];
  let stored = 0;

  const documents = await inBatches(files, UPLOAD_CONCURRENCY, (file) =>
    storeDocument(file, user.id, job.id),
  );

  for (const [index, result] of documents.entries()) {
    if ("error" in result) {
      failures.push(`${files[index].name}: ${result.error}`);
      continue;
    }
    await db.attachment.update({
      where: { id: result.id },
      data: { jobDocumentId: job.id, jobDocumentKind: kind },
    });
    stored++;
  }

  if (stored === 0) return fail(failures.join("; ") || "Nothing was saved.");

  // Attaching a work order answers the "there isn't one" flag.
  if (kind === "CLIENT_WORK_ORDER") {
    await db.job.updateMany({
      where: { id: job.id, noWorkOrder: true },
      data: { noWorkOrder: false },
    });
  }

  await recordAudit({
    actorId: user.id,
    entityType: "Job",
    entityId: job.id,
    jobId: job.id,
    action: "document_attached",
    detail: {
      field: DOCUMENT_LABELS[kind],
      files: stored,
      to: files[0]?.name ?? null,
    },
  });

  touch(job.id);
  return failures.length > 0 ? fail(failures.join("; ")) : ok();
}

export async function deleteJobDocument(
  formData: FormData,
): Promise<ActionResult> {
  const id = String(formData.get("id") ?? "");

  const attachment = await db.attachment.findUnique({
    where: { id },
    select: {
      id: true,
      storagePath: true,
      originalName: true,
      uploadedById: true,
      jobDocumentId: true,
      jobDocumentKind: true,
    },
  });
  if (!attachment?.jobDocumentId || !attachment.jobDocumentKind) {
    return fail("Not found.");
  }

  const user = await getSessionUser();
  if (!user) return fail("Not signed in.");

  const job = await loadJob(attachment.jobDocumentId);
  if (!job) return fail("Job not found.");

  // Clearing up your own upload is housekeeping; removing the WO somebody else
  // filed is a change to the record of the job.
  const isOwn = attachment.uploadedById === user.id;
  const allowed = isOwn
    ? await canOnJob(user, "deliverable.upload", job)
    : await canOnJob(user, "job.edit_planned_fields", job);
  if (!allowed) return fail("You cannot remove this document.");

  await deleteFile(attachment.storagePath);
  await db.attachment.delete({ where: { id } });

  await recordAudit({
    actorId: user.id,
    entityType: "Job",
    entityId: job.id,
    jobId: job.id,
    action: "document_removed",
    detail: {
      field: DOCUMENT_LABELS[attachment.jobDocumentKind],
      from: attachment.originalName,
    },
  });

  touch(job.id);
  return ok();
}

/**
 * Records that the representing company issued no work order.
 *
 * An empty slot and a deliberate "there isn't one" look identical on screen,
 * and the difference decides whether anybody chases it. Only somebody who can
 * change the planned fields may assert it; a tech who finds there is in fact a
 * WO clears it by attaching one.
 */
export async function setNoWorkOrder(
  formData: FormData,
): Promise<ActionResult> {
  const jobId = String(formData.get("jobId") ?? "");
  const none = String(formData.get("none") ?? "") === "true";

  const user = await getSessionUser();
  if (!user) return fail("Not signed in.");

  const job = await loadJob(jobId);
  if (!job) return fail("Job not found.");

  if (!(await canOnJob(user, "job.edit_planned_fields", job))) {
    return fail("You cannot change this.");
  }

  if (none) {
    const filed = await db.attachment.count({
      where: { jobDocumentId: jobId, jobDocumentKind: "CLIENT_WORK_ORDER" },
    });
    if (filed > 0) {
      return fail("There is a work order attached — remove it first.");
    }
  }

  await db.job.update({ where: { id: jobId }, data: { noWorkOrder: none } });

  await recordAudit({
    actorId: user.id,
    entityType: "Job",
    entityId: jobId,
    jobId,
    action: "field_edited",
    detail: {
      field: "Work order",
      from: none ? "expected" : "none issued",
      to: none ? "none issued" : "expected",
    },
  });

  touch(jobId);
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
