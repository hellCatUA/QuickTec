import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { loadJobForExport } from "@/lib/exports/job-data";
import { effectivePlacements, loadDraft } from "@/lib/forms/draft";
import { fillForm } from "@/lib/forms/fill";
import { canOnJob } from "@/lib/scope";
import { getSessionUser } from "@/lib/session";
import { absolutePath } from "@/lib/storage";

/**
 * The sheet as it stands, rendered but not kept.
 *
 * The review screen needs to show what is about to be attached, and the only
 * honest way to do that is to produce the same document the same way. Nothing
 * is written: this is a picture of a decision nobody has taken yet, and a
 * preview that quietly left a file behind would put a half-checked sheet in
 * the job's paperwork.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; templateId: string }> },
) {
  const user = await getSessionUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const { id, templateId } = await params;

  const job = await db.job.findUnique({
    where: { id },
    select: {
      projectId: true,
      createdById: true,
      assignments: { select: { userId: true } },
    },
  });
  if (!job) return new NextResponse("Not found", { status: 404 });

  const allowed = await canOnJob(user, "job.view", {
    projectId: job.projectId,
    createdById: job.createdById,
    assigneeIds: job.assignments.map((assignment) => assignment.userId),
  });
  if (!allowed) return new NextResponse("Not found", { status: 404 });

  const draft = await loadDraft(id, templateId);
  if (!draft) return new NextResponse("Not found", { status: 404 });

  const blank = await db.attachment.findUnique({
    where: { id: draft.attachmentId },
    select: { storagePath: true },
  });
  if (!blank) return new NextResponse("Not found", { status: 404 });

  const data = await loadJobForExport(id);
  if (!data) return new NextResponse("Not found", { status: 404 });

  let bytes: Buffer;
  try {
    const source = await readFile(absolutePath(blank.storagePath));
    const filled = await fillForm(source, effectivePlacements(draft.boxes), {
      data,
      now: new Date(),
    });
    bytes = filled.bytes;
  } catch (error) {
    console.error("[forms] rendering a preview failed", error);
    return new NextResponse("Preview failed", { status: 500 });
  }

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": "inline; filename=\"preview.pdf\"",
      // Regenerated on every request by design: it has to reflect what was
      // typed a second ago, not what was typed the first time it was opened.
      "Cache-Control": "no-store",
    },
  });
}
