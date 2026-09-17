import type { MetadataRoute } from "next";
import { usableIconUrl } from "@/lib/brand";
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

/** Shipped in public/icons, for a deployment that has configured nothing. */
const BUNDLED: MetadataRoute.Manifest["icons"] = [
  { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
  { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
  { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
  {
    src: "/icons/icon-maskable-512.png",
    sizes: "512x512",
    type: "image/png",
    purpose: "maskable",
  },
];

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
    // Bundled defaults below.
  }

  const configured = usableIconUrl(company.appIconUrl);

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
    // A configured icon replaces the bundled set rather than heading it.
    //
    // Listing it first and keeping the rest as a safety net is the obvious
    // thing to write, and it does not work: a manifest icon list is a set of
    // candidates, not a priority order, and the browser picks whichever one
    // best fits the size it is after. Handed this list with the bundled
    // entries still in it, Chromium fetches /icons/icon.svg every time — an
    // SVG is scalable, so it is the ideal match at any requested size, and it
    // beats a configured raster of unknown dimensions no matter where in the
    // array it sits. That is why "install this site as an app" kept offering
    // the placeholder clock while the browser tab, which goes through /icon
    // and never reads this file, showed the icon somebody had actually set.
    //
    // The maskable entry goes too, for the same reason it was kept before.
    // Android crops a maskable icon to its own silhouette, so a configured
    // file of unknown shape is a bad crop waiting to happen — but the
    // alternative on offer is the wrong logo entirely, and a plain icon that
    // Android puts on its own backdrop beats somebody else's artwork.
    icons: configured
      ? [{ src: configured, sizes: "any", purpose: "any" }]
      : BUNDLED,
  };
}
