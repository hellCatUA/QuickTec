"use server";

import { readFile } from "node:fs/promises";
import { revalidatePath } from "next/cache";
import sharp from "sharp";
import { z } from "zod";
import { recordAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { loadJobForExport } from "@/lib/exports/job-data";
import {
  drawWorkOrder,
  LOCKED_WORK_ORDER,
  openWorkOrder,
  WO_VALUE_LIMITS,
  type WoValues,
} from "@/lib/forms/wo-draw";
import { canOnJob } from "@/lib/scope";
import { getSessionUser } from "@/lib/session";
import {
  absolutePath,
  deleteFile,
  storeFile,
  storageErrorMessage,
} from "@/lib/storage";
import {
  NOT_CLOSED_YET,
  signableWorkOrder,
  signedWorkOrderName,
  workIsDone,
  type SavedSignOff,
} from "@/lib/wo-sign-off";
import { signatureStoragePath } from "@/lib/wo-sign-off-data";

/**
 * Keeping a signed work order.
 *
 * The screen draws the preview with the same code on the phone; this draws it
 * again here, from the job's own signature file rather than anything the page
 * sends, and keeps the result beside the work order it was made from.
 */

export type SaveResult =
  | { ok: true; id: string; name: string; signed: boolean; notesCut: boolean }
  | { ok: false; error: string };

/** A page's worth of points, with room for a box nudged a little off it. */
const coordinate = z.number().finite().min(-200).max(5000);
const length = z.number().finite().min(1).max(5000);
const size = z.number().finite().min(4).max(24);

const rect = z.object({
  page: z.number().int().min(0).max(999),
  x: coordinate,
  y: coordinate,
  width: length,
  height: length,
});

const payloadSchema = z.object({
  jobId: z.string().min(1),
  workOrderId: z.string().min(1),
  overlay: z.object({
    pages: z.array(z.number().int().min(0).max(999)).min(1).max(200),
    times: rect.extend({ size }),
    notes: rect.extend({ size, pitch: z.number().finite().min(4).max(40) }),
    approval: rect.extend({
      size,
      signatureAt: z.number().finite().min(0).max(2000),
      dateAt: z.number().finite().min(0).max(2000),
    }),
    covers: z.array(rect).max(24),
  }),
  values: z.object({
    checkIn: z.string().max(WO_VALUE_LIMITS.checkIn),
    checkOut: z.string().max(WO_VALUE_LIMITS.checkOut),
    notes: z.string().max(WO_VALUE_LIMITS.notes),
    name: z.string().max(WO_VALUE_LIMITS.name),
    date: z.string().max(WO_VALUE_LIMITS.date),
  }),
  typed: z.object({
    checkIn: z.boolean().optional(),
    checkOut: z.boolean().optional(),
    notes: z.boolean().optional(),
    name: z.boolean().optional(),
    date: z.boolean().optional(),
  }),
  found: z.object({
    times: z.enum(["lines", "printed"]).nullable(),
    notes: z.enum(["lines", "heading"]).nullable(),
    approval: z.boolean(),
    copies: z.boolean(),
  }),
});

const TYPED_LABEL: Record<keyof WoValues, string> = {
  checkIn: "check-in",
  checkOut: "check-out",
  notes: "notes",
  name: "name",
  date: "date",
};

/** The customer's signature as PNG bytes, re-encoded the way the filler does it. */
async function signaturePng(storagePath: string | null): Promise<Uint8Array | null> {
  if (!storagePath) return null;
  try {
    // Re-encoded rather than handed over as read: pdf-lib's PNG decoder spins
    // forever on a truncated file, and sharp refuses one cleanly.
    const png = await sharp(await readFile(absolutePath(storagePath)))
      .png({ compressionLevel: 9 })
      .toBuffer();
    return new Uint8Array(png);
  } catch (error) {
    console.error("[work order] the signature file could not be read", error);
    return null;
  }
}

export async function saveSignedWorkOrder(formData: FormData): Promise<SaveResult> {
  let input: z.infer<typeof payloadSchema>;
  try {
    input = payloadSchema.parse(JSON.parse(String(formData.get("payload") ?? "")));
  } catch {
    return { ok: false, error: "What was sent could not be read. Reload the page and try again." };
  }

  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const job = await db.job.findUnique({
    where: { id: input.jobId },
    select: {
      id: true,
      lifecycle: true,
      projectId: true,
      createdById: true,
      assignments: { select: { userId: true } },
    },
  });
  if (!job) return { ok: false, error: "Job not found." };

  const can = await canOnJob(user, "deliverable.upload", {
    projectId: job.projectId,
    createdById: job.createdById,
    assigneeIds: job.assignments.map((assignment) => assignment.userId),
  });
  if (!can) return { ok: false, error: "You cannot change this job's paperwork." };

  // Asked here, every time: the button saying so on the job page is a
  // courtesy, and a tab left open from before the clock-out is not a check.
  if (!workIsDone(job.lifecycle)) return { ok: false, error: NOT_CLOSED_YET };

  const workOrder = await db.attachment.findFirst({
    where: { id: input.workOrderId, jobDocumentId: job.id },
    select: {
      id: true,
      storagePath: true,
      originalName: true,
      mimeType: true,
      jobDocumentKind: true,
      generated: true,
    },
  });
  if (!workOrder || !signableWorkOrder(workOrder)) {
    return { ok: false, error: "That work order is not on this job any more." };
  }

  let source: Buffer;
  try {
    source = await readFile(absolutePath(workOrder.storagePath));
  } catch {
    return { ok: false, error: "The work order's file is missing from storage." };
  }

  const data = await loadJobForExport(job.id);
  if (!data) return { ok: false, error: "Job not found." };

  let bytes: Buffer;
  let drawn;
  try {
    const pdf = await openWorkOrder(new Uint8Array(source));
    const count = pdf.getPageCount();
    const pages = input.overlay.pages.filter((page) => page < count);
    const boxes = [input.overlay.times, input.overlay.notes, input.overlay.approval];
    if (boxes.some((box) => !pages.includes(box.page))) {
      return { ok: false, error: "Every box has to be on the first copy's pages." };
    }

    drawn = await drawWorkOrder(
      pdf,
      { ...input.overlay, pages },
      input.values,
      await signaturePng(signatureStoragePath(data)),
    );
    bytes = Buffer.from(await pdf.save());
  } catch (error) {
    if (error instanceof Error && error.message === LOCKED_WORK_ORDER) {
      return { ok: false, error: LOCKED_WORK_ORDER };
    }
    console.error("[work order] signing a work order failed", error);
    return {
      ok: false,
      error: "That work order could not be written on. The server log has the detail.",
    };
  }

  let stored;
  try {
    stored = await storeFile(job.id, bytes, "application/pdf");
  } catch (error) {
    console.error("[work order] storing a signed work order failed", error);
    return { ok: false, error: storageErrorMessage(error) };
  }

  const name = signedWorkOrderName(workOrder.originalName);
  const saved: SavedSignOff = {
    overlay: input.overlay,
    values: input.values,
    typed: input.typed,
    found: input.found,
  };

  const previous = await db.attachment.findMany({
    where: { jobDocumentId: job.id, generated: true, signedFromId: workOrder.id },
    select: { id: true, storagePath: true },
  });

  let created;
  try {
    created = await db.attachment.create({
      data: {
        storagePath: stored.storagePath,
        originalName: name,
        mimeType: "application/pdf",
        sizeBytes: stored.sizeBytes,
        uploadedById: user.id,
        jobDocumentId: job.id,
        // With the work orders, where the owner keeps it: the export puts it
        // in the company's WO folder beside the one it was made from.
        jobDocumentKind: "CLIENT_WORK_ORDER",
        generated: true,
        signedFromId: workOrder.id,
        overlay: saved,
      },
      select: { id: true },
    });
  } catch (error) {
    console.error("[work order] recording a signed work order failed", error);
    await deleteFile(stored.storagePath);
    return { ok: false, error: "The signed work order could not be saved." };
  }

  // One signed copy per work order: signing again is a correction, and two
  // copies differing only in when they were made is how the wrong one goes.
  for (const old of previous) {
    await deleteFile(old.storagePath);
    await db.attachment.delete({ where: { id: old.id } }).catch(() => {});
  }

  const typed = (Object.keys(TYPED_LABEL) as (keyof WoValues)[])
    .filter((key) => input.typed[key])
    .map((key) => TYPED_LABEL[key]);
  const notes = [
    drawn.signed ? null : "no customer signature",
    drawn.notes.cut ? "notes cut short" : null,
    typed.length > 0 ? `typed over: ${typed.join(", ")}` : null,
  ].filter(Boolean);

  await recordAudit({
    actorId: user.id,
    entityType: "Job",
    entityId: job.id,
    jobId: job.id,
    action: "updated",
    detail: {
      field: "Signed work order",
      to: notes.length > 0 ? `${name} (${notes.join("; ")})` : name,
    },
  });

  revalidatePath(`/jobs/${job.id}`);
  revalidatePath(`/jobs/${job.id}/wo-sign-off`);
  return {
    ok: true,
    id: created.id,
    name,
    signed: drawn.signed,
    notesCut: drawn.notes.cut,
  };
}
