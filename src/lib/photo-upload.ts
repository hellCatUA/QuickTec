"use client";

/**
 * Getting a photo off a phone and onto the server.
 *
 * The server caps every photo at 2400px on the long edge, so a 12-megapixel
 * original is four fifths bytes that are thrown away on arrival. Over a site's
 * LTE that waste is the whole wait: ten photos is 35 MB of upload, minutes on
 * a bad signal, and it exceeded the request limit at the end of it — so the
 * tech watched a progress-free spinner and then lost all ten.
 *
 * Shrinking here, to exactly the size the server would have produced, turns
 * that into about 6 MB. Nothing is lost: the server was going to discard those
 * pixels regardless.
 */

/** The same cap the server applies. Sending more is sending it to be deleted. */
const MAX_EDGE = 2400;
const JPEG_QUALITY = 0.85;

/**
 * Enough of the original to carry its EXIF.
 *
 * Re-encoding drops the timestamp and the GPS fix, which are the only evidence
 * a photo was taken at the site rather than in a car park afterwards. Rather
 * than parse them in the browser, the head of the original file comes along and
 * the server reads them with the same code it always has — a few kilobytes to
 * keep a fact worth keeping.
 */
const EXIF_HEAD_BYTES = 64 * 1024;

export type PreparedPhoto = {
  /** What to upload: the shrunk photo, or the original when it cannot be. */
  file: File;
  /** The original's first bytes, for the EXIF. Null when there is no point. */
  exif: Blob | null;
  /** For telling somebody how much was saved. */
  originalBytes: number;
};

/**
 * Shrinks a photo to what the server would have kept.
 *
 * Every failure path returns the original untouched. A browser that cannot
 * decode HEIC, a canvas that runs out of memory on an older phone, an
 * unfamiliar format — none of them are reasons to lose the photo, and the
 * server handles all of them already.
 */
export async function prepareForUpload(file: File): Promise<PreparedPhoto> {
  const untouched: PreparedPhoto = {
    file,
    exif: null,
    originalBytes: file.size,
  };

  if (!file.type.startsWith("image/")) return untouched;
  if (typeof createImageBitmap !== "function") return untouched;

  try {
    // "from-image" so the pixels come out the way up they will be seen. The
    // rotation is then baked in and the EXIF orientation that follows is about
    // an image that no longer needs it — which is what sharp's rotate() does
    // to an upright photo anyway: nothing.
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });

    const longest = Math.max(bitmap.width, bitmap.height);
    if (longest <= MAX_EDGE) {
      bitmap.close();
      return untouched;
    }

    const scale = MAX_EDGE / longest;
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");
    if (!context) {
      bitmap.close();
      return untouched;
    }
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
    );
    // A canvas that produced nothing, or somehow produced something bigger
    // than what it started from. Either way the original is the better answer.
    if (!blob || blob.size >= file.size) return untouched;

    return {
      file: new File([blob], renameToJpeg(file.name), { type: "image/jpeg" }),
      exif: file.slice(0, Math.min(EXIF_HEAD_BYTES, file.size)),
      originalBytes: file.size,
    };
  } catch {
    return untouched;
  }
}

/** IMG_2328.HEIC becomes IMG_2328.jpg, because that is what it now is. */
function renameToJpeg(name: string): string {
  const base = name.replace(/\.[^.]+$/, "");
  return `${base || "photo"}.jpg`;
}
