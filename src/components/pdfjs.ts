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
  streamsCanBeWalked();
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
  return pdfjs;
}

export type Pdfjs = Awaited<ReturnType<typeof loadPdfjs>>;

type Walkable = Record<PropertyKey, unknown>;

/**
 * Lets `for await (… of stream)` walk a ReadableStream where the browser
 * cannot.
 *
 * pdf.js reads a page's text that way, and WebKit — every browser on an
 * iPhone, and the app saved to its home screen — has no async iterator on its
 * streams. Even the legacy build does not make up for it, so signing a work
 * order worked on a desktop and on the owner's phone stopped at "undefined is
 * not a function (near '...t of e...')" before it had read a word.
 *
 * Read the way the standard says the iterator reads: chunk by chunk from a
 * reader, letting go of the stream at the end, and cancelling it when the loop
 * is left early unless asked not to. Installed once, and only where missing.
 */
function streamsCanBeWalked() {
  if (typeof ReadableStream === "undefined") return;
  const stream = ReadableStream.prototype as unknown as Walkable;
  if (typeof stream[Symbol.asyncIterator] === "function") return;

  async function* values(
    this: ReadableStream<unknown>,
    options?: { preventCancel?: boolean },
  ): AsyncGenerator<unknown, void, undefined> {
    const reader = this.getReader();
    let finished = false;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          finished = true;
          return;
        }
        yield value;
      }
    } finally {
      if (!finished && !options?.preventCancel) {
        await reader.cancel().catch(() => undefined);
      }
      reader.releaseLock();
    }
  }

  Object.defineProperty(stream, Symbol.asyncIterator, {
    value: values,
    writable: true,
    configurable: true,
  });
  if (typeof stream.values !== "function") {
    Object.defineProperty(stream, "values", {
      value: values,
      writable: true,
      configurable: true,
    });
  }
}
