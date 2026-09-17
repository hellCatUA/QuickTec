import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { usableIconUrl } from "@/lib/brand";
import { db } from "@/lib/db";

/**
 * The home-screen icon, rendered to the shape a manifest has to promise.
 *
 * The configured icon cannot be handed to the manifest as-is. A manifest
 * declares each icon's size, and a browser holds it to that: Chromium requires
 * a square of at least 144px to consider a site installable at all, and
 * measuring it shows that a configured file which is too small, not square, or
 * simply not there takes the install offer away entirely — `no-acceptable-icon`,
 * no button, nothing to click. A setting nobody can see is one thing; a setting
 * that quietly un-installs the app is another.
 *
 * So the file somebody uploaded is treated as artwork, not as an icon, and what
 * the manifest points at is this: always a PNG, always square, always exactly
 * the size it claims. Whatever is configured is fitted inside it without being
 * cropped, and anything that fails along the way — unreachable URL, a format
 * sharp cannot read, no database — falls through to the bundled artwork rather
 * than failing the request. An icon is never worth a 500.
 */
export const dynamic = "force-dynamic";

const SPECS = {
  "192.png": { size: 192, inset: 0, bundled: "icon-192.png" },
  "512.png": { size: 512, inset: 0, bundled: "icon-512.png" },
  /**
   * Android crops a maskable icon to whatever silhouette the launcher uses, so
   * this one is drawn at 80% and padded. The bundled maskable file is already
   * cut that way, which is why it stays the fallback here rather than the plain
   * 512.
   */
  "maskable.png": { size: 512, inset: 0.1, bundled: "icon-maskable-512.png" },
} as const;

type Spec = (typeof SPECS)[keyof typeof SPECS];

/** Generous for a logo, small enough that a wrong URL cannot exhaust memory. */
const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 5_000;

const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

export async function GET(
  request: Request,
  { params }: { params: Promise<{ file: string }> },
) {
  const { file } = await params;
  const spec = SPECS[file as keyof typeof SPECS];
  if (!spec) return new Response("Not found", { status: 404 });

  let body: Buffer;
  try {
    const configured = usableIconUrl(await configuredIcon());
    body = configured
      ? await render(await download(configured, request.url), spec)
      : await bundled(spec);
  } catch {
    body = await bundled(spec);
  }

  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": "image/png",
      // The manifest stamps these URLs with the configured value, so changing
      // the setting changes the address and no cache has to expire first. This
      // only covers replacing the file behind an unchanged URL.
      "Cache-Control": "public, max-age=300",
    },
  });
}

async function configuredIcon(): Promise<string | null> {
  try {
    const company = await db.companySettings.findUnique({
      where: { id: "singleton" },
      select: { appIconUrl: true },
    });
    return company?.appIconUrl ?? null;
  } catch {
    return null;
  }
}

/**
 * Over HTTP even for our own paths, rather than off the disk.
 *
 * A configured icon can be a file in public/, something behind an upload route,
 * or a URL somewhere else entirely, and one fetch handles all three without
 * this route having to know where anything is stored.
 */
async function download(url: string, base: string): Promise<Buffer> {
  const response = await fetch(new URL(url, base), {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`icon fetch failed: ${response.status}`);

  const body = Buffer.from(await response.arrayBuffer());
  if (body.byteLength > MAX_BYTES) throw new Error("icon is too large");
  return body;
}

/** Fitted, never cropped: a logo with a corner cut off is worse than a resize. */
async function render(source: Buffer, spec: Spec): Promise<Buffer> {
  const pad = Math.round(spec.size * spec.inset);
  const inner = spec.size - pad * 2;

  const fitted = await sharp(source)
    .resize(inner, inner, { fit: "contain", background: TRANSPARENT })
    .toBuffer();

  if (!pad) return sharp(fitted).png().toBuffer();

  return sharp(fitted)
    .extend({
      top: pad,
      bottom: pad,
      left: pad,
      right: pad,
      background: TRANSPARENT,
    })
    .png()
    .toBuffer();
}

function bundled(spec: Spec): Promise<Buffer> {
  return readFile(path.join(process.cwd(), "public", "icons", spec.bundled));
}
