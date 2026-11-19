import { NextResponse } from "next/server";
import { isBrandAsset } from "@/lib/brand";
import { brandAssetPath, readBrandAsset } from "@/lib/brand-assets";
import { fileVersion } from "@/lib/storage";

/**
 * Serves the company's logo, header wordmark or app icon off the uploads
 * volume.
 *
 * Open to anyone, unlike every other file the app serves: the sign-in and
 * set-password pages show the logo to somebody who has not signed in yet, and
 * none of the three is anything but what the company puts on its own front
 * door. Only the current file of each is reachable, by asset name — never a
 * path — so this cannot be walked to anything else on the volume.
 *
 * What is served is always a PNG this app drew (src/lib/brand-assets.ts), never
 * the file as uploaded.
 */
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ asset: string }> },
) {
  const { asset } = await params;
  if (!isBrandAsset(asset)) return notFound();

  let storagePath: string | null;
  try {
    storagePath = await brandAssetPath(asset);
  } catch (error) {
    console.error(`[brand] could not look up the ${asset}:`, error);
    return new NextResponse("Unavailable", {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
  if (!storagePath) return notFound();

  // Pages ask with ?v= set to the file's version, which changes with every
  // upload because every upload is a new name. Asked for the current one, the
  // answer can be kept for good; asked for an old one — a page rendered before
  // the logo was replaced — the current file is still the right answer, but
  // only until the next check.
  const version = fileVersion(storagePath);
  const etag = `"${version}"`;
  const current = new URL(request.url).searchParams.get("v") === version;
  const headers = {
    "Cache-Control": current
      ? "public, max-age=31536000, immutable"
      : "public, no-cache",
    ETag: etag,
    "X-Content-Type-Options": "nosniff",
  };

  if (request.headers.get("if-none-match") === etag) {
    return new NextResponse(null, { status: 304, headers });
  }

  const data = await readBrandAsset(storagePath);
  // The row points at a file the volume no longer has: a restore that brought
  // the database back without the uploads. A broken image says so; a 500
  // would only say something went wrong.
  if (!data) return notFound();

  return new NextResponse(new Uint8Array(data), {
    headers: {
      ...headers,
      "Content-Type": "image/png",
      "Content-Length": String(data.byteLength),
    },
  });
}

function notFound() {
  return new NextResponse("Not found", {
    status: 404,
    // Short-lived: the next upload has to show at once, and an empty slot
    // asked again a second later should not be answered from a cache.
    headers: { "Cache-Control": "no-store" },
  });
}
