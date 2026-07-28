import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import sharp from "sharp";
import { attachmentOwner } from "@/lib/attachments";
import { db } from "@/lib/db";
import { canOnJob } from "@/lib/scope";
import { getSessionUser, permissionScope } from "@/lib/session";
import { absolutePath, fileExists } from "@/lib/storage";

/**
 * Serves an uploaded file.
 *
 * Photos are not public: the volume sits behind the app rather than being
 * mapped into a static route, so every read goes through the same job-scope
 * check as the page that links to it. Serving them from Nginx directly would
 * mean anyone with a URL could read another crew's site photos.
 */

const THUMB_WIDTHS = new Set([200, 400, 800]);

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await params;

  const attachment = await db.attachment.findUnique({
    where: { id },
    select: {
      storagePath: true,
      mimeType: true,
      originalName: true,
      uploadedById: true,
    },
  });
  if (!attachment) return new NextResponse("Not found", { status: 404 });

  const owner = await attachmentOwner(id);
  if (!owner) return new NextResponse("Not found", { status: 404 });

  if (owner.kind === "job") {
    const job = await db.job.findUnique({
      where: { id: owner.jobId },
      select: {
        projectId: true,
        createdById: true,
        assignments: { select: { userId: true } },
      },
    });
    if (!job) return new NextResponse("Not found", { status: 404 });

    const allowed = await canOnJob(user, "job.view", {
      projectId: job.projectId,
      assigneeIds: job.assignments.map((assignment) => assignment.userId),
      createdById: job.createdById,
    });
    if (!allowed) return new NextResponse("Not found", { status: 404 });
  } else if (owner.userId !== user.id) {
    // Mileage photos: the owner always, plus whoever can see other people's
    // trips at a wide enough scope.
    const scope = permissionScope(user, "mileage.view");
    if (!scope || scope === "OWN") {
      return new NextResponse("Not found", { status: 404 });
    }
    if (scope !== "ALL") {
      const isReport = await db.user.count({
        where: { id: owner.userId, directSupervisorId: user.id },
      });
      if (isReport === 0) return new NextResponse("Not found", { status: 404 });
    }
  }

  if (!(await fileExists(attachment.storagePath))) {
    return new NextResponse("File missing from storage", { status: 410 });
  }

  const width = Number(new URL(request.url).searchParams.get("w"));
  const wantsThumb =
    THUMB_WIDTHS.has(width) && attachment.mimeType.startsWith("image/");

  const data = wantsThumb
    ? await thumbnail(attachment.storagePath, width)
    : await readFile(absolutePath(attachment.storagePath));

  return new NextResponse(new Uint8Array(data), {
    headers: {
      // Derivatives are re-encoded as JPEG whatever the original was, so the
      // header has to follow what is actually in the body.
      "Content-Type": wantsThumb ? "image/jpeg" : attachment.mimeType,
      "Content-Length": String(data.byteLength),
      "Content-Disposition": `inline; filename="${attachment.originalName.replace(/[^\w.\-]/g, "_")}"`,
      // Private: the response is scoped to this user's permissions, so a shared
      // cache must never hand it to anyone else. Immutable because the id maps
      // to one file for its lifetime.
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}

/**
 * Derivatives are written next to the original and reused. A phone grid of
 * thirty 2400px photos is several megabytes over a weak signal otherwise.
 */
async function thumbnail(storagePath: string, width: number): Promise<Buffer> {
  const key = createHash("sha1").update(`${storagePath}:${width}`).digest("hex");
  const cachePath = absolutePath(path.join("cache", `${key}.jpg`));

  try {
    return await readFile(cachePath);
  } catch {
    const resized = await sharp(absolutePath(storagePath))
      .resize({ width, withoutEnlargement: true })
      .jpeg({ quality: 75 })
      .toBuffer();

    await mkdir(path.dirname(cachePath), { recursive: true });
    await writeFile(cachePath, resized);
    return resized;
  }
}
