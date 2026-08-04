"use server";

import { readFile } from "node:fs/promises";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { recordAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { loadJobForExport } from "@/lib/exports/job-data";
import { effectivePlacements, loadDraft } from "@/lib/forms/draft";
import { fillForm } from "@/lib/forms/fill";
import { canOnJob } from "@/lib/scope";
import { getSessionUser, type SessionUser } from "@/lib/session";
import {
  absolutePath,
  deleteFile,
  storeFile,
  storageErrorMessage,
} from "@/lib/storage";

/**
 * Saving what somebody typed into a sheet, and attaching the finished thing.
 *
 * Two steps on purpose. The values are only as complete as the job is, and a
 * sheet that quietly finished itself is one nobody read before it went to a
 * customer to sign.
 */

export type ActionResult = { ok: true } | { ok: false; error: string };
export type AttachResult =
  | { ok: true; id: string; empty: number }
  | { ok: false; error: string };

async function allowed(
  jobId: string,
): Promise<{ user: SessionUser } | { error: string }> {
  const user = await getSessionUser();
  if (!user) return { error: "Not signed in." };

  const job = await db.job.findUnique({
    where: { id: jobId },
    select: {
      projectId: true,
      createdById: true,
      assignments: { select: { userId: true } },
    },
  });
  if (!job) return { error: "Job not found." };

  const can = await canOnJob(user, "deliverable.upload", {
    projectId: job.projectId,
    createdById: job.createdById,
    assigneeIds: job.assignments.map((assignment) => assignment.userId),
  });
  if (!can) return { error: "You cannot change this job's paperwork." };

  return { user };
}

const entriesSchema = z.object({
  jobId: z.string().min(1),
  templateId: z.string().min(1),
  entries: z.array(
    z.object({
      placementId: z.string().min(1),
      // 2000 is far past anything a form box holds, and stops a paste of a
      // whole report from becoming a row nobody can render.
      // Null is "not overridden"; an empty string is "deliberately blank".
      value: z.string().max(2000).nullable(),
      /**
       * What the box said when it was ticked off, so an approval lapses if the
       * value moves under it. Sent by the screen rather than recomputed here:
       * it is the text the person was actually looking at.
       */
      approvedValue: z.string().max(2000).nullable(),
    }),
  ),
});

/** Keeps what was typed, so re-filling after the signature does not lose it. */
export async function saveFormEntries(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  let input: z.infer<typeof entriesSchema>;
  try {
    input = entriesSchema.parse(JSON.parse(String(formData.get("payload") ?? "")));
  } catch {
    return { ok: false, error: "Those entries could not be read." };
  }

  const permission = await allowed(input.jobId);
  if ("error" in permission) return { ok: false, error: permission.error };

  // Only boxes that belong to this job's own form, so a stale tab cannot write
  // values against another company's template.
  const owned = new Set(
    (
      await db.formPlacement.findMany({
        where: { templateId: input.templateId },
        select: { id: true },
      })
    ).map((row) => row.id),
  );

  const rows = input.entries.filter(
    (entry) =>
      owned.has(entry.placementId) &&
      (entry.value !== null || entry.approvedValue !== null),
  );

  await db.$transaction([
    ...rows.map((entry) =>
      db.jobFormEntry.upsert({
        where: {
          jobId_placementId: {
            jobId: input.jobId,
            placementId: entry.placementId,
          },
        },
        create: {
          jobId: input.jobId,
          placementId: entry.placementId,
          value: entry.value,
          approvedValue: entry.approvedValue,
          approvedAt: entry.approvedValue === null ? null : new Date(),
          approvedById: entry.approvedValue === null ? null : permission.user.id,
        },
        update: {
          value: entry.value,
          approvedValue: entry.approvedValue,
          approvedAt: entry.approvedValue === null ? null : new Date(),
          approvedById: entry.approvedValue === null ? null : permission.user.id,
        },
      }),
    ),
    // A box that is neither overridden nor ticked has nothing to remember, so
    // the row goes rather than lingering with two nulls in it.
    db.jobFormEntry.deleteMany({
      where: {
        jobId: input.jobId,
        placementId: {
          in: [...owned].filter(
            (id) => !rows.some((entry) => entry.placementId === id),
          ),
        },
      },
    }),
  ]);

  revalidatePath(`/jobs/${input.jobId}/sign-off/${input.templateId}`);
  return { ok: true };
}

/**
 * Produces the sheet and puts it on the job.
 *
 * Replaces the previous one rather than adding to it: a filled sheet is the
 * blank plus the job as it stood, and two copies differing only in when they
 * were made is how the wrong one gets signed.
 */
export async function attachFilledForm(
  formData: FormData,
): Promise<AttachResult> {
  const jobId = String(formData.get("jobId") ?? "");
  const templateId = String(formData.get("templateId") ?? "");

  const permission = await allowed(jobId);
  if ("error" in permission) return { ok: false, error: permission.error };

  const draft = await loadDraft(jobId, templateId);
  if (!draft) return { ok: false, error: "This job has no such form." };

  const blank = await db.attachment.findUnique({
    where: { id: draft.attachmentId },
    select: { storagePath: true, originalName: true, jobDocumentKind: true },
  });
  if (!blank) return { ok: false, error: "The blank is missing." };

  let source: Buffer;
  try {
    source = await readFile(absolutePath(blank.storagePath));
  } catch {
    return { ok: false, error: "The blank this job was given is missing." };
  }

  const data = await loadJobForExport(jobId);
  if (!data) return { ok: false, error: "Job not found." };

  let filled;
  try {
    filled = await fillForm(source, effectivePlacements(draft.boxes), {
      data,
      now: new Date(),
    });
  } catch (error) {
    console.error("[forms] filling a job's sheet failed", error);
    return {
      ok: false,
      error: "That form could not be filled. The server log has the detail.",
    };
  }

  let stored;
  try {
    stored = await storeFile(jobId, filled.bytes, "application/pdf");
  } catch (error) {
    console.error("[forms] storing a filled sheet failed", error);
    return { ok: false, error: storageErrorMessage(error) };
  }

  const previous = await db.attachment.findFirst({
    where: { jobDocumentId: jobId, generated: true, sourceTemplateId: templateId },
    select: { id: true, storagePath: true },
  });

  let created;
  try {
    created = await db.attachment.create({
      data: {
        storagePath: stored.storagePath,
        originalName: `${blank.originalName.replace(/\.pdf$/i, "")} — filled.pdf`,
        mimeType: "application/pdf",
        sizeBytes: stored.sizeBytes,
        uploadedById: permission.user.id,
        jobDocumentId: jobId,
        jobDocumentKind: blank.jobDocumentKind,
        sourceTemplateId: templateId,
        generated: true,
      },
      select: { id: true },
    });
  } catch (error) {
    console.error("[forms] recording a filled sheet failed", error);
    await deleteFile(stored.storagePath);
    return { ok: false, error: "That form could not be saved." };
  }

  if (previous) {
    await deleteFile(previous.storagePath);
    await db.attachment.delete({ where: { id: previous.id } }).catch(() => {});
  }

  await recordAudit({
    actorId: permission.user.id,
    entityType: "Job",
    entityId: jobId,
    jobId,
    action: "updated",
    detail: {
      field: draft.templateLabel,
      to:
        filled.empty.length > 0
          ? `filled and attached, ${filled.empty.length} box${filled.empty.length === 1 ? "" : "es"} left blank`
          : "filled and attached",
    },
  });

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath(`/jobs/${jobId}/sign-off/${templateId}`);
  return { ok: true, id: created.id, empty: filled.empty.length };
}
