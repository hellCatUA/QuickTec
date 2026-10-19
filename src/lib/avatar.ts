import { db } from "@/lib/db";
import { looksLikeImage, processAvatar } from "@/lib/images";
import { recordProfileEvents, type Approval } from "@/lib/profile-history";
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

/** Where an earlier picture is shown to whoever may put it back. */
export function archivedAvatarSrc(userId: string, pictureId: string): string {
  return `/api/avatars/${userId}?picture=${encodeURIComponent(pictureId)}`;
}

/** Where a picture came from, as its history says it. */
export const PICTURE_SOURCE = {
  manual: (name: string) => `Manual Import: ${name}`,
  photoId: "Manual Import: ID",
  nextcloud: "Auto-Import: NC",
} as const;

/**
 * Makes a stored picture somebody's picture, and keeps it in their archive so
 * it can be put back after it has been replaced or taken down. The picture it
 * replaces stays in the archive too: nothing approved is thrown away.
 */
export async function putUpPicture(input: {
  userId: string;
  path: string;
  source: string;
  addedById: string | null;
  approval?: Approval | null;
}): Promise<void> {
  await db.$transaction([
    db.profilePicture.create({
      data: {
        userId: input.userId,
        path: input.path,
        source: input.source,
        addedById: input.addedById,
        approvedById:
          input.approval && "byId" in input.approval ? input.approval.byId : null,
        approvedBySystem: Boolean(input.approval && "bySystem" in input.approval),
      },
    }),
    db.user.update({
      where: { id: input.userId },
      data: { avatarPath: input.path, pictureSetAt: new Date() },
    }),
  ]);
}

/**
 * Who approved an earlier picture, for the entry that puts it back: whoever
 * approved it, or whoever put it up when nobody else had to, or QuickTec.
 */
export function approvalOf(picture: {
  approvedById: string | null;
  approvedBySystem: boolean;
  addedById: string | null;
}): Approval | null {
  if (picture.approvedBySystem) return { bySystem: true };
  const byId = picture.approvedById ?? picture.addedById;
  return byId ? { byId } : null;
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
 * Copies somebody's NextCloud picture, once.
 *
 * Only a picture they chose: NextCloud draws an initial on a coloured circle
 * for everybody who has not, and says which it handed over in a header. With
 * no header there is no telling, so nothing is copied — a drawn initial taken
 * for a photo would sit there needing a supervisor's answer to replace.
 *
 * Once means once: when the profile has ever had a picture — copied, set,
 * or approved, even one a manager has since taken down — this does nothing,
 * so a picture a manager removed does not come back at the next sign-in.
 *
 * Only from NextCloud itself, without following redirects anywhere else, and
 * never more than the size limit read into memory. Best effort and never in
 * the way of signing in: any failure just leaves the profile without one.
 */
export async function importNextcloudPicture(userId: string, url: string): Promise<void> {
  try {
    const issuer = process.env.NEXTCLOUD_ISSUER;
    if (!issuer) return;
    const source = new URL(url);
    if (source.host !== new URL(issuer).host) return;
    if (source.protocol !== "https:" && source.protocol !== "http:") return;

    const current = await db.user.findUnique({
      where: { id: userId },
      select: { avatarPath: true, pictureSetAt: true },
    });
    if (!current || current.avatarPath || current.pictureSetAt) return;

    const response = await fetch(source, {
      signal: AbortSignal.timeout(5000),
      redirect: "manual",
    });
    if (response.status !== 200) return;
    if (response.headers.get("x-nc-iscustomavatar") !== "1") return;
    const type = response.headers.get("content-type") ?? "";
    if (!type.startsWith("image/")) return;
    if (Number(response.headers.get("content-length") ?? 0) > AVATAR_MAX_BYTES) return;

    const data = await readCapped(response, AVATAR_MAX_BYTES);
    if (!data || !looksLikeImage(data)) return;

    const path = await storeAvatar(userId, await processAvatar(data, type));

    // Only into an empty slot: a picture set while this was on its way —
    // by them, or by their supervisor — wins.
    const taken = await db.user.updateMany({
      where: { id: userId, avatarPath: null, pictureSetAt: null },
      data: { avatarPath: path, pictureSetAt: new Date() },
    });
    if (taken.count === 0) {
      await deleteFile(path);
      return;
    }
    // Approved by QuickTec, as anything NextCloud hands over is: an earlier
    // picture put back later says so.
    await db.profilePicture.create({
      data: { userId, path, source: PICTURE_SOURCE.nextcloud, approvedBySystem: true },
    });

    await recordProfileEvents({
      actorId: null,
      userId,
      changes: [{ field: "picture", from: null, to: "Picture" }],
      source: PICTURE_SOURCE.nextcloud,
    });
  } catch (error) {
    console.error("[avatar] could not copy the NextCloud picture:", error);
  }
}

/** The body, or null as soon as it passes the limit — never more than that held. */
async function readCapped(response: Response, limit: number): Promise<Buffer | null> {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
