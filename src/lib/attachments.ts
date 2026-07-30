import { db } from "@/lib/db";

/**
 * Which job an attachment belongs to.
 *
 * Attachments hang off five different parents, so permission checks need a
 * single place that resolves any of them back to a job. Mileage photos have no
 * job at all — they belong to the person who logged the trip — so the caller
 * gets told that instead of being handed a wrong answer.
 */
export type AttachmentOwner =
  | { kind: "job"; jobId: string }
  | { kind: "user"; userId: string };

export async function attachmentOwner(
  attachmentId: string,
): Promise<AttachmentOwner | null> {
  const attachment = await db.attachment.findUnique({
    where: { id: attachmentId },
    select: {
      uploadedById: true,
      deliverableItem: { select: { jobId: true } },
      reimbursement: { select: { jobId: true } },
      signature: { select: { jobId: true } },
      workOrderJobId: true,
      mileageStartEntry: { select: { userId: true } },
      mileageEndEntry: { select: { userId: true } },
    },
  });

  if (!attachment) return null;

  const jobId =
    attachment.deliverableItem?.jobId ??
    attachment.reimbursement?.jobId ??
    attachment.signature?.jobId ??
    attachment.workOrderJobId ??
    null;

  if (jobId) return { kind: "job", jobId };

  const userId =
    attachment.mileageStartEntry?.userId ?? attachment.mileageEndEntry?.userId;
  if (userId) return { kind: "user", userId };

  // Uploaded but not yet attached to anything — only its uploader can see it.
  return { kind: "user", userId: attachment.uploadedById };
}
