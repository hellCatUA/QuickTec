import path from "node:path";
import exifReader from "exif-reader";
import sharp from "sharp";

/**
 * Photo pipeline for uploads from the field.
 *
 * Everything arrives from an iPhone, so the input is normally HEIC with the
 * orientation in EXIF and a GPS fix attached. The output is always a JPEG
 * that opens anywhere — in the ZIP the client gets, in the internal PDF, and
 * on a Windows desktop that has never heard of HEIC.
 *
 * EXIF is read before conversion, because converting drops it, and the
 * timestamp and GPS fix are the only evidence that a photo was taken at the
 * site rather than in a car park afterwards.
 */

/** Longest edge. Large enough to read a serial number, small enough to upload. */
const MAX_EDGE = 2400;
const JPEG_QUALITY = 82;

export type ProcessedImage = {
  data: Buffer;
  mimeType: string;
  width: number | null;
  height: number | null;
  capturedAt: Date | null;
  gpsLat: number | null;
  gpsLng: number | null;
  watermarked: boolean;
};

/**
 * Whether this is a HEIF-family container that has to be transcoded before
 * anything else can open it. iPhones send heic/heix/mif1; newer Android and
 * some desktop tools send avif. All of them are unreadable in a browser that
 * has to display the report, so all of them become JPEG.
 */
export function isHeic(mimeType: string, data: Buffer): boolean {
  if (/^image\/(heic|heif|avif)/i.test(mimeType)) return true;

  // Some clients send application/octet-stream. The ISO-BMFF brand sits at
  // bytes 4..12 and is the only reliable tell.
  const brand = data.subarray(4, 12).toString("latin1");
  return (
    brand.startsWith("ftyp") &&
    /heic|heix|hevc|hevx|mif1|msf1|avif|avis/.test(brand.slice(4))
  );
}

export function isPdf(mimeType: string, data: Buffer): boolean {
  return (
    mimeType === "application/pdf" ||
    data.subarray(0, 5).toString("latin1") === "%PDF-"
  );
}

/**
 * Whether these bytes are a picture at all, judged by the magic number.
 *
 * Worth knowing separately from whether the pipeline succeeded. "That file
 * could not be read as a photo" is true and useful when somebody attached a
 * .mov; said about a perfectly good JPEG that failed for a reason on our side,
 * it sends a tech back out to retake a photo that was never the problem.
 */
export function looksLikeImage(data: Buffer): boolean {
  if (data.length < 12) return false;

  const jpeg = data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  const png = data.subarray(0, 8).toString("latin1") === "\x89PNG\r\n\x1a\n";
  const gif = data.subarray(0, 3).toString("latin1") === "GIF";
  const webp =
    data.subarray(0, 4).toString("latin1") === "RIFF" &&
    data.subarray(8, 12).toString("latin1") === "WEBP";
  const tiff =
    data.subarray(0, 4).toString("latin1") === "II*\0" ||
    data.subarray(0, 4).toString("latin1") === "MM\0*";

  return (
    jpeg || png || gif || webp || tiff || isHeic("application/octet-stream", data)
  );
}

/**
 * [degrees, minutes, seconds] plus a hemisphere letter -> signed decimal.
 * Exported so the conversion can be tested directly: sharp cannot write a GPS
 * IFD, so there is no way to round-trip a geotagged file in a test.
 */
export function gpsToDecimal(
  parts: number[] | undefined,
  ref: string | undefined,
): number | null {
  if (!parts || parts.length < 3) return null;
  const [degrees, minutes, seconds] = parts;
  const value = degrees + minutes / 60 + seconds / 3600;
  if (!Number.isFinite(value)) return null;
  return ref === "S" || ref === "W" ? -value : value;
}

type ExifFacts = {
  capturedAt: Date | null;
  gpsLat: number | null;
  gpsLng: number | null;
};

