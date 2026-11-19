import { brandAssetPath } from "@/lib/brand-assets";
import { fileVersion } from "@/lib/storage";

/**
 * The tab and home-screen icon, behind one fixed address.
 *
 * The configured icon used to be read in the root layout's generateMetadata,
 * which put a database query in front of every prerendered page — and a
 * production build has no database, so `next build` died on /_not-found. A
 * fixed URL in the metadata and the lookup behind it keeps the build offline,
 * keeps the query off every page render, and lets the icon change without
 * anything being rebuilt.
 *
 * A failure here falls through to the bundled icon rather than propagating:
 * the favicon is not worth a 500, and this is the one request that would
 * otherwise turn a database blip into a broken-looking tab.
 */
export const dynamic = "force-dynamic";

const BUNDLED = "/icons/icon.svg";

export async function GET() {
  let uploaded: string | null = null;
  try {
    uploaded = await brandAssetPath("icon");
  } catch {
    uploaded = null;
  }

  // The uploaded icon as /app-icon renders it — square, a PNG, and 192 across
  // whatever was uploaded — rather than the upload itself, which can be 1024
  // wide and not square: a lot of bytes for a 16px tab, and squeezed out of
  // shape by a browser that draws favicons into a square. Stamped like the
  // manifest's, so a new upload is a new address.
  const target = uploaded
    ? `/app-icon/192.png?v=${fileVersion(uploaded)}`
    : BUNDLED;

  // A relative Location, which a browser resolves against the address it
  // asked. It was resolved here, against request.url — and under the
  // standalone server that is the address the server listens on, never the
  // one anybody typed (src/auth.ts has the same story for sign-in). Behind the
  // proxy every tab and every iPhone's Add to Home Screen was sent to
  // https://localhost:3000 and drew nothing. A linked icon on another host
  // hid it, being absolute already; an upload is always on this one.
  return new Response(null, {
    status: 307,
    headers: {
      Location: target,
      // Short, because the point of the setting is that it can be changed.
      // Long enough that a tab full of pages does not ask thirty times.
      "Cache-Control": "public, max-age=300",
    },
  });
}
