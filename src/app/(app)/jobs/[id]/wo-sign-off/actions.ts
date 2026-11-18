"use server";

import { readFile } from "node:fs/promises";
import { revalidatePath } from "next/cache";
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
import { DAMAGED_WORK_ORDER, pagesDisagree } from "@/lib/forms/wo-errors";
import { signatureInk } from "@/lib/forms/wo-signature";
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
  | {
      ok: true;
      id: string;
      name: string;
      /** Drawn; none on the job; or one on the job that could not be read. */
      signature: "drawn" | "none" | "unreadable";
      notesCut: boolean;
      /** One-line values cut short to fit their place. */
      cut: (keyof WoValues)[];
    }
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
  /** How many pages the screen read, to be held against what is written on. */
  pageCount: z.number().int().min(1).max(5000),
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

/** The customer's signature as the work order carries it, and whether there was one. */
async function signatureFor(
  storagePath: string | null,
): Promise<{ png: Uint8Array | null; state: "none" | "unreadable" | "read" }> {
  if (!storagePath) return { png: null, state: "none" };
  try {
    const png = await signatureInk(await readFile(absolutePath(storagePath)));
    return png ? { png, state: "read" } : { png: null, state: "unreadable" };
  } catch (error) {
    console.error("[work order] the signature file is missing", error);
    return { png: null, state: "unreadable" };
  }
}

/** Largest a patch of WorkMarket's own print painted out may be: a time, not a paragraph. */
const COVER_MAX = { width: 320, height: 40 };

/**
 * What the page sent, held to what the screen could have sent.
 *
 * The pages run from the first one on without a gap — the first copy, or all
 * of them — and the white patches are the size of a time, on those pages. A
 * crafted request once put the signature on the customer's copy and another
 * painted out the whole job description, and both were saved. Not held to the
 * times' own page: the times can be moved to another page by hand, and
 * WorkMarket's stay where they were printed.
 */
function plausible(overlay: z.infer<typeof payloadSchema>["overlay"]): boolean {
  const pages = [...new Set(overlay.pages)].sort((a, b) => a - b);
  if (pages.length !== overlay.pages.length || pages.some((page, index) => page !== index)) {
    return false;
  }
  return overlay.covers.every(
    (cover) =>
      pages.includes(cover.page) &&
      cover.width <= COVER_MAX.width &&
      cover.height <= COVER_MAX.height,
  );
}

function prismaCode(error: unknown): string | null {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code: unknown }).code)
    : null;
}

export async function saveSignedWorkOrder(formData: FormData): Promise<SaveResult> {
  let input: z.infer<typeof payloadSchema>;
  try {
    input = payloadSchema.parse(JSON.parse(String(formData.get("payload") ?? "")));
  } catch {
    return { ok: false, error: "What was sent could not be read. Reload the page and try again." };
  }
  if (!plausible(input.overlay)) {
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

  const signature = await signatureFor(signatureStoragePath(data));

  let bytes: Buffer;
  let drawn;
  try {
    const pdf = await openWorkOrder(new Uint8Array(source));
    const count = pdf.getPageCount();
    // Read one way on the screen and another here, a box placed on page 3
    // could be written onto what is page 3 here: a damaged work order once
    // had its name and date written onto the customer's copy that way.
    if (count !== input.pageCount) {
      return { ok: false, error: pagesDisagree(input.pageCount, count) };
    }
    const pages = input.overlay.pages;
    const boxes = [input.overlay.times, input.overlay.notes, input.overlay.approval];
    if (boxes.some((box) => !pages.includes(box.page))) {
      return { ok: false, error: "Every box has to be on the pages being signed." };
    }

    drawn = await drawWorkOrder(pdf, input.overlay, input.values, signature.png);
    bytes = Buffer.from(await pdf.save());
  } catch (error) {
    if (error instanceof Error && error.message === LOCKED_WORK_ORDER) {
      return { ok: false, error: LOCKED_WORK_ORDER };
    }
    console.error("[work order] signing a work order failed", error);
    return { ok: false, error: DAMAGED_WORK_ORDER };
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

  // One signed copy per work order: signing again is a correction, and two
  // copies differing only in when they were made is how the wrong one goes.
  // Replaced in one transaction, the database holding the line with its
  // unique index: two saves at once used to leave two copies. The second of
  // two such saves finds the index taken, and goes again — then replacing the
  // copy the first one made.
  const record = () =>
    db.$transaction(async (tx) => {
      const previous = await tx.attachment.findUnique({
        where: { signedFromId: workOrder.id },
        select: { id: true, storagePath: true },
      });
      // Many, not one: a save running alongside may have removed it already.
      if (previous) await tx.attachment.deleteMany({ where: { id: previous.id } });
      const row = await tx.attachment.create({
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
      return { row, previous };
    });

  let created;
  try {
    created = await record().catch((error: unknown) => {
      if (prismaCode(error) !== "P2002") throw error;
      return record();
    });
  } catch (error) {
    await deleteFile(stored.storagePath);
    if (prismaCode(error) === "P2002") {
      return {
        ok: false,
        error:
          "This work order was being saved more than once at the same moment. Open the job to see the signed copy, or save it again.",
      };
    }
    console.error("[work order] recording a signed work order failed", error);
    return { ok: false, error: "The signed work order could not be saved." };
  }

  // The file of the copy it replaced goes once the row is gone for good: if
  // the save had failed, the copy still on the job would have kept its file.
  if (created.previous) await deleteFile(created.previous.storagePath);

  const typed = (Object.keys(TYPED_LABEL) as (keyof WoValues)[])
    .filter((key) => input.typed[key])
    .map((key) => TYPED_LABEL[key]);
  const notes = [
    drawn.signed
      ? null
      : signature.state === "unreadable"
        ? "customer signature unreadable"
        : "no customer signature",
    drawn.notes.cut ? "notes cut short" : null,
    drawn.cut.length > 0 ? `cut short: ${drawn.cut.map((key) => TYPED_LABEL[key]).join(", ")}` : null,
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
    id: created.row.id,
    name,
    signature: drawn.signed ? "drawn" : signature.state === "unreadable" ? "unreadable" : "none",
    notesCut: drawn.notes.cut,
    cut: drawn.cut,
  };
}
