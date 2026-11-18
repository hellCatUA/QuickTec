import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { signatureInk } from "@/lib/forms/wo-signature";
import { canOnJob } from "@/lib/scope";
import { getSessionUser } from "@/lib/session";
import { absolutePath } from "@/lib/storage";
import { modSignatureOf } from "@/lib/wo-sign-off-data";

/**
 * The customer's signature as the work order will carry it, for the screen's
 * preview.
 *
 * The same picture the server draws when it saves (wo-signature.ts), made the
 * same way from the same signature. The preview used to fetch the stored file
 * and draw it itself: a damaged one froze the page, and one missing its last
 * few bytes showed a signature the saved copy did not have.
 *
 * 404 when the job has no signature to give; 422 when it has one that cannot
 * be read, which the screen says in so many words.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await params;
  const job = await db.job.findUnique({
    where: { id },
    select: {
      projectId: true,
      createdById: true,
      assignments: { select: { userId: true } },
      signatures: {
        select: {
          id: true,
          kind: true,
          skipped: true,
          signedAt: true,
          attachment: { select: { storagePath: true } },
        },
      },
    },
  });
  if (!job) return new NextResponse("Not found", { status: 404 });

  // Whoever may sign the work order off: the screen this serves.
  const allowed = await canOnJob(user, "deliverable.upload", {
    projectId: job.projectId,
    createdById: job.createdById,
    assigneeIds: job.assignments.map((assignment) => assignment.userId),
  });
  if (!allowed) return new NextResponse("Not found", { status: 404 });

  const signature = modSignatureOf(job.signatures);
  if (!signature?.attachment) return new NextResponse("No signature", { status: 404 });

  let ink: Uint8Array | null = null;
  try {
    ink = await signatureInk(await readFile(absolutePath(signature.attachment.storagePath)));
  } catch (error) {
    console.error("[work order] the signature file is missing", error);
  }
  if (!ink) return new NextResponse("The signature could not be read", { status: 422 });

  return new NextResponse(new Uint8Array(ink), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "private, no-store",
    },
  });
}
