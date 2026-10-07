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
/**
 * Encoded with libjpeg-turbo rather than mozjpeg.
 *
 * mozjpeg was worth 10-19% on file size and cost three and a half times the
 * encode — a second per photo, with a tech standing on a site waiting for it.
 * Storage is cheaper than their afternoon. Add `mozjpeg: true` back at the one
 * call site if that ever stops being true.
 */
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
  /**
   * The same photo without its label — the job's stamp on it, if it has one —
   * when a label was drawn. Kept so the label can be changed or taken off
   * without drawing over the old one.
   */
  base?: Buffer;
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

/**
 * The raw EXIF block, or nothing.
 *
 * Tolerant of a truncated file on purpose: the head of a photo is enough for
 * this, and it is deliberately all that gets sent when the phone shrank the
 * picture itself.
 */
async function exifOf(data: Buffer): Promise<Buffer | undefined> {
  try {
    return (await sharp(data, { failOn: "none" }).metadata()).exif;
  } catch {
    return undefined;
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

/** The size a stamp line starts at, before a long one is shrunk to fit. */
function stampSize(width: number): number {
  return Math.max(16, Math.round(width / 48));
}

/**
 * One plate of the stamp: a dark box, and a line of text on it, against the
 * right edge with its lower edge at `bottom`.
 *
 * Split into two layers because they are rendered by different things.
 * Shapes are geometry and an SVG draws them anywhere; text needs a font, and
 * the only way to be sure which one is to hand the file over rather than name
 * a family and hope.
 */
async function plate(
  text: string,
  width: number,
  height: number,
  bottom: number,
  /** Drawn only where it fits whole: a label is not set over the stamp. */
  mustFit = false,
): Promise<{ layers: StampLayer[]; top: number }> {
  let fontSize = stampSize(width);
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
  // Still too big at the smallest size — a thumbnail of a photo, a narrow
  // crop. Nothing is drawn rather than a line overhanging the picture, which
  // sharp refuses, and the upload with it.
  if (
    label.info.width + padding * 2 > width ||
    label.info.height + padding * 2 > height ||
    (mustFit && bottom - (label.info.height + padding * 2) < 0)
  ) {
    return { layers: [], top: bottom };
  }
  const boxWidth = label.info.width + padding * 2;
  const boxHeight = label.info.height + padding * 2;
  const x = Math.max(0, width - boxWidth - margin);
  const y = Math.max(0, bottom - boxHeight);

  const box = Buffer.from(
    `<svg width="${boxWidth}" height="${boxHeight}" xmlns="http://www.w3.org/2000/svg">` +
      `<rect x="0" y="0" width="${boxWidth}" height="${boxHeight}" ` +
      `rx="${Math.round(fontSize * 0.3)}" fill="rgba(0,0,0,0.55)" /></svg>`,
  );

  return {
    layers: [
      { input: box, left: x, top: y },
      { input: label.data, left: x + padding, top: y + padding },
    ],
    top: y,
  };
}

/** The two layers of the stamp: a dark plate, and the label on top of it. */
export async function stampLayers(
  text: string,
  width: number,
  height: number,
): Promise<StampLayer[]> {
  const margin = Math.round(stampSize(width) * 0.9);
  return (await plate(text, width, height, height - margin)).layers;
}

/**
 * The stamp with a photo's own label over it: "Damaged port" on a plate of
 * its own, directly above the job's line, as a top line to it.
 *
 * `drawn` says the job's line is on the picture already — a photo stamped
 * when it was uploaded and labelled afterwards. It is measured, to know where
 * the label goes, and not drawn a second time. With no job line at all — the
 * stamp is off for the company — the label sits where the stamp would.
 */
export async function labelledStampLayers(
  main: string | null,
  label: string | null,
  width: number,
  height: number,
  drawn = false,
): Promise<StampLayer[]> {
  const size = stampSize(width);
  const layers: StampLayer[] = [];
  let bottom = height - Math.round(size * 0.9);
  if (main) {
    const stamp = await plate(main, width, height, bottom);
    if (!drawn) layers.push(...stamp.layers);
    bottom = stamp.top - Math.round(size * 0.35);
  }
  // Above the stamp only where there is room for it: on a strip of a photo
  // it would sit on the stamp instead, and the stamp is the one that matters.
  if (label) layers.push(...(await plate(label, width, height, bottom, Boolean(main))).layers);
  return layers;
}

export async function processImage(
  input: Buffer,
  mimeType: string,
  watermark?: string | null,
  /**
   * Where to read the EXIF from, when it is not in `input`.
   *
   * A phone shrinks its photo before sending it, which drops the timestamp and
   * the GPS fix along with the pixels nobody wanted — so it sends the head of
   * the original alongside, and the facts are read from that instead. Same
   * reader either way.
   */
  exifSource?: Buffer | null,
  /** A line of the uploader's own, drawn above the stamp — see labelledStampLayers. */
  label?: string | null,
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

  const facts = readExif(
    (await exifOf(decoded)) ?? (exifSource ? await exifOf(exifSource) : undefined),
  );

  /**
   * Decoded and resized, but not compressed.
   *
   * The stamp has to be placed against real dimensions, and the only way to
   * know them is to run the resize. Asking for JPEG here would mean encoding
   * the photo, decoding it again to draw on it, and encoding a second time —
   * two thirds of the work in this function went on a JPEG nobody ever saw.
   * Pixels cost 13 MB for a moment and nothing in time.
   */
  const pixels = await sharp(decoded, { failOn: "none" })
    // Bakes in the EXIF orientation, so a portrait photo is not sideways in
    // the report once the metadata is stripped.
    .rotate()
    .resize({
      width: MAX_EDGE,
      height: MAX_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = pixels.info;

  const stamp = watermark
    ? await stampOrNothing(watermark, width, height)
    : null;
  // Measured against the stamp that was actually drawn: when it could not
  // be, text cannot be drawn at all, and the label goes without saying so.
  const drawnLabel = label
    ? await layersOrNothing(() =>
        labelledStampLayers(stamp ? watermark! : null, label, width, height, true),
      )
    : null;
  const labelled = drawnLabel && drawnLabel.length > 0 ? drawnLabel : null;

  const image = () => sharp(pixels.data, { raw: { width, height, channels } });
  const layers = [...(stamp ?? []), ...(labelled ?? [])];
  const data = await (layers.length > 0 ? image().composite(layers) : image())
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer();
  const base = labelled
    ? await (stamp ? image().composite(stamp) : image())
        .jpeg({ quality: JPEG_QUALITY })
        .toBuffer()
    : undefined;

  return {
    data,
    mimeType: "image/jpeg",
    width,
    height,
    capturedAt: facts.capturedAt,
    gpsLat: facts.gpsLat,
    gpsLng: facts.gpsLng,
    watermarked: stamp !== null,
    base,
  };
}

/**
 * A stored photo with a label drawn over it.
 *
 * `base` is the photo as it was before any label — with the job's stamp on
 * it already when it has one, whose text `main` is, so the label goes above
 * it. Null when the label cannot be drawn.
 */
export async function labelPhoto(
  base: Buffer,
  main: string | null,
  label: string,
): Promise<Buffer | null> {
  try {
    const { width, height } = await sharp(base).metadata();
    if (!width || !height) return null;
    const layers = await layersOrNothing(() =>
      labelledStampLayers(main, label, width, height, true),
    );
    if (!layers || layers.length === 0) return null;
    return await sharp(base).composite(layers).jpeg({ quality: JPEG_QUALITY }).toBuffer();
  } catch (error) {
    console.error("[images] a label could not be drawn", error);
    return null;
  }
}

/**
 * The stamp layers, or nothing when they cannot be drawn.
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
export async function stampOrNothing(
  text: string,
  width: number,
  height: number,
  render: typeof stampLayers = stampLayers,
): Promise<StampLayer[] | null> {
  const layers = await layersOrNothing(() => render(text, width, height));
  // Nothing that fits is no stamp, and the photo does not claim one.
  return layers && layers.length > 0 ? layers : null;
}

async function layersOrNothing(
  draw: () => Promise<StampLayer[]>,
): Promise<StampLayer[] | null> {
  try {
    return await draw();
  } catch (error) {
    console.error("[images] the stamp could not be drawn", error);
    return null;
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

  // sharp falls back to a WebAssembly build when its native binding cannot be
  // loaded, and says nothing about it — same API, same reported version. That
  // build has no pango, so the stamp cannot be drawn at all. Worth naming
  // rather than leaving somebody to wonder why a working install stopped
  // stamping.
  const wasm = "emscripten" in sharp.versions;

  try {
    const processed = await processImage(sample, "image/jpeg", "PROBE-0000");
    if (processed.width === null) notes.push("Dimensions were not read back.");
    if (!processed.watermarked) {
      notes.push(
        wasm
          ? "Photos store, but never stamped: sharp is running its WebAssembly build, which has no text engine. The native binding could not be loaded — usually its libvips .so is missing from the image."
          : "Photos will store, but with no stamp at all — text rendering threw. Check the server log for “the stamp could not be drawn”.",
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
