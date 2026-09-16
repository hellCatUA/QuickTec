import type { MetadataRoute } from "next";
import { getCompanySettings } from "@/lib/company";

/**
 * The home-screen manifest, built rather than shipped flat.
 *
 * It used to be a static file in public/, which meant the icon a deployment
 * actually wanted could never reach the home screen — the one in there is a
 * placeholder clock nobody chose. Reading the company row here is what lets
 * App icon in Settings do anything.
 *
 * The bundled icons stay as the fallback and as the maskable variant: a
 * configured icon is one file of unknown shape, and Android will crop whatever
 * it is given to its own silhouette. Offering it as the only maskable source
 * would hand it a guaranteed crop; the padded one we ship survives that.
 */
export const dynamic = "force-dynamic";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const company = await getCompanySettings();

  const configured: MetadataRoute.Manifest["icons"] = company.appIconUrl
    ? [{ src: company.appIconUrl, sizes: "any", purpose: "any" }]
    : [];

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
    icons: [
      ...configured,
      {
        src: "/icons/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
