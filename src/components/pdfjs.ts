"use client";

/**
 * pdf.js, loaded on demand in the browser.
 *
 * The legacy build, deliberately. The default one is compiled for the newest
 * engines and reaches for proposals most browsers do not have yet — it dies
 * on `getOrInsertComputed is not a function` in anything but a current Chrome,
 * and node_modules are not down-levelled by the app's own build.
 *
 * The worker is emitted as an asset of this bundle rather than pulled from a
 * CDN: the app runs behind the company VPN on a server with no outbound path
 * to one.
 */
export async function loadPdfjs() {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
  return pdfjs;
}

export type Pdfjs = Awaited<ReturnType<typeof loadPdfjs>>;
