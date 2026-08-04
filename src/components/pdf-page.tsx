"use client";

import * as React from "react";

/**
 * One page of a PDF, rendered to a canvas.
 *
 * Used by the form mapping screen, where somebody has to point at a box on a
 * blank and say what goes in it. A field called "Text19" cannot be mapped
 * without seeing where it sits on the page, so the preview is the feature
 * rather than decoration.
 *
 * pdf.js is loaded on demand and never reaches the tech's phone: this is an
 * office screen, used once per company form.
 */

type PdfPageProps = {
  /** Where to fetch the file from. */
  url: string;
  /** Zero-based. */
  page: number;
  /** Rendered width in CSS pixels; height follows the page's aspect. */
  width: number;
  className?: string;
};

export function PdfPage({ url, page, width, className }: PdfPageProps) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    let task: { cancel(): void } | null = null;

    async function render() {
      setLoading(true);
      setError(null);
      try {
        // The legacy build, deliberately. The default one is compiled for the
        // newest engines and reaches for proposals most browsers do not have
        // yet — it dies on `getOrInsertComputed is not a function` in anything
        // but a current Chrome, and node_modules are not down-levelled by the
        // app's own build. This is an office screen used a few times a year;
        // the extra bytes cost nothing next to it not working.
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

        // The worker is emitted as an asset of this bundle rather than pulled
        // from a CDN: the app runs behind Tailscale on a server with no
        // outbound path to one.
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
          import.meta.url,
        ).toString();

        const response = await fetch(url);
        if (!response.ok) throw new Error(`${response.status}`);
        const data = new Uint8Array(await response.arrayBuffer());
        if (cancelled) return;

        const document = await pdfjs.getDocument({ data }).promise;
        if (cancelled) {
          void document.destroy();
          return;
        }

        const rendered = await document.getPage(page + 1);
        const base = rendered.getViewport({ scale: 1 });

        const canvas = canvasRef.current;
        if (!canvas) return;

        // Rendered at the device's pixel density so the form's small print is
        // legible — a blurry preview is one nobody can map against.
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = rendered.getViewport({ scale: width / base.width });
        canvas.width = Math.floor(viewport.width * ratio);
        canvas.height = Math.floor(viewport.height * ratio);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;

        const context = canvas.getContext("2d");
        if (!context) throw new Error("no 2d context");
        context.scale(ratio, ratio);

        task = rendered.render({ canvas, canvasContext: context, viewport });
        await (task as unknown as { promise: Promise<void> }).promise;
        if (!cancelled) setLoading(false);
        void document.destroy();
      } catch (caught) {
        if (cancelled) return;
        // A render that fails is not fatal — the boxes are still listed, and
        // the sample text is usually enough to map by. The reason goes on
        // screen rather than only into the console: this failed once for a
        // whole browser family, and "could not be shown" told nobody why.
        console.error("[pdf] rendering the page failed", caught);
        setError(
          caught instanceof Error && caught.message
            ? caught.message
            : "Unknown error",
        );
        setLoading(false);
      }
    }

    void render();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [url, page, width]);

  return (
    <div className={className}>
      <canvas ref={canvasRef} className="block bg-white" />
      {loading ? (
        <p className="p-3 text-sm text-muted-foreground">Rendering the blank…</p>
      ) : null}
      {error ? (
        <div className="p-3 text-sm">
          <p className="text-danger">
            This page could not be shown. The list beside it still works.
          </p>
          <p className="mt-1 break-words text-xs text-muted-foreground">
            {error}
          </p>
        </div>
      ) : null}
    </div>
  );
}
