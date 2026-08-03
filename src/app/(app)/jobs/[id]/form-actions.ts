"use server";

import { readFile } from "node:fs/promises";
import { revalidatePath } from "next/cache";
import { recordAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { loadJobForExport } from "@/lib/exports/job-data";
import { fillForm } from "@/lib/forms/fill";
import { canOnJob } from "@/lib/scope";
import { getSessionUser } from "@/lib/session";
import {
  absolutePath,
  deleteFile,
  storeFile,
  storageErrorMessage,
} from "@/lib/storage";

/**
 * Filling the representing company's sheet from the job.
 *
 * The whole point of the feature lands here: everything on that sheet is
 * already in the app, and the tech is standing in a lobby retyping it into a
 * phone. This produces the filled PDF instead, from the mapping somebody set
 * up once for this company.
 *
 * Producing it is deliberately something a person asks for rather than
 * something that happens on its own. The values are only as complete as the
 * job is, and a sheet that quietly regenerated itself after the tech had
 * checked it is a sheet nobody checked.
 */

export type FillResult =
  | { ok: true; id: string; empty: string[] }
  | { ok: false; error: string };

export async function fillJobForm(formData: FormData): Promise<FillResult> {
  const attachmentId = String(formData.get("attachmentId") ?? "");

  const blank = await db.attachment.findUnique({
    where: { id: attachmentId },
    select: {
      id: true,
      storagePath: true,
      originalName: true,
      jobDocumentId: true,
      jobDocumentKind: true,
      generated: true,
      sourceTemplate: {
        select: {
          id: true,
          label: true,
          placements: {
            where: { source: { not: null } },
            orderBy: [{ page: "asc" }, { order: "asc" }],
            select: {
              fieldName: true,
              page: true,
              x: true,
              y: true,
              width: true,
              height: true,
              kind: true,
              source: true,
              staticText: true,
              rowIndex: true,
              fontSize: true,
            },
          },
        },
      },
    },
  });

  if (!blank?.jobDocumentId || blank.generated) {
    return { ok: false, error: "Not found." };
  }
  if (!blank.sourceTemplate) {
    return {
      ok: false,
      error: "This sheet did not come from a company form, so there is nothing to fill it from.",
    };
  }
  if (blank.sourceTemplate.placements.length === 0) {
    return {
      ok: false,
      error:
        "Nobody has said what goes in this form's boxes yet. Set it up against " +
        "the company in the directory and it will fill itself from then on.",
    };
  }

  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const job = await db.job.findUnique({
    where: { id: blank.jobDocumentId },
    select: {
      id: true,
      projectId: true,
      createdById: true,
      assignments: { select: { userId: true } },
    },
  });
  if (!job) return { ok: false, error: "Job not found." };

  const scope = {
    projectId: job.projectId,
    createdById: job.createdById,
    assigneeIds: job.assignments.map((assignment) => assignment.userId),
  };
  if (!(await canOnJob(user, "deliverable.upload", scope))) {
    return { ok: false, error: "You cannot change this job's paperwork." };
  }

  const data = await loadJobForExport(job.id);
  if (!data) return { ok: false, error: "Job not found." };

  let source: Buffer;
  try {
    source = await readFile(absolutePath(blank.storagePath));
  } catch {
    return { ok: false, error: "The blank this job was given is missing." };
  }

  let filled;
  try {
    filled = await fillForm(source, blank.sourceTemplate.placements, {
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
    stored = await storeFile(job.id, filled.bytes, "application/pdf");
  } catch (error) {
    console.error("[forms] storing a filled sheet failed", error);
    return { ok: false, error: storageErrorMessage(error) };
  }

  // A filled sheet is the blank plus the job as it stood, so it is replaced
  // rather than added to. Two copies of the same sign-off differing only in
  // when they were made is exactly what gets the wrong one signed.
  const previous = await db.attachment.findFirst({
    where: {
      jobDocumentId: job.id,
      generated: true,
      sourceTemplateId: blank.sourceTemplate.id,
    },
    select: { id: true, storagePath: true },
  });

  const name = blank.originalName.replace(/\.pdf$/i, "");

  let created;
  try {
    created = await db.attachment.create({
      data: {
        storagePath: stored.storagePath,
        originalName: `${name} — filled.pdf`,
        mimeType: "application/pdf",
        sizeBytes: stored.sizeBytes,
        uploadedById: user.id,
        jobDocumentId: job.id,
        jobDocumentKind: blank.jobDocumentKind,
        sourceTemplateId: blank.sourceTemplate.id,
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
    actorId: user.id,
    entityType: "Job",
    entityId: job.id,
    action: "updated",
    detail: {
      field: blank.sourceTemplate.label,
      to: filled.empty.length > 0 ? `filled, ${filled.empty.length} left blank` : "filled",
    },
  });

  revalidatePath(`/jobs/${job.id}`);
  return { ok: true, id: created.id, empty: filled.empty };
}
