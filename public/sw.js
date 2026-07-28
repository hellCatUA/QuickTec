/* QuickTec service worker.
 *
 * Scope for now is deliberately narrow: keep the app shell and static assets
 * available when the signal drops, and never serve a stale page for anything
 * that carries live data. The write-side offline queue lands with the job form
 * in a later phase; this file only has to guarantee the app opens.
 */

const VERSION = "quicktec-v1";
const SHELL_CACHE = `${VERSION}-shell`;
const ASSET_CACHE = `${VERSION}-assets`;

const SHELL_URLS = ["/offline", "/manifest.webmanifest", "/icons/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => !key.startsWith(VERSION))
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Auth and API responses are user- and time-specific. A cached one is worse
  // than no response at all, so they always go to the network.
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/_next/data/")
  ) {
    return;
  }

  // Immutable build output: cache-first is safe because the hash changes.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            const copy = response.clone();
            caches.open(ASSET_CACHE).then((cache) => cache.put(request, copy));
            return response;
          }),
      ),
    );
    return;
  }

  // Pages: network-first so the tech always sees current job state, falling
  // back to the offline notice rather than a browser error page.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() =>
        caches
          .match("/offline")
          .then(
            (cached) =>
              cached ||
              new Response("Offline", {
                status: 503,
                headers: { "Content-Type": "text/plain" },
              }),
          ),
      ),
    );
  }
});