function readExif(raw: Buffer | undefined): ExifFacts {
  const empty: ExifFacts = { capturedAt: null, gpsLat: null, gpsLng: null };
  if (!raw) return empty;

  try {
    const exif = exifReader(raw);
    const taken = exif.Photo?.DateTimeOriginal ?? exif.Image?.DateTime;
    const gps = exif.GPSInfo;

    return {
      capturedAt: taken instanceof Date ? taken : null,
      gpsLat: gpsToDecimal(gps?.GPSLatitude as number[], gps?.GPSLatitudeRef),
      gpsLng: gpsToDecimal(gps?.GPSLongitude as number[], gps?.GPSLongitudeRef),
    };
  } catch {
    // A camera with malformed EXIF must not cost the tech their photo.
    return empty;
  }
}

async function heicToJpeg(data: Buffer): Promise<Buffer> {
  try {
    // Fast path. Whether this works depends on the HEVC decoder in the
    // libvips build, which varies between platforms.
    return await sharp(data).jpeg({ quality: 95 }).toBuffer();
  } catch {
    // Pure-JS libheif. Slower, but it decodes HEVC everywhere, and iPhone
    // photos are the entire input path for this app — they cannot be allowed
    // to fail on a platform quirk.
    const convert = (await import("heic-convert")).default;
    const output = await convert({
      buffer: new Uint8Array(data),
      format: "JPEG",
      quality: 0.95,
    });
    return Buffer.from(output);
  }
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * The font the stamp is drawn in, shipped with the app.
 *
 * Not a system font. The runtime image is Debian slim, which installs none at
 * all, and an SVG <text> with nothing to render it in draws exactly nothing —
 * the box appears, the label does not, and a photo goes into the record
 * without the one thing that says which job and which day it belongs to. That
 * is not something a person notices while working, so the dependency is
 * carried rather than assumed.
 */
const STAMP_FONT_FILE = path.join(
  process.cwd(),
  "assets",
  "fonts",
  "DejaVuSansMono.ttf",
);
/** The family name inside that file — pango needs both. */
const STAMP_FONT_FAMILY = "DejaVu Sans Mono";

/**
 * Bottom-right stamp: 2026-07-28-887766-SBUX-#24541
 *
 * Drawn as an SVG the same size as the image and composited, so the text sits
 * at a fixed offset from the corner regardless of aspect ratio. Sized relative
 * to the image so it stays legible on a 4032px photo and does not swamp a
 * small one.
 */
export type StampLayer = {
  input: Buffer;
  top: number;
  left: number;
};

/**
 * The two layers of the stamp: a dark plate, and the label on top of it.
 *
 * Split because they are rendered by different things. Shapes are geometry and
 * an SVG draws them anywhere; text needs a font, and the only way to be sure
 * which one is to hand the file over rather than name a family and hope.
 */
export async function stampLayers(
  text: string,
  width: number,
  height: number,
): Promise<StampLayer[]> {
  let fontSize = Math.max(16, Math.round(width / 48));
  const margin = Math.round(fontSize * 0.9);

  /**
   * Rendered before the plate rather than after: its real size is what the
   * plate is drawn to fit, so the plate cannot come out too small for the
   * label or too wide for the corner. The old code guessed the width from the
   * character count and a fudge factor.
   *
   * dpi is 72 so that a point is a pixel and the size asked for is the size
   * drawn — pango scales by dpi/72, and anything else silently multiplies it.
   */
  async function render(size: number) {
    return sharp({
      text: {
        text: `<span foreground="#ffffff">${escapeXml(text)}</span>`,
        font: `${STAMP_FONT_FAMILY} ${size}`,
        fontfile: STAMP_FONT_FILE,
        rgba: true,
        dpi: 72,
      },
    })
      .png()
      .toBuffer({ resolveWithObject: true });
  }

  let label = await render(fontSize);

  // A long assignment id on a narrow photo. Shrink to the width actually
  // available rather than letting the stamp run off the edge of the picture.
  const available = width - margin * 2;
  const wanted = label.info.width + Math.round(fontSize * 0.6) * 2;
  if (wanted > available) {
    fontSize = Math.max(8, Math.floor((fontSize * available) / wanted));
    label = await render(fontSize);
  }

  const padding = Math.round(fontSize * 0.6);
  const boxWidth = Math.min(width, label.info.width + padding * 2);
  const boxHeight = Math.min(height, label.info.height + padding * 2);
  const x = Math.max(0, width - boxWidth - margin);
  const y = Math.max(0, height - boxHeight - margin);

  const plate = Buffer.from(
    `<svg width="${boxWidth}" height="${boxHeight}" xmlns="http://www.w3.org/2000/svg">` +
      `<rect x="0" y="0" width="${boxWidth}" height="${boxHeight}" ` +
      `rx="${Math.round(fontSize * 0.3)}" fill="rgba(0,0,0,0.55)" /></svg>`,
  );

  return [
    { input: plate, left: x, top: y },
    { input: label.data, left: x + padding, top: y + padding },
  ];
}

export async function processImage(
  input: Buffer,
  mimeType: string,
  watermark?: string | null,
): Promise<ProcessedImage> {
  // PDFs are documents the client sent us; they pass through untouched.
  if (isPdf(mimeType, input)) {
    return {
      data: input,
      mimeType: "application/pdf",
      width: null,
      height: null,
      capturedAt: null,
      gpsLat: null,
      gpsLng: null,
      watermarked: false,
    };
  }

  const decoded = isHeic(mimeType, input) ? await heicToJpeg(input) : input;

  const source = sharp(decoded, { failOn: "none" });
  const metadata = await source.metadata();
  const facts = readExif(metadata.exif);

  let pipeline = sharp(decoded, { failOn: "none" })
    // Bakes in the EXIF orientation, so a portrait photo is not sideways in
    // the report once the metadata is stripped.
    .rotate()
    .resize({
      width: MAX_EDGE,
      height: MAX_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    });

  // Dimensions after rotation, which is what the watermark has to be placed on.
  // Encoded at the final quality so a photo with no stamp is compressed once
  // rather than twice.
  const rotated = await pipeline
    .clone()
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  const { width, height } = rotated.info;

  const finished = watermark
    ? await drawStamp(rotated.data, watermark, width, height)
    : { data: rotated.data, stamped: false };

  const data = finished.stamped
    ? await sharp(finished.data)
        .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
        .toBuffer()
    : finished.data;

  return {
    data,
    mimeType: "image/jpeg",
    width,
    height,
    capturedAt: facts.capturedAt,
    gpsLat: facts.gpsLat,
    gpsLng: facts.gpsLng,
    watermarked: finished.stamped,
  };
}

/**
 * Puts the stamp on a photo, or hands the photo back without one.
 *
 * The stamp is provenance and provenance is worth a lot — but not the picture
 * itself. Drawing text needs a font, pango and fontconfig, none of which the
 * photo needs; a libvips built without pango throws here and would otherwise
 * take the upload down with it. A tech standing in a server room with the only
 * photo of what they found there must not be told to take it again because a
 * corner label could not be drawn.
 *
 * The renderer is a parameter so this decision can be exercised directly: the
 * failure it exists for cannot be provoked through sharp on a build where text
 * happens to work.
 */
export async function drawStamp(
  photo: Buffer,
  text: string,
  width: number,
  height: number,
  render: typeof stampLayers = stampLayers,
): Promise<{ data: Buffer; stamped: boolean }> {
  try {
    const layers = await render(text, width, height);
    return { data: await sharp(photo).composite(layers).toBuffer(), stamped: true };
  } catch (error) {
    console.error("[images] the stamp could not be drawn", error);
    return { data: photo, stamped: false };
  }
}

/**
 * Whether the stamp comes out with any ink in it.
 *
 * The failure this catches has happened: with no font to render it, the plate
 * was drawn and the label was not, so every photo went into the record
 * carrying a black rectangle where the job and the date should be. Nothing
 * errored, nothing looked wrong until somebody opened a photo. Counting the
 * pixels is the only way to tell that apart from a stamp that worked.
 */
export async function stampHasInk(text = "PROBE-0000"): Promise<boolean> {
  const layers = await stampLayers(text, 1600, 1200);
  const label = layers[layers.length - 1]?.input;
  if (!label) return false;

  const { channels } = await sharp(label).stats();
  const alpha = channels[channels.length - 1];
  return Boolean(alpha && alpha.max > 0);
}

/**
 * The stamp for a job's photos:
 * <clock-in or today>-<assignment id>-<customer code>-#<site number>
 */
export function watermarkText(input: {
  date: string;
  assignmentId: string | null;
  customerCode: string;
  siteNumber: string;
}): string {
  return [
    input.date,
    input.assignmentId || "NO-AID",
    input.customerCode,
    `#${input.siteNumber}`,
  ].join("-");
}

export type PipelineProbe = {
  /** False when no photo can be uploaded at all. */
  ok: boolean;
  /** The one thing to fix, or "working". */
  detail: string;
  /** Everything else worth knowing, fatal or not. */
  notes: string[];
};

/**
 * Runs a picture through the real pipeline and reports what happened.
 *
 * "I cannot upload any photo" has several causes that look identical from the
 * field — sharp's native binary built for the wrong architecture, a missing
 * font, a libvips without an HEVC decoder — and the only place they are
 * distinguishable is here, on the server, with something to compare against.
 * A synthetic image rather than a fixture on disk, so this cannot itself fail
 * for want of a file.
 */
export async function probeImagePipeline(): Promise<PipelineProbe> {
  const notes: string[] = [];

  let sample: Buffer;
  try {
    sample = await sharp({
      create: { width: 64, height: 48, channels: 3, background: "#3a6ea5" },
    })
      .jpeg()
      .toBuffer();
  } catch (error) {
    return {
      ok: false,
      detail: `The image library did not load: ${message(error)}`,
      notes: [
        "Nothing can be uploaded until this is fixed. It is almost always sharp's native binary built for a different architecture than the one the container runs on — rebuild the image on the machine that will run it, or with the right --platform.",
      ],
    };
  }

  try {
    const processed = await processImage(sample, "image/jpeg", "PROBE-0000");
    if (processed.width === null) notes.push("Dimensions were not read back.");
    if (!processed.watermarked) {
      notes.push(
        "Photos will store, but with no stamp at all — text rendering threw. Check the server log for “the stamp could not be drawn”.",
      );
    } else if (!(await stampHasInk())) {
      notes.push(
        `Photos will store, but their stamp will be an empty box: no font could be loaded, so the label renders blank. The font ships at ${STAMP_FONT_FILE} — check it was copied into the image.`,
      );
    }
  } catch (error) {
    return {
      ok: false,
      detail: `A photo could not be processed: ${message(error)}`,
      notes,
    };
  }

  // iPhones are the entire input path for this app, and their photos can
  // arrive as HEIC. When libvips has no HEVC decoder the code falls back to a
  // pure-JS one that is loaded on demand — so a build that dropped it looks
  // perfectly healthy right up until the first photo from a phone.
  let libvipsDecodesHeic = true;
  try {
    await sharp({
      create: { width: 8, height: 8, channels: 3, background: "#000" },
    })
      .heif({ compression: "av1" })
      .toBuffer();
  } catch {
    libvipsDecodesHeic = false;
  }

  try {
    await import("heic-convert");
    if (!libvipsDecodesHeic) {
      notes.push(
        "This libvips has no HEVC decoder, so photos from an iPhone take the slower pure-JS path. Uploads still work.",
      );
    }
  } catch (error) {
    const how = libvipsDecodesHeic
      ? "libvips can decode them, so most will still work, but anything it chokes on will fail"
      : "and libvips cannot decode them either, so every photo from an iPhone will fail";
    notes.push(`The HEIC fallback decoder did not load (${message(error)}) — ${how}.`);
  }

  return {
    ok: true,
    detail: notes.length > 0 ? "Working, with notes" : "Working",
    notes,
  };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message.split("\n")[0] : String(error);
}

/** Signatures are drawn on a transparent canvas; PNG keeps them crisp. */
export async function processSignature(input: Buffer): Promise<ProcessedImage> {
  const output = await sharp(input)
    .resize({ width: 1200, fit: "inside", withoutEnlargement: true })
    .png({ compressionLevel: 9 })
    .toBuffer({ resolveWithObject: true });

  return {
    data: output.data,
    mimeType: "image/png",
    width: output.info.width,
    height: output.info.height,
    capturedAt: null,
    gpsLat: null,
    gpsLng: null,
    watermarked: false,
  };
}
