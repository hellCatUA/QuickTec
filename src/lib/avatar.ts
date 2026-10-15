import { db } from "@/lib/db";
import { looksLikeImage, processAvatar } from "@/lib/images";
import { recordProfileEvents } from "@/lib/profile-history";
import { deleteFile, fileVersion, storeAvatar } from "@/lib/storage";

/**
 * Profile pictures.
 *
 * Every picture is a copy on the uploads volume, served through a route that
 * checks who is asking — never NextCloud's own address, which would show it to
 * whoever NextCloud shows it to rather than whoever the company decided.
 */

/** Where the browser asks for somebody's picture. Changes when the picture does. */
export function avatarSrc(userId: string, avatarPath: string | null): string | null {
  return avatarPath ? `/api/avatars/${userId}?v=${fileVersion(avatarPath)}` : null;
}

/** Where a picture waiting on an answer is shown to whoever gives it. */
export function requestedAvatarSrc(userId: string, requestId: string): string {
  return `/api/avatars/${userId}?request=${encodeURIComponent(requestId)}`;
}

/** Big enough for any real photo, small enough that nobody fills the volume with one. */
export const AVATAR_MAX_BYTES = 15 * 1024 * 1024;

/**
 * Turns an upload into a stored picture, or says why it cannot be one.
 */
export async function storeUploadedAvatar(
  userId: string,
  file: File,
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  if (file.size === 0) return { ok: false, error: "Pick a photo first." };
  if (file.size > AVATAR_MAX_BYTES) {
    return { ok: false, error: "That photo is too large. Pick one under 15 MB." };
  }
  const data = Buffer.from(await file.arrayBuffer());
  if (!looksLikeImage(data)) {
    return { ok: false, error: "That file is not a photo." };
  }
  try {
    const square = await processAvatar(data, file.type);
    return { ok: true, path: await storeAvatar(userId, square) };
  } catch (error) {
    console.error("[avatar] could not process an upload:", error);
    return { ok: false, error: "That photo could not be read. Try another one." };
  }
}

/**
 * Copies somebody's NextCloud picture the first time there is one to copy.
 *
 * Only a picture they chose: NextCloud draws an initial on a coloured circle
 * for everybody who has not, and says which it handed over. Taking the drawn
 * one would fill the profile with something nobody picked — and, once there
 * is a picture, changing it needs a supervisor's answer.
 *
 * Best effort and never in the way of signing in: a NextCloud that will not
 * hand the picture over without a session, a timeout, a file that is not an
 * image — each of them just leaves the profile without one.
 */
export async function importNextcloudPicture(userId: string, url: string): Promise<void> {
  try {
    const current = await db.user.findUnique({
      where: { id: userId },
      select: { avatarPath: true },
    });
    if (!current || current.avatarPath) return;

    const response = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      redirect: "follow",
    });
    if (!response.ok) return;
    if (response.headers.get("x-nc-iscustomavatar") === "0") return;
    if (!(response.headers.get("content-type") ?? "").startsWith("image/")) return;

    const declared = Number(response.headers.get("content-length") ?? 0);
    if (declared > AVATAR_MAX_BYTES) return;
    const data = Buffer.from(await response.arrayBuffer());
    if (data.byteLength > AVATAR_MAX_BYTES || !looksLikeImage(data)) return;

    const path = await storeAvatar(
      userId,
      await processAvatar(data, response.headers.get("content-type") ?? ""),
    );

    // Only into an empty slot: a picture set while this was on its way —
    // by them, or by their supervisor — wins.
    const taken = await db.user.updateMany({
      where: { id: userId, avatarPath: null },
      data: { avatarPath: path },
    });
    if (taken.count === 0) {
      await deleteFile(path);
      return;
    }

    await recordProfileEvents({
      actorId: null,
      userId,
      kind: "imported",
      changes: [{ field: "picture", from: null, to: "Picture from NextCloud" }],
      source: "NextCloud",
    });
  } catch (error) {
    console.error("[avatar] could not copy the NextCloud picture:", error);
  }
}
