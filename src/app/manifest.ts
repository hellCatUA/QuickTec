import { createHash } from "node:crypto";
import type { MetadataRoute } from "next";
import { getCompanySettings } from "@/lib/company";

/**
 * The home-screen manifest, built rather than shipped flat.
 *
 * It used to be a static file in public/, which meant the icon a deployment
 * actually wanted could never reach the home screen — the one in there is a
 * placeholder clock nobody chose. Reading the company row here is what lets
 * App icon in Settings do anything.
 */
export const dynamic = "force-dynamic";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  // Never throws. force-dynamic keeps this out of the build, but the manifest
  // is also fetched on a cold start behind a database that may not be up yet,
  // and a home-screen icon is not worth failing the request over.
  let company: { name: string; appIconUrl: string | null } = {
    name: "QuickTec",
    appIconUrl: null,
  };
  try {
    company = await getCompanySettings();
  } catch {
    // Defaults above, and /app-icon falls back to the bundled artwork.
  }

  // Changing the setting changes these addresses, so an installed app picks up
  // a new icon instead of waiting out a cache. The value is hashed rather than
  // used directly: it can be any length and ends up in a URL.
  const stamp = createHash("sha1")
    .update(company.appIconUrl ?? "bundled")
    .digest("hex")
    .slice(0, 8);

  return {
    name: company.name,
    short_name: company.name,
    description: "Field service time tracking and reporting.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#1a1d24",
    theme_color: "#1a1d24",
    // One artwork behind three fixed, honest declarations.
    //
    // Both obvious arrangements of this list are wrong. Listing the configured
    // icon alongside the bundled set does not work, because an icon list is a
    // set of candidates and not a priority order: measured against Chromium,
    // the bundled /icons/icon.svg wins every selection — an SVG is scalable, so
    // it is the ideal match at any requested size — and the install dialog went
    // on offering the placeholder clock. Listing the configured icon alone does
    // not work either: its real size is whatever somebody uploaded, and a file
    // that is too small, not square or no longer there costs the site its
    // install offer outright (`no-acceptable-icon`, measured the same way).
    //
    // So nothing points at the uploaded file. /app-icon renders it to the size
    // each entry promises, and falls back to the bundled artwork when it cannot,
    // which makes every line here true by construction.
    icons: [
      {
        src: `/app-icon/192.png?v=${stamp}`,
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: `/app-icon/512.png?v=${stamp}`,
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: `/app-icon/maskable.png?v=${stamp}`,
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
