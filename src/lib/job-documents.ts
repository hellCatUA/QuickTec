import { db } from "@/lib/db";
import { processImage } from "@/lib/images";
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
  } catch {
    return { error: "That file could not be read as a photo or a PDF." };
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
    },
    select: { id: true },
  });

  return attachment;
}
