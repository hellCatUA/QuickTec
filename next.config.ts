import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emits .next/standalone so the production image can run without node_modules.
  output: "standalone",

  // The app lives behind Nginx Proxy Manager on a Tailscale-only subdomain.
  // Next needs to know which proxy headers to trust for absolute URL generation.
  poweredByHeader: false,

  serverExternalPackages: ["@prisma/client"],

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
