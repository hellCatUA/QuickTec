import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { brandAssetPath, readBrandAsset } from "@/lib/brand-assets";

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
 * the size it claims. Whatever is uploaded is fitted inside it without being
 * cropped, and anything that fails along the way — a file gone from the
 * volume, a format sharp cannot read, no database — falls through to the
 * bundled artwork rather than failing the request. An icon is never worth a
 * 500.
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

const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ file: string }> },
) {
  const { file } = await params;
  const spec = SPECS[file as keyof typeof SPECS];
  if (!spec) return new Response("Not found", { status: 404 });

  let body: Buffer;
  try {
    const uploaded = await uploadedIcon();
    body = uploaded ? await render(uploaded, spec) : await bundled(spec);
  } catch {
    body = await bundled(spec);
  }

  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": "image/png",
      // The manifest stamps these URLs with the uploaded file's name, so a new
      // upload changes the address and no cache has to expire first. This
      // only covers an installed app asking with an old stamp.
      "Cache-Control": "public, max-age=300",
    },
  });
}

/**
 * The uploaded icon's bytes, read off the uploads volume.
 *
 * It used to be fetched over HTTP, from wherever the setting pointed — for an
 * address on this app, back through the app's own public name. Inside the
 * container that name is a Tailscale address behind the proxy, which is not
 * something to count on reaching, and every miss quietly served the
 * placeholder clock in its place. Read from the disk there is nothing to miss.
 */
async function uploadedIcon(): Promise<Buffer | null> {
  try {
    const storagePath = await brandAssetPath("icon");
    return storagePath ? await readBrandAsset(storagePath) : null;
  } catch {
    return null;
  }
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
