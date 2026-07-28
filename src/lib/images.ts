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
 * Bottom-right stamp: 2026-07-28-887766-SBUX-#24541
 *
 * Drawn as an SVG the same size as the image and composited, so the text sits
 * at a fixed offset from the corner regardless of aspect ratio. Sized relative
 * to the image so it stays legible on a 4032px photo and does not swamp a
 * small one.
 */
function watermarkSvg(text: string, width: number, height: number): Buffer {
  const fontSize = Math.max(16, Math.round(width / 48));
  const padding = Math.round(fontSize * 0.6);
  const margin = Math.round(fontSize * 0.9);
  const boxHeight = fontSize + padding * 2;
  // Roughly the advance width of the monospace digits and dashes used here.
  const boxWidth = Math.round(text.length * fontSize * 0.62) + padding * 2;

  const x = Math.max(margin, width - boxWidth - margin);
  const y = Math.max(margin, height - boxHeight - margin);

  return Buffer.from(`
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect x="${x}" y="${y}" width="${boxWidth}" height="${boxHeight}"
            rx="${Math.round(fontSize * 0.3)}" fill="rgba(0,0,0,0.55)" />
      <text x="${x + padding}" y="${y + padding + fontSize * 0.8}"
            font-family="monospace" font-size="${fontSize}"
            fill="#ffffff">${escapeXml(text)}</text>
    </svg>
  `);
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
  const rotated = await pipeline.clone().jpeg().toBuffer({ resolveWithObject: true });
  const { width, height } = rotated.info;

  if (watermark) {
    pipeline = sharp(rotated.data).composite([
      { input: watermarkSvg(watermark, width, height), top: 0, left: 0 },
    ]);
  }

  const data = await pipeline.jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer();

  return {
    data,
    mimeType: "image/jpeg",
    width,
    height,
    capturedAt: facts.capturedAt,
    gpsLat: facts.gpsLat,
    gpsLng: facts.gpsLng,
    watermarked: Boolean(watermark),
  };
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
