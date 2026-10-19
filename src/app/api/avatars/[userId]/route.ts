import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  audienceFor,
  levelsFor,
  loadPrivacySettings,
  loadProfile,
  mayEditProfileOf,
  shows,
} from "@/lib/profile";
import { getSessionUser } from "@/lib/session";
import { absolutePath, fileExists, fileVersion } from "@/lib/storage";

/**
 * Serves somebody's profile picture to whoever may see it.
 *
 * The picture has a level like every other line of a profile, so the same
 * question is asked here as on the page that shows it: a Federated picture is
 * for people signed in to QuickTec, and not for a guest. A picture
 * still waiting on an answer is shown to the person who sent it and to whoever
 * may answer it, nobody else — and so is an earlier picture, to whoever may
 * put it back.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const viewer = await getSessionUser();
  if (!viewer) return new NextResponse("Unauthorized", { status: 401 });

  const { userId } = await params;
  const profile = await loadProfile(userId);
  if (!profile) return new NextResponse("Not found", { status: 404 });

  const query = new URL(request.url).searchParams;
  const requestId = query.get("request");
  const pictureId = query.get("picture");
  let storagePath: string | null = null;

  if (pictureId) {
    const earlier = await db.profilePicture.findFirst({
      where: { id: pictureId, userId },
      select: { path: true },
    });
    const allowed = viewer.id === userId || mayEditProfileOf(viewer, profile);
    if (!earlier || !allowed) return new NextResponse("Not found", { status: 404 });
    storagePath = earlier.path;
  } else if (requestId) {
    const pending = await db.profileRequest.findFirst({
      where: { id: requestId, userId, field: "PICTURE", status: "PENDING" },
      select: { picturePath: true },
    });
    const allowed = viewer.id === userId || mayEditProfileOf(viewer, profile);
    if (!pending || !allowed) return new NextResponse("Not found", { status: 404 });
    storagePath = pending.picturePath;
  } else {
    const audience = await audienceFor(viewer, profile);
    const levels = levelsFor(profile, await loadPrivacySettings());
    if (!shows(levels, audience, "picture")) {
      return new NextResponse("Not found", { status: 404 });
    }
    storagePath = profile.avatarPath;
  }

  if (!storagePath || !(await fileExists(storagePath))) {
    return new NextResponse("Not found", { status: 404 });
  }

  // Asked again every time, because who may see it is decided per person and
  // can change without the picture changing — but answered with a 304 when
  // the browser already has this one, so asking is all it costs.
  const etag = `"${fileVersion(storagePath)}"`;
  const headers = {
    "Cache-Control": "private, no-cache",
    ETag: etag,
  };
  if (request.headers.get("if-none-match") === etag) {
    return new NextResponse(null, { status: 304, headers });
  }

  const data = await readFile(absolutePath(storagePath));
  return new NextResponse(new Uint8Array(data), {
    headers: {
      ...headers,
      "Content-Type": "image/jpeg",
      "Content-Length": String(data.byteLength),
    },
  });
}
