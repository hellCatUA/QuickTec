import { readFile } from "node:fs/promises";
import sharp from "sharp";
import type { BrandAsset } from "@/lib/brand";
import { getCompanySettings } from "@/lib/company";
import { db } from "@/lib/db";
import { looksLikeImage } from "@/lib/images";
import { absolutePath, fileVersion } from "@/lib/storage";

/**
 * The company logo, the header wordmark and the app icon, as files the app
 * keeps itself.
 *
 * They used to be addresses typed into Settings, and they showed only as
 * reliably as wherever they pointed. A share link that expired, or moved with
 * the NextCloud it lived on; a host that answers a browser but refuses an
 * `<img>` on somebody else's page; a phone that could reach the app over the
 * VPN and not the host — any of those is a blank square in the header, and
 * none of them says so. The app icon had one more way to fail: /app-icon
 * fetched the configured address from inside the container, a relative one
 * through the app's own public name, and that name — a Tailscale address
 * behind the proxy — is not something the container can count on reaching.
 * When it could not, the home-screen icon quietly fell back to the
 * placeholder, whatever was configured.
 *
 * Now each is uploaded, redrawn here as a PNG, written to the uploads volume
 * under brand/<asset>/, and served by /api/brand/<asset> from the disk.
 * Nothing in the chain leaves the server.
 */

/** Which CompanySettings column holds each asset's storage path. */
const COLUMN = {
  logo: "logoPath",
  wordmark: "headerLogoPath",
  icon: "appIconPath",
} as const satisfies Record<BrandAsset, string>;

type BrandColumn = (typeof COLUMN)[BrandAsset];

/**
 * The largest each one is kept at.
 *
 * Comfortably more than any screen draws them: the logo is 128 CSS px at most
 * (64 on sign-in, at 200%), so 384 device pixels on a 3x phone; the wordmark
 * is 56 tall at most; the icon is rendered up to 512 for the manifest. The
 * wordmark's box is wide because a lockup is — four or five times its height
 * is usual. Kept below the original rather than at it, because a 6000px export
 * from a design tool would otherwise be what every page of the app downloads.
 */
const BOX: Record<BrandAsset, { width: number; height: number }> = {
  logo: { width: 1024, height: 1024 },
  wordmark: { width: 2048, height: 512 },
  icon: { width: 1024, height: 1024 },
};

/**
 * Below this many pixels on the side that is drawn, the artwork will look
 * soft somewhere — said when it is uploaded rather than refused, because a
 * soft logo is still the right logo. Three times the largest size each is
 * drawn at by default (64px on sign-in, 28px tall in the header), and for the
 * icon the 512 the manifest promises.
 */
const SHARP_FROM: Record<BrandAsset, number> = {
  logo: 192,
  wordmark: 84,
  icon: 512,
};

/**
 * A ceiling on the pixels sharp will decode, well under its own default of
 * 268 million: a 6000px square export from a design tool fits, at about
 * 160 MB decoded. A logo is never larger, and a file claiming to be is either
 * a mistake or a decompression bomb — ten megabytes of PNG can claim far more
 * than the server has — both better refused than held in memory.
 */
const MAX_INPUT_PIXELS = 40_000_000;

/** sharp's own bounds for `density`. */
const MIN_DENSITY = 1;
const MAX_DENSITY = 100_000;

/**
 * Whether these bytes are an SVG document.
 *
 * Read off the start of the text, because an SVG has no magic number and the
 * type a browser sends for one is whatever the operating system guessed.
 */
export function looksLikeSvg(data: Buffer): boolean {
  const head = data
    .subarray(0, 4096)
    .toString("utf8")
    .replace(/^\uFEFF/, "")
    .trimStart();
  return /^<(\?xml|!--|!doctype\s+svg|svg[\s>])/i.test(head) && /<svg[\s>]/i.test(head);
}

export type PreparedBrandAsset =
  | { ok: true; data: Buffer; width: number; height: number; notice: string | null }
  | { ok: false; error: string };

/**
 * Turns an upload into the PNG that is kept, or says why it cannot be one.
 *
 * Everything becomes a PNG. It keeps transparency, which a logo nearly always
 * has and a JPEG would fill with black or white; it opens everywhere, the
 * manifest and an iPhone home screen included; and it means what is served is
 * always something this code wrote, never the file as it arrived.
 *
 * That last part is what makes an SVG safe to accept. An SVG is a document
 * that can carry script, and served from this origin and opened on its own it
 * would run as the app. Rasterised here, the script is never anything but
 * ignored markup, and only the pixels are kept. It is drawn at the size it is
 * kept at rather than at the 72 dpi its own width implies — a vector logo
 * declared 120 wide would otherwise be drawn at 120 and enlarged into a blur.
 * librsvg loads nothing the document points at: given bytes rather than a
 * file, it has no base to resolve a reference against.
 */
