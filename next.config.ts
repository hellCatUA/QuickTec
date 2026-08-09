import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emits .next/standalone so the production image can run without node_modules.
  output: "standalone",

  // The app lives behind Nginx Proxy Manager on a Tailscale-only subdomain.
  // Next needs to know which proxy headers to trust for absolute URL generation.
  poweredByHeader: false,

  // These three read files from their own package directories at runtime —
  // bundling them breaks pdfkit's built-in fonts and sharp's native binding.
  serverExternalPackages: ["@prisma/client", "pdfkit", "sharp", "archiver"],

  // heic-convert is loaded on demand — only when libvips cannot decode a
  // phone's HEIC itself — and a dynamic import inside a try/catch is exactly
  // what tracing cannot see. It was left out of the standalone build, so the
  // fallback threw in production and every HEIC upload came back as "that file
  // could not be read as a photo". The font is named through process.cwd() for
  // the same reason: nothing static points at it.
  outputFileTracingIncludes: {
    "/**": [
      "./node_modules/heic-convert/**",
      "./node_modules/libheif-js/**",
      "./assets/fonts/**",
    ],
  },

  experimental: {
    // Server Actions carry photo uploads; the default 1 MB cap is far too small.
    serverActions: {
      bodySizeLimit: "25mb",
    },
  },

  async headers() {
    return [
      {
        // The service worker must never be cached, or clients get stuck on an
        // old version and stop picking up new offline logic.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
