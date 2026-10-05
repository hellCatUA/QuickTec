"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { recordAudit } from "@/lib/audit";
import { getCompanySettings } from "@/lib/company";
import { isoDateInZone } from "@/lib/datetime";
import { db } from "@/lib/db";
import { deliverableLabel, MAX_LOCATION_NAME } from "@/lib/deliverables";
import { isLocationIcon } from "@/lib/location-icons";
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
  options: { watermark: boolean; exif?: Buffer | null },
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
    processed = await processImage(input, file.type, stamp, options.exif);
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
  // Return Labels holds one tracking number per line, and a browser sends
  // every line break in a form value as CRLF. The carriage returns nobody
  // typed reach the database and then the report, so they come off here.
  textValue: z
    .string()
    .max(4000)
    .transform((value) => value.replace(/\r\n?/g, "\n").trim())
    .optional(),
  /**
   * The section these photos join, when it already exists.
   *
   * Photos go up one request each: ten in one request is 35 MB that has to
   * arrive whole before anything happens, exceeds the request limit, shows no
   * progress, and loses all ten if the signal drops on the last one. One at a
   * time means the tech sees them land, and a failure costs one photo.
   */
  itemId: z.string().optional(),
  /** Where on site, for a section photographed at each location. */
  locationId: z.string().optional(),
});

/**
 * The location, if it is one of this job's. The id comes from the browser, and
 * a location on somebody else's job is not somewhere this job's photos go.
 */
async function jobLocation(
  jobId: string,
  locationId: string | undefined,
): Promise<{ id: string; name: string } | null | "unknown"> {
  if (!locationId) return null;
  const location = await db.jobLocation.findFirst({
    where: { id: locationId, jobId },
    select: { id: true, name: true },
  });
  return location ?? "unknown";
}

