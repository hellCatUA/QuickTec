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
import { absolutePath, fileExists } from "@/lib/storage";

/**
 * Serves somebody's profile picture to whoever may see it.
 *
 * The picture has a level like every other line of a profile, so the same
 * question is asked here as on the page that shows it: a Federated picture is
 * for people signed in to QuickTec, and not for an outside account. A picture
 * still waiting on an answer is shown to the person who sent it and to whoever
 * may answer it, nobody else.
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

  const requestId = new URL(request.url).searchParams.get("request");
  let storagePath: string | null = null;

  if (requestId) {
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

  const data = await readFile(absolutePath(storagePath));
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Length": String(data.byteLength),
      // Private, because who may see it is decided per person. Not immutable:
      // a picture can stop being visible to somebody without changing, and a
      // cache that kept it for a year would go on showing it.
      "Cache-Control": "private, max-age=300",
    },
  });
}
