import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * File storage on the uploads volume.
 *
 * Paths are always built here from ids we generated — a filename that came
 * from a phone never reaches the filesystem. Everything still goes through
 * assertInside() before a write or delete, so a bug upstream cannot turn into
 * a write outside the volume.
 */

export function uploadsRoot(): string {
  return process.env.UPLOADS_DIR || path.join(process.cwd(), "data", "uploads");
}

function assertInside(absolute: string): void {
  const root = path.resolve(uploadsRoot());
  const resolved = path.resolve(absolute);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error("Refusing to touch a path outside the uploads volume");
  }
}

export function absolutePath(storagePath: string): string {
  const absolute = path.join(uploadsRoot(), storagePath);
  assertInside(absolute);
  return absolute;
}

/** Extensions we are willing to write. Anything else is stored as .bin. */
const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

export function extensionFor(mimeType: string): string {
  return EXTENSIONS[mimeType] ?? "bin";
}

export type StoredFile = {
  storagePath: string;
  sizeBytes: number;
  sha256: string;
};

/**
 * Writes a file under jobs/<jobId>/. The name is a fresh uuid, so two techs
 * uploading IMG_0001.HEIC within a second of each other cannot collide.
 */
export async function storeFile(
  jobId: string,
  data: Buffer,
  mimeType: string,
): Promise<StoredFile> {
  const directory = path.join("jobs", jobId);
  const name = `${randomUUID()}.${extensionFor(mimeType)}`;
  const storagePath = path.join(directory, name);

  const absolute = absolutePath(storagePath);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, data);

  return {
    storagePath,
    sizeBytes: data.byteLength,
    sha256: createHash("sha256").update(data).digest("hex"),
  };
}

/**
 * Duplicates a stored file under another key.
 *
 * Used when a company's saved blank is put onto a job: the job keeps its own
 * copy, so replacing the template next year cannot change what a finished job
 * went out on. Returns null if the source is gone, which is a missing file
 * rather than a failure worth stopping a save for.
 */
export async function copyFile(
  storagePath: string,
  jobId: string,
): Promise<StoredFile | null> {
  const source = absolutePath(storagePath);
  let data: Buffer;
  try {
    data = await readFile(source);
  } catch {
    return null;
  }

  const extension = path.extname(storagePath).slice(1) || "bin";
  const target = path.join("jobs", jobId, `${randomUUID()}.${extension}`);

  const absolute = absolutePath(target);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, data);

  return {
    storagePath: target,
    sizeBytes: data.byteLength,
    sha256: createHash("sha256").update(data).digest("hex"),
  };
}

/**
 * Turns a failed write into a sentence naming the fix.
 *
 * These surface at the worst moment — a tech on site with a photo to file —
 * and an unhandled throw reaches them as a Next.js error digest, which is a
 * number and nothing else. The two that actually happen are a volume the
 * container cannot write to and a volume that is full, and both are somebody
 * else's five-minute job once they know which it is.
 */
export function storageErrorMessage(error: unknown): string {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: unknown }).code)
      : "";

  if (code === "EACCES" || code === "EPERM") {
    return "The uploads volume is not writable by the app. It has to belong to uid 1001 — see the deployment guide.";
  }
  if (code === "ENOSPC") {
    return "The uploads volume is full. Free some space and try again.";
  }
  if (code === "EROFS") {
    return "The uploads volume is mounted read-only.";
  }
  return "The file could not be written to storage. The server log has the detail.";
}

export async function deleteFile(storagePath: string): Promise<void> {
  // A missing file is not an error: the row is what matters, and a half-failed
  // upload should still be removable.
  await rm(absolutePath(storagePath), { force: true });
}

export async function fileExists(storagePath: string): Promise<boolean> {
  try {
    await stat(absolutePath(storagePath));
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether the app can actually write to the uploads volume.
 *
 * A bind mount replaces whatever the image set up with the host directory's
 * ownership, so a volume the container cannot write to looks completely normal
 * until the first upload — which is a tech on site with a photo, months after
 * anybody could remember what changed. Checked where somebody can see it
 * instead.
 */
export async function uploadsWritable(): Promise<
  { ok: true } | { ok: false; reason: string }
> {
  const probe = path.join(uploadsRoot(), ".write-probe");
  try {
    await mkdir(uploadsRoot(), { recursive: true });
    await writeFile(probe, "");
    await rm(probe, { force: true });
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: storageErrorMessage(error) };
  }
}

export function readFileStream(storagePath: string) {
  return createReadStream(absolutePath(storagePath));
}

export async function fileSize(storagePath: string): Promise<number> {
  return (await stat(absolutePath(storagePath))).size;
}