export async function prepareBrandAsset(
  asset: BrandAsset,
  upload: Buffer,
): Promise<PreparedBrandAsset> {
  const svg = looksLikeSvg(upload);
  if (!svg && !looksLikeImage(upload)) {
    return {
      ok: false,
      error: "That file is not a picture. Use a PNG, JPEG, WebP or SVG.",
    };
  }

  const box = BOX[asset];

  try {
    let density: number | undefined;
    if (svg) {
      // Unlimited for this one read: it parses the document for the size it
      // declares and draws nothing, and a logo declared 100000 wide is a
      // perfectly good vector that the pixel ceiling, measured at 72 dpi,
      // would refuse. The drawing below is at the box's size and keeps the
      // ceiling.
      const declared = await sharp(upload, { limitInputPixels: false }).metadata();
      if (!declared.width || !declared.height) throw new Error("svg has no size");
      const fit = Math.min(box.width / declared.width, box.height / declared.height);
      density = Math.min(MAX_DENSITY, Math.max(MIN_DENSITY, 72 * fit));
    }

    const { data, info } = await sharp(upload, {
      density,
      limitInputPixels: MAX_INPUT_PIXELS,
    })
      // A photo of a sign taken on a phone carries its orientation in EXIF,
      // which the PNG would not.
      .rotate()
      .resize({
        width: box.width,
        height: box.height,
        fit: "inside",
        withoutEnlargement: true,
      })
      .png({ compressionLevel: 9 })
      .toBuffer({ resolveWithObject: true });

    return {
      ok: true,
      data,
      width: info.width,
      height: info.height,
      notice:
        (svg && setsText(upload) ? TEXT_IN_SVG : null) ??
        softness(asset, info.width, info.height),
    };
  } catch (error) {
    if (error instanceof Error && /pixel limit/i.test(error.message)) {
      return {
        ok: false,
        error: "That picture is too large — over 40 million pixels. Export it at 2048px or less.",
      };
    }
    console.error(`[brand] could not read an uploaded ${asset}:`, error);
    return {
      ok: false,
      error: "That picture could not be read. Try saving it as a PNG.",
    };
  }
}

/**
 * Whether an SVG spells words out as text rather than drawing them as shapes.
 *
 * Text is drawn in a font, and the server draws it with the fonts it has —
 * which in the production image is none at all (see the Dockerfile on the
 * photo stamp). A wordmark set that way comes out as its background and no
 * words. Said on upload, beside the preview that shows it, because the fix is
 * the designer's: export it with the text as outlines, or as a PNG.
 */
function setsText(svg: Buffer): boolean {
  return /<(text|tspan|textPath)[\s>]/i.test(svg.toString("utf8"));
}

const TEXT_IN_SVG =
  "Uploaded, but this SVG sets its words in a font, which the server may not have — check the preview. If the words are missing, export it with the text as outlines, or as a PNG.";

/** A word about artwork that will look soft or be padded, or nothing. */
function softness(asset: BrandAsset, width: number, height: number): string | null {
  // The side that sets the drawn size: the height of a wordmark, whose width
  // follows; the longer side of a logo or icon, which is fitted into a square
  // by it.
  const drawn = asset === "wordmark" ? height : Math.max(width, height);
  const want = SHARP_FROM[asset];
  const size = `${width}×${height}px`;

  if (drawn < want) {
    return asset === "wordmark"
      ? `Uploaded, but it is only ${size}, so it may look soft on a sharp screen — ${want}px tall or more is best.`
      : `Uploaded, but it is only ${size}, so it may look soft on a sharp screen — ${want}×${want}px or larger is best.`;
  }
  if (asset === "icon" && Math.abs(width - height) > Math.max(width, height) * 0.05) {
    return `Uploaded. It is ${size}, not square, so it is centred on a clear square — a square file fills the icon.`;
  }
  return null;
}

/** Where the browser asks for an asset. Changes whenever the file does. */
export function brandAssetSrc(
  asset: BrandAsset,
  storagePath: string | null | undefined,
): string | null {
  return storagePath ? `/api/brand/${asset}?v=${fileVersion(storagePath)}` : null;
}

/** The asset's storage path, or null when none has been uploaded. */
export async function brandAssetPath(asset: BrandAsset): Promise<string | null> {
  const row = await db.companySettings.findUnique({
    where: { id: "singleton" },
    select: { logoPath: true, headerLogoPath: true, appIconPath: true },
  });
  return row?.[COLUMN[asset]] ?? null;
}

/** The stored file's bytes, or null when there is none or it is gone. */
export async function readBrandAsset(storagePath: string): Promise<Buffer | null> {
  try {
    return await readFile(absolutePath(storagePath));
  } catch {
    return null;
  }
}

/** The column for an asset, as a fragment Prisma takes in `where` and `data`. */
function onColumn(column: BrandColumn, value: string | null) {
  return { [column]: value } as Partial<Record<BrandColumn, string | null>>;
}

/**
 * Points an asset at a new file, or at none, and returns the one it pointed
 * at before — which is the caller's to delete.
 *
 * Compare-and-swap rather than read-then-write. Two uploads of the same asset
 * that both read the old path before either wrote would each go on to delete
 * that old file, and the one that lost the race would leave its own new file
 * on the volume with nothing pointing at it. Here the write only lands if the
 * column still holds what was read, so each upload is handed back exactly the
 * path it replaced.
 */
export async function swapBrandAsset(
  asset: BrandAsset,
  next: string | null,
): Promise<string | null> {
  const column = COLUMN[asset];
  // A fresh install may not have the row yet; the upsert is a no-op otherwise.
  await getCompanySettings();

  for (let attempt = 0; attempt < 5; attempt++) {
    const previous = await brandAssetPath(asset);
    const moved = await db.companySettings.updateMany({
      where: { id: "singleton", ...onColumn(column, previous) },
      data: onColumn(column, next),
    });
    if (moved.count === 1) return previous;
  }
  throw new Error(`[brand] the ${asset} kept changing underneath the save`);
}

/** The column an asset is recorded under, for the audit entry. */
export function brandAssetColumn(asset: BrandAsset): BrandColumn {
  return COLUMN[asset];
}
