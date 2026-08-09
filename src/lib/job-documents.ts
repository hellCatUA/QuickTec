import { db } from "@/lib/db";
import { isPdf, looksLikeImage, processImage } from "@/lib/images";
import { copyFile, storeFile, storageErrorMessage } from "@/lib/storage";
import type { JobDocumentKind } from "@prisma-client";

/**
 * The representing company's paperwork.
 *
 * Two documents travel with a job and neither is the crew's work: the work
 * order they issued, and the sign-off sheet the tech gets signed on site.
 * Both are stored unstamped — they belong to the company that wrote them, and
 * a watermark would misrepresent them as ours.
 */

/** 20 MB, the same ceiling as a photo. */
const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

export const DOCUMENT_LABELS: Record<JobDocumentKind, string> = {
  CLIENT_WORK_ORDER: "Work order",
  SIGN_OFF: "Sign-off sheet",
};

export type StoredDocument = { id: string } | { error: string };

/** Writes one uploaded file and returns the attachment it became. */
export async function storeDocument(
  file: File,
  uploadedById: string,
  /** Groups the file on disk. Templates have no job, so they get their own. */
  storageKey: string,
): Promise<StoredDocument> {
  if (file.size === 0) return { error: "That file is empty." };
  if (file.size > MAX_DOCUMENT_BYTES) {
    return { error: "That file is larger than 20 MB." };
  }

  const input = Buffer.from(await file.arrayBuffer());

  let processed;
  try {
    // No watermark: their document, unaltered.
    processed = await processImage(input, file.type, null);
  } catch (error) {
    console.error(`[upload] processing ${file.name || "a document"} failed`, error);

    if (!looksLikeImage(input) && !isPdf(file.type, input)) {
      return { error: "That file could not be read as a photo or a PDF." };
    }
    return {
      error:
        "The file reached the server but could not be processed there. Check Photo pipeline under Settings → Integrations.",
    };
  }

  let stored;
  try {
    stored = await storeFile(storageKey, processed.data, processed.mimeType);
  } catch (error) {
    console.error("[upload] storing a document failed", error);
    return { error: storageErrorMessage(error) };
  }

  const attachment = await db.attachment.create({
    data: {
      storagePath: stored.storagePath,
      originalName: file.name || "document",
      mimeType: processed.mimeType,
      sizeBytes: stored.sizeBytes,
      width: processed.width,
      height: processed.height,
      uploadedById,
    },
    select: { id: true },
  });

  return { id: attachment.id };
}

/**
 * Puts a company's saved blank onto a job.
 *
 * The bytes are copied rather than shared. A template that is replaced next
 * year must not silently change what a job that ran this year went out on —
 * the archive of a finished job has to stay the archive of that job.
 */
export async function copyTemplateToJob(
  templateId: string,
  jobId: string,
  uploadedById: string,
): Promise<{ id: string } | null> {
  const template = await db.clientDocumentTemplate.findUnique({
    where: { id: templateId },
    select: {
      kind: true,
      label: true,
      attachment: {
        select: { storagePath: true, originalName: true, mimeType: true },
      },
    },
  });
  if (!template) return null;

  const copied = await copyFile(template.attachment.storagePath, jobId);
  if (!copied) return null;

  const attachment = await db.attachment.create({
    data: {
      storagePath: copied.storagePath,
      originalName: template.attachment.originalName,
      mimeType: template.attachment.mimeType,
      sizeBytes: copied.sizeBytes,
      uploadedById,
      jobDocumentId: jobId,
      jobDocumentKind: template.kind,
      // Remembered so the job can find the box positions that belong to the
      // sheet it is holding, rather than guessing from the company.
      sourceTemplateId: templateId,
    },
    select: { id: true },
  });

  return attachment;
}

/**
 * Jobs a company's paperwork can still reach.
 *
 * Everything up to the point the work is signed off. A job that has been
 * approved has already gone to the company on whatever it went out on, and
 * quietly adding a form to it afterwards would change a record of something
 * that already happened.
 */
const OPEN_LIFECYCLES = [
  "DRAFT",
  "PENDING_APPROVAL",
  "SCHEDULED",
  "IN_PROGRESS",
  "PENDING_REVIEW",
] as const;

export type TemplateRollout = {
  /** Jobs that gained at least one form. */
  jobs: number;
  /** Copies made across all of them. */
  copies: number;
};

/**
 * Puts a company's standing blanks onto the jobs already raised for them.
 *
 * A form added to a company on Tuesday is a form the crew needs on the job
 * they are doing on Tuesday, not only on the next one raised. Attaching it at
 * creation time and nowhere else is how somebody ends up on site without the
 * sheet, which is the whole thing this feature exists to prevent.
 *
 * Safe to run repeatedly: a job that already carries a copy of a template is
 * left alone, so nothing is duplicated and nobody has to remember whether they
 * pressed the button already.
 */
export async function attachTemplatesToOpenJobs(
  clientId: string,
  uploadedById: string,
  /** Narrow it to one template; otherwise every default the company has. */
  templateId?: string,
): Promise<TemplateRollout> {
  const templates = await db.clientDocumentTemplate.findMany({
    where: {
      clientId,
      active: true,
      isDefault: true,
      ...(templateId ? { id: templateId } : {}),
    },
    select: { id: true },
  });
  if (templates.length === 0) return { jobs: 0, copies: 0 };

  const jobs = await db.job.findMany({
    where: { clientId, lifecycle: { in: [...OPEN_LIFECYCLES] } },
    select: {
      id: true,
      documents: {
        where: { sourceTemplateId: { in: templates.map((t) => t.id) } },
        select: { sourceTemplateId: true },
      },
    },
  });

  let copies = 0;
  let touched = 0;

  for (const job of jobs) {
    const already = new Set(
      job.documents
        .map((document) => document.sourceTemplateId)
        .filter((id): id is string => Boolean(id)),
    );

    let added = 0;
    for (const template of templates) {
      if (already.has(template.id)) continue;
      // A copy that fails — a template file gone missing — is one job short,
      // not a reason to leave the rest of the crew without their paperwork.
      const copied = await copyTemplateToJob(template.id, job.id, uploadedById);
      if (copied) added++;
    }

    if (added > 0) {
      touched++;
      copies += added;
    }
  }

  return { jobs: touched, copies };
}