export async function saveDeliverable(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = deliverableSchema.safeParse({
    jobId: formData.get("jobId"),
    category: formData.get("category"),
    customLabel: formData.get("customLabel") ?? undefined,
    textValue: formData.get("textValue") ?? undefined,
    itemId: formData.get("itemId") ?? undefined,
    locationId: formData.get("locationId") || undefined,
  });
  if (!parsed.success) return fail(z.prettifyError(parsed.error));

  const context = await requireUpload(parsed.data.jobId);
  if ("error" in context) return fail(context.error);
  const { user, job } = context;

  const location = await jobLocation(job.id, parsed.data.locationId);
  if (location === "unknown") {
    return fail("That location is no longer on this job.");
  }

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
  //
  // Scoped to the job when it is being joined rather than made: the id comes
  // from the browser, and a section on somebody else's job is not this
  // caller's to add to.
  const item = parsed.data.itemId
    ? await db.deliverableItem.findFirst({
        where: { id: parsed.data.itemId, jobId: job.id },
        select: { id: true },
      })
    : await db.deliverableItem.create({
        data: {
          jobId: job.id,
          assignmentId: assignment?.id ?? null,
          category,
          customLabel: customLabel || null,
          textValue: textValue || null,
          locationId: location?.id ?? null,
        },
        select: { id: true },
      });

  if (!item) return fail("That section is no longer on this job.");

  // Sent only when the phone shrank the photo itself, and then only for the
  // one photo in this request.
  const exifHead = formData.get("exif");
  const exif =
    files.length === 1 && exifHead instanceof File && exifHead.size > 0
      ? Buffer.from(await exifHead.arrayBuffer())
      : null;

  const failures: string[] = [];
  const results = await inBatches(files, UPLOAD_CONCURRENCY, (file) =>
    storeUpload(job, user, file, { watermark: true, exif }),
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

  // Once per section, not once per photo: a tech saving ten of them made one
  // entry on the timeline before this went photo-at-a-time, and should still.
  if (!parsed.data.itemId) {
    await recordAudit({
      actorId: user.id,
      entityType: "DeliverableItem",
      entityId: item.id,
      jobId: job.id,
      action: "deliverable_added",
      detail: {
        category,
        label: deliverableLabel(category, customLabel),
        ...(location ? { location: location.name } : {}),
      },
    });
  }

  touch(job.id);
  return failures.length > 0 ? fail(failures.join("; ")) : ok(item.id);
}

// ---------------------------------------------------------------------------
// The paying company's paperwork
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

// ---------------------------------------------------------------------------
// One photo at a time
// ---------------------------------------------------------------------------

/**
 * The photo, the upload it belongs to, and whether this person may change it.
 *
 * Your own photo is yours to sort out. Somebody else's needs the person who
 * signs the report off as well — the same test the whole-upload actions use,
 * asked of the photo rather than of the batch it arrived in, since two people
 * now add to one location.
 */
type PhotoInHand = {
  user: SessionUser;
  attachment: { id: string; storagePath: string };
  item: {
    id: string;
    jobId: string;
    assignmentId: string | null;
    category: DeliverableCategory;
    customLabel: string | null;
    location: { id: string; name: string } | null;
  };
};

async function photoForChange(
  attachmentId: string,
  permission: "deliverable.upload" | "deliverable.delete",
): Promise<PhotoInHand | { error: string }> {
  const user = await getSessionUser();
  if (!user) return { error: "Not signed in." };

  const attachment = await db.attachment.findUnique({
    where: { id: attachmentId },
    select: {
      id: true,
      storagePath: true,
      uploadedById: true,
      deliverableItem: {
        select: {
          id: true,
          jobId: true,
          assignmentId: true,
          category: true,
          customLabel: true,
          location: { select: { id: true, name: true } },
        },
      },
    },
  });
  const item = attachment?.deliverableItem;
  if (!attachment || !item) return { error: "That photo is not on a job." };

  const job = await loadJob(item.jobId);
  if (!job) return { error: "Job not found." };

  const isOwn = attachment.uploadedById === user.id;
  const allowed = isOwn
    ? await canOnJob(user, permission, job)
    : (await canOnJob(user, permission, job)) &&
      (await canOnJob(user, "job.approve_report", job));
  if (!allowed) {
    return {
      error:
        permission === "deliverable.delete"
          ? "You cannot delete this photo."
          : "You cannot move this photo.",
    };
  }

  return { user, attachment, item };
}

/** An upload left with neither photos nor text is an empty row in the report. */
async function dropIfEmpty(itemId: string) {
  await db.deliverableItem.deleteMany({
    where: {
      id: itemId,
      attachments: { none: {} },
      OR: [{ textValue: null }, { textValue: "" }],
    },
  });
}

function placeLabel(
  category: DeliverableCategory,
  customLabel: string | null,
  location: { name: string } | null,
) {
  const label = deliverableLabel(category, customLabel);
  return location ? `${label} at ${location.name}` : label;
}

const photoMoveSchema = z.object({
  attachmentId: z.string().min(1),
  category: z.enum(DeliverableCategory),
  customLabel: z.string().trim().max(80).optional(),
  locationId: z.string().optional(),
});

/**
 * Moves one photo to another section, another location, or both.
 *
 * A tech who shot the IDF with the MDF open finds out on the photo, so that
 * is where the fix is. The file itself is untouched — nothing is re-encoded or
 * re-stamped — and it keeps the name of whoever took it.
 */
export async function moveDeliverablePhoto(
  formData: FormData,
): Promise<ActionResult> {
  const parsed = photoMoveSchema.safeParse({
    attachmentId: formData.get("attachmentId"),
    category: formData.get("category"),
    customLabel: formData.get("customLabel") || undefined,
    locationId: formData.get("locationId") || undefined,
  });
  if (!parsed.success) return fail(z.prettifyError(parsed.error));

  const { attachmentId, category } = parsed.data;
  const customLabel = category === "CUSTOM" ? parsed.data.customLabel : null;
  if (category === "CUSTOM" && !customLabel) {
    return fail("Say which custom section.");
  }

  const context = await photoForChange(attachmentId, "deliverable.upload");
  if ("error" in context) return fail(context.error);
  const { user, item } = context;

  const location = await jobLocation(item.jobId, parsed.data.locationId);
  if (location === "unknown") {
    return fail("That location is no longer on this job.");
  }

  const from = placeLabel(item.category, item.customLabel, item.location);
  const to = placeLabel(category, customLabel ?? null, location);
  if (
    item.category === category &&
    (item.customLabel ?? null) === (customLabel ?? null) &&
    (item.location?.id ?? null) === (location?.id ?? null)
  ) {
    return ok();
  }

  // Joins the upload already there from the same person, so a section does
  // not fill up with one-photo rows; otherwise starts one for them.
  const where = {
    jobId: item.jobId,
    category,
    customLabel: customLabel ?? null,
    locationId: location?.id ?? null,
    assignmentId: item.assignmentId,
  };
  const destination =
    (await db.deliverableItem.findFirst({ where, select: { id: true } })) ??
    (await db.deliverableItem.create({ data: where, select: { id: true } }));

  await db.attachment.update({
    where: { id: attachmentId },
    data: { deliverableItemId: destination.id },
  });
  await dropIfEmpty(item.id);

  await recordAudit({
    actorId: user.id,
    entityType: "DeliverableItem",
    entityId: destination.id,
    jobId: item.jobId,
    action: "deliverable_moved",
    detail: { field: "Photo", from, to },
  });

  touch(item.jobId);
  return ok();
}

/** Deletes one photo, file and all. */
export async function deleteDeliverablePhoto(
  formData: FormData,
): Promise<ActionResult> {
  const attachmentId = String(formData.get("attachmentId") ?? "");
  if (!attachmentId) return fail("Which photo?");

  const context = await photoForChange(attachmentId, "deliverable.delete");
  if ("error" in context) return fail(context.error);
  const { user, attachment, item } = context;

  await db.attachment.delete({ where: { id: attachment.id } });
  await deleteFile(attachment.storagePath);
  await dropIfEmpty(item.id);

  await recordAudit({
    actorId: user.id,
    entityType: "DeliverableItem",
    entityId: item.id,
    jobId: item.jobId,
    action: "deliverable_removed",
    detail: {
      category: item.category,
      label: placeLabel(item.category, item.customLabel, item.location),
      what: "photo",
    },
  });

  touch(item.jobId);
  return ok();
}

/**
 * Takes the typed part of an upload away — a serial keyed in wrong — and
 * leaves any photo that came with it where it is.
 */
export async function removeDeliverableText(
  formData: FormData,
): Promise<ActionResult> {
  const id = String(formData.get("itemId") ?? "");

  const item = await db.deliverableItem.findUnique({
    where: { id },
    select: {
      jobId: true,
      category: true,
      customLabel: true,
      textValue: true,
      assignment: { select: { userId: true } },
    },
  });
  if (!item) return fail("Not found.");

  const user = await getSessionUser();
  if (!user) return fail("Not signed in.");

  const job = await loadJob(item.jobId);
  if (!job) return fail("Job not found.");

  const isOwn = item.assignment?.userId === user.id;
  const allowed = isOwn
    ? await canOnJob(user, "deliverable.delete", job)
    : (await canOnJob(user, "deliverable.delete", job)) &&
      (await canOnJob(user, "job.approve_report", job));
  if (!allowed) return fail("You cannot remove this.");

  await db.deliverableItem.update({
    where: { id },
    data: { textValue: null },
  });
  await dropIfEmpty(id);

  await recordAudit({
    actorId: user.id,
    entityType: "DeliverableItem",
    entityId: id,
    jobId: item.jobId,
    action: "deliverable_removed",
    detail: {
      category: item.category,
      label: deliverableLabel(item.category, item.customLabel),
      what: "text",
      from: item.textValue,
    },
  });

  touch(item.jobId);
  return ok();
}

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

const locationSchema = z.object({
  jobId: z.string().min(1),
  name: z
    .string()
    .transform((value) => value.replace(/\s+/g, " ").trim())
    .pipe(
      z
        .string()
        .min(1, "Name the location.")
        .max(MAX_LOCATION_NAME, `Keep it to ${MAX_LOCATION_NAME} characters.`),
    ),
});

/**
 * A place on site found on the day — the second IDF nobody mentioned.
 *
 * Anyone who can add photos to the job can add one: they are the person
 * standing in it. Taking one away is a supervisor's, below.
 *
 * A name that is in the dictionary takes the dictionary's spelling and icon,
 * so "mdf" typed in a hurry still reads MDF with its rack. Anything else is
 * kept as typed, with the icon its words suggested or the plain pin. Either
 * way the job keeps what it was given: renaming the dictionary later changes
 * nothing here.
 */
export async function addJobLocation(
  formData: FormData,
): Promise<ActionResult> {
  const parsed = locationSchema.safeParse({
    jobId: formData.get("jobId"),
    name: formData.get("name") ?? "",
  });
  if (!parsed.success) return fail(z.prettifyError(parsed.error));

  const context = await requireUpload(parsed.data.jobId);
  if ("error" in context) return fail(context.error);
  const { user, job } = context;

  const known = await db.knownLocation.findFirst({
    where: { label: { equals: parsed.data.name, mode: "insensitive" } },
    select: { label: true, icon: true },
  });
  const name = known?.label ?? parsed.data.name;
  // The dictionary's icon for a name it knows; for one it does not, the one
  // the picker suggested from the words, if it is one of ours.
  const offered = formData.get("icon");
  const icon = known
    ? isLocationIcon(known.icon)
      ? known.icon
      : null
    : typeof offered === "string" && isLocationIcon(offered)
      ? offered
      : null;

  const existing = await db.jobLocation.findMany({
    where: { jobId: job.id },
    select: { name: true, order: true },
  });
  // "MDF" and "mdf" are one room, and two pills for it split its photos.
  if (existing.some((one) => one.name.toLowerCase() === name.toLowerCase())) {
    return fail(`There is already a location called ${name}.`);
  }

  const location = await db.jobLocation.create({
    data: {
      jobId: job.id,
      name,
      icon,
      order: Math.max(-1, ...existing.map((one) => one.order)) + 1,
      createdById: user.id,
    },
    select: { id: true },
  });

  await recordAudit({
    actorId: user.id,
    entityType: "JobLocation",
    entityId: location.id,
    jobId: job.id,
    action: "location_added",
    detail: { name },
  });

  touch(job.id);
  return ok(location.id);
}

/**
 * Takes a location off the job — a supervisor's or the lead's call, and only
 * while nothing is filed under it. A location with photos in it is where
 * those photos are; deleting it would quietly un-file them and change what
 * checkout counts.
 */
export async function removeJobLocation(
  formData: FormData,
): Promise<ActionResult> {
  const locationId = String(formData.get("locationId") ?? "");

  const location = await db.jobLocation.findUnique({
    where: { id: locationId },
    select: {
      id: true,
      jobId: true,
      name: true,
      _count: { select: { items: true } },
    },
  });
  if (!location) return fail("That location is already gone.");

  const user = await getSessionUser();
  if (!user) return fail("Not signed in.");

  const job = await loadJob(location.jobId);
  if (!job) return fail("Job not found.");

  const lead = await db.jobAssignment.findFirst({
    where: { jobId: job.id, userId: user.id, isLead: true },
    select: { id: true },
  });
  const allowed =
    Boolean(lead) || (await canOnJob(user, "job.edit_planned_fields", job));
  if (!allowed) {
    return fail("Only a supervisor or the job's lead can remove a location.");
  }

  if (location._count.items > 0) {
    return fail(
      `${location.name} still has photos in it. Move or delete them first.`,
    );
  }

  // Asked again in the delete itself, so a photo landing in between is not
  // un-filed by a removal that checked a moment too early.
  const removed = await db.jobLocation.deleteMany({
    where: { id: location.id, items: { none: {} } },
  });
  if (removed.count === 0) {
    return fail(
      `${location.name} still has photos in it. Move or delete them first.`,
    );
  }

  await recordAudit({
    actorId: user.id,
    entityType: "JobLocation",
    entityId: location.id,
    jobId: job.id,
    action: "location_removed",
    detail: { name: location.name },
  });

  touch(job.id);
  return ok();
}
