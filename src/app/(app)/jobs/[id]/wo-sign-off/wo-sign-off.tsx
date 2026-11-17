"use client";

import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  Crosshair,
  ExternalLink,
  Loader2,
  Minus,
  Plus,
  RefreshCw,
  RotateCcw,
  Undo2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { loadPdfjs, type Pdfjs } from "@/components/pdfjs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import type { NotesFit, WoValues } from "@/lib/forms/wo-draw";
import { LOCKED_WORK_ORDER } from "@/lib/forms/wo-errors";
import {
  detectWoLayout,
  type WoFound,
  type WoLayout,
  type WoOverlay,
  type WoScan,
} from "@/lib/forms/wo-layout";
import { cn } from "@/lib/utils";
import {
  defaultValues,
  type SavedSignOff,
  type WorkOrderDefaults,
} from "@/lib/wo-sign-off";
import { saveSignedWorkOrder } from "./actions";

/**
 * Signing the paying company's work order, checked before it is kept.
 *
 * The work order is read on the phone, the three places found, and the
 * sign-off drawn onto it there with the code the server keeps it with — so
 * the page on the screen is the page that is saved. Each place is a box on
 * the page that can be dragged, nudged, or stretched, and each is ticked off
 * as read. Nothing is kept until all three are.
 *
 * Built for the end of a job, on a phone, possibly with gloves on: the page
 * zooms, the box being read can be brought into view whole, and the nudges
 * are buttons rather than a fingertip's guess.
 */

type BoxKey = "times" | "notes" | "approval";
type PdfDocument = Awaited<ReturnType<Pdfjs["getDocument"]>["promise"]>;
type PdfWorker = InstanceType<Pdfjs["PDFWorker"]>;

const BOXES: BoxKey[] = ["times", "notes", "approval"];
const BOX_NAME: Record<BoxKey, string> = {
  times: "Check-in and check-out",
  notes: "Notes",
  approval: "Name, signature and date",
};
const BOX_SHORT: Record<BoxKey, string> = {
  times: "Times",
  notes: "Notes",
  approval: "Signature",
};
const VALUE_BOX: Record<keyof WoValues, BoxKey> = {
  checkIn: "times",
  checkOut: "times",
  notes: "notes",
  name: "approval",
  date: "approval",
};
/** Narrower than this and what the box holds no longer fits in it. */
const MIN_WIDTH: Record<BoxKey, number> = { times: 40, notes: 60, approval: 200 };

const MAX_WIDTH = 640;
const ZOOMS = [1, 1.5, 2, 3];
/** Safari's ceiling for one canvas, with a little room under it. */
const MAX_CANVAS_PIXELS = 16_000_000;
/** How long the preview waits for the next change before drawing. */
const PREVIEW_DELAY = 220;

const DROPPED =
  "The connection dropped before that was saved. Nothing here was lost — check your signal and press Save again.";

const round = (value: number) => Math.round(value * 10) / 10;

type Drag = {
  key: BoxKey;
  mode: "move" | "resize";
  pointerId: number;
  startX: number;
  startY: number;
  box: WoOverlay[BoxKey];
};

export function WoSignOff({
  jobId,
  workOrder,
  signedName,
  signedCopy,
  defaults,
  saved,
}: {
  jobId: string;
  workOrder: { id: string; name: string };
  /** What the signed copy will be called. */
  signedName: string;
  /** The signed copy already on the job, if this was done before. */
  signedCopy: { id: string } | null;
  defaults: WorkOrderDefaults;
  /** Where it was put last time, and what was typed then. */
  saved: SavedSignOff | null;
}) {
  const router = useRouter();

  const [phase, setPhase] = React.useState<"loading" | "ready" | "failed">("loading");
  const [failure, setFailure] = React.useState<string | null>(null);
  const [scan, setScan] = React.useState<WoScan | null>(null);
  const [detected, setDetected] = React.useState<WoLayout | null>(null);
  const [overlay, setOverlay] = React.useState<WoOverlay | null>(null);
  const [found, setFound] = React.useState<WoFound | null>(null);
  const [values, setValues] = React.useState<WoValues | null>(null);
  const [typed, setTyped] = React.useState<Partial<Record<keyof WoValues, boolean>>>({});
  const [checked, setChecked] = React.useState<Record<BoxKey, boolean>>({
    times: false,
    notes: false,
    approval: false,
  });

  const [page, setPage] = React.useState(0);
  const [zoom, setZoom] = React.useState(1);
  const [selected, setSelected] = React.useState<BoxKey | null>(null);
  const [coarse, setCoarse] = React.useState(false);
  const [frame, setFrame] = React.useState(0);
  // Bumped by "Show me" so the screen always renders and centres the box,
  // even when nothing else about it changed — pressed twice, it used to do
  // nothing the second time and then jump at the next unrelated render.
  const [, setFocusTick] = React.useState(0);

  const [preview, setPreview] = React.useState<PdfDocument | null>(null);
  const [drawn, setDrawn] = React.useState<{ notes: NotesFit; signed: boolean } | null>(null);
  // What the page on screen was drawn from. Anything else means a newer
  // version is on its way, and the ticks and the button wait for it: what is
  // saved should be what was last looked at.
  const [drawnFor, setDrawnFor] = React.useState<{
    overlay: WoOverlay;
    values: WoValues;
  } | null>(null);
  const [previewError, setPreviewError] = React.useState<string | null>(null);

  const [saving, startSaving] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<{ id: string; name: string; note: string | null } | null>(null);

  const pdfjsRef = React.useRef<Pdfjs | null>(null);
  // One pdf.js worker for the whole screen. Each document used to start its
  // own, and a preview redrawn on every change left one behind each time: a
  // short session ran eleven, and the app kept open on a phone all day piles
  // them up.
  const workerRef = React.useRef<PdfWorker | null>(null);
  const previewRef = React.useRef<PdfDocument | null>(null);
  const sourceRef = React.useRef<Uint8Array | null>(null);
  const signatureRef = React.useRef<Uint8Array | null>(null);
  const viewerRef = React.useRef<HTMLDivElement>(null);
  const scrollerRef = React.useRef<HTMLDivElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const scratchRef = React.useRef<HTMLCanvasElement | null>(null);
  const dragRef = React.useRef<Drag | null>(null);
  const focusRef = React.useRef<BoxKey | null>(null);

  // -------------------------------------------------------------------------
  // Reading the work order once: its text and lines, then the three places.

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pdfjs = await loadPdfjs();
        if (cancelled) return;
        pdfjsRef.current = pdfjs;
        workerRef.current = new pdfjs.PDFWorker();

        const response = await fetch(`/api/files/${workOrder.id}`);
        if (!response.ok) {
          throw new Error(`The work order could not be fetched (${response.status}).`);
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        // A copy goes to pdf.js: it hands its buffer to the worker, which
        // leaves the original empty for the drawing that follows.
        const document = await pdfjs.getDocument({
          data: bytes.slice(),
          worker: workerRef.current,
        }).promise;
        const { scanWorkOrder } = await import("@/lib/forms/wo-scan");
        const read = await scanWorkOrder(document, pdfjs.OPS);
        void document.destroy();
        const layout = detectWoLayout(read);

        let signature: Uint8Array | null = null;
        if (defaults.signature) {
          const fetched = await fetch(`/api/files/${defaults.signature.attachmentId}`);
          if (fetched.ok) signature = new Uint8Array(await fetched.arrayBuffer());
        }
        if (cancelled) return;

        sourceRef.current = bytes;
        signatureRef.current = signature;

        // Last time's boxes, if they still fit this file; else a fresh read.
        const fits =
          saved !== null &&
          saved.overlay.pages.every((index) => index < read.pages.length);
        const start = fits ? saved : null;
        const startFound = start?.found ?? layout.found;
        const fresh = defaultValues(defaults, startFound.times);
        const kept = start
          ? (Object.keys(fresh) as (keyof WoValues)[]).reduce(
              (all, key) => ({
                ...all,
                [key]: start.typed[key] ? start.values[key] : fresh[key],
              }),
              fresh,
            )
          : fresh;

        setScan(read);
        setDetected(layout);
        setOverlay(start?.overlay ?? layout.overlay);
        setFound(startFound);
        setValues(kept);
        setTyped(start?.typed ?? {});
        setPage((start?.overlay ?? layout.overlay).times.page);
        setPhase("ready");
      } catch (caught) {
        if (cancelled) return;
        console.error("[work order] reading it failed", caught);
        setFailure(caught instanceof Error ? caught.message : "Unknown error");
        setPhase("failed");
      }
    })();
    return () => {
      cancelled = true;
    };
    // Read once. A different work order is a different key on this component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Leaving the screen lets go of the last page drawn and of the worker.
  React.useEffect(
    () => () => {
      void previewRef.current?.destroy();
      previewRef.current = null;
      workerRef.current?.destroy();
      workerRef.current = null;
    },
    [],
  );

  // -------------------------------------------------------------------------
  // The page as it will be kept, redrawn a moment after each change.

  React.useEffect(() => {
    if (phase !== "ready" || !overlay || !values) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const { drawWorkOrder, openWorkOrder } = await import("@/lib/forms/wo-draw");
        const pdf = await openWorkOrder(sourceRef.current!, Math.max(...overlay.pages));
        const result = await drawWorkOrder(pdf, overlay, values, signatureRef.current);
        const bytes = await pdf.save();
        const document = await pdfjsRef.current!.getDocument({
          data: bytes,
          worker: workerRef.current ?? undefined,
        }).promise;
        if (cancelled) {
          void document.destroy();
          return;
        }
        const previous = previewRef.current;
        previewRef.current = document;
        setPreview(document);
        void previous?.destroy();
        setDrawn(result);
        setPreviewError(null);
      } catch (caught) {
        if (cancelled) return;
        // pdf.js reads a locked file happily; only writing on it fails. That
        // is not a preview that went wrong but a work order this cannot sign,
        // and it used to leave a blank page under three ticks that could still
        // be pressed.
        if (caught instanceof Error && caught.message === LOCKED_WORK_ORDER) {
          setFailure(LOCKED_WORK_ORDER);
          setPhase("failed");
          return;
        }
        console.error("[work order] drawing the preview failed", caught);
        setPreviewError(caught instanceof Error ? caught.message : "Unknown error");
      }
      if (!cancelled) setDrawnFor({ overlay, values });
    }, PREVIEW_DELAY);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [phase, overlay, values]);

  // How wide the page can be drawn: the inside of its frame, up to a sensible
  // page width. Measured inside the border, not outside it — two pixels too
  // wide gave every width a sideways scroll at 100%.
  React.useEffect(() => {
    const element = scrollerRef.current;
    if (!element) return;
    const measure = () => setFrame(Math.min(MAX_WIDTH, element.clientWidth));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [phase]);

  const drawing =
    phase === "ready" && (drawnFor?.overlay !== overlay || drawnFor?.values !== values);
  /** Nothing is changed or ticked while it is being saved, or before it can be seen. */
  const locked = saving;
  const canTick = !locked && !drawing && previewError === null;

  const view = scan?.pages[page]?.view ?? [0, 0, 612, 792];
  const pageWidth = view[2] - view[0];
  const pageHeight = view[3] - view[1];
  const cssWidth = Math.max(0, Math.floor(frame * zoom));
  const scale = pageWidth > 0 ? cssWidth / pageWidth : 1;

  // Drawn off screen and copied across, so the page never flashes blank
  // between one version and the next.
  React.useEffect(() => {
    const document = preview;
    const canvas = canvasRef.current;
    if (!document || !canvas || cssWidth <= 0) return;
    let cancelled = false;
    let task: { cancel(): void } | null = null;
    (async () => {
      try {
        const rendered = await document.getPage(page + 1);
        if (cancelled) return;
        const base = rendered.getViewport({ scale: 1 });
        const viewport = rendered.getViewport({ scale: cssWidth / base.width });
        // Sharp on a phone's screen, but never past what an iPhone will draw:
        // Safari leaves a canvas over about 16.7 million pixels blank, and a
        // page at 300% on a wide screen is past that at full density.
        const ratio = Math.min(
          window.devicePixelRatio || 1,
          2,
          Math.sqrt(MAX_CANVAS_PIXELS / Math.max(1, viewport.width * viewport.height)),
        );
        // One scratch canvas, reused: iOS also caps the memory all canvases
        // hold together, and a new one per redraw piles up until it is
        // collected.
        const scratch = (scratchRef.current ??= window.document.createElement("canvas"));
        scratch.width = Math.floor(viewport.width * ratio);
        scratch.height = Math.floor(viewport.height * ratio);
        const context = scratch.getContext("2d");
        if (!context) return;
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        const rendering = rendered.render({ canvas: scratch, canvasContext: context, viewport });
        task = rendering;
        await rendering.promise;
        if (cancelled) return;
        canvas.width = scratch.width;
        canvas.height = scratch.height;
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        canvas.getContext("2d")?.drawImage(scratch, 0, 0);
        // Its pixels are on the page now; it need not hold a copy until next time.
        scratch.width = 0;
        scratch.height = 0;
      } catch (caught) {
        if (!cancelled && !(caught instanceof Error && caught.name === "RenderingCancelledException")) {
          console.error("[work order] showing the page failed", caught);
        }
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [preview, page, cssWidth]);

  // After "Show me": the box in the middle of what can be seen.
  React.useLayoutEffect(() => {
    const key = focusRef.current;
    const scroller = scrollerRef.current;
    if (!key || !overlay || !scroller || overlay[key].page !== page) return;
    focusRef.current = null;
    const box = overlay[key];
    const left = (box.x - view[0]) * scale;
    const top = (view[3] - (box.y + box.height)) * scale;
    scroller.scrollTo({
      left: Math.max(0, left + (box.width * scale) / 2 - scroller.clientWidth / 2),
      top: Math.max(0, top + (box.height * scale) / 2 - scroller.clientHeight / 2),
    });
  });

  // -------------------------------------------------------------------------
  // Changes. Any change to a box un-ticks it: what was read is not there now.
  // None while saving: what was typed meanwhile used to be reported as saved
  // when the file held the version from before it.

  /**
   * A box kept whole on its page. Dragged past the edge it would be written
   * off the paper — and, off the canvas, there would be nothing left to grab
   * to bring it back.
   */
  function onPage<T extends WoOverlay[BoxKey]>(box: T): T {
    const [x0, y0, x1, y1] = scan?.pages[box.page]?.view ?? [0, 0, 612, 792];
    const width = Math.min(box.width, x1 - x0);
    const height = Math.min(box.height, y1 - y0);
    return {
      ...box,
      width,
      height,
      x: round(Math.min(Math.max(box.x, x0), x1 - width)),
      y: round(Math.min(Math.max(box.y, y0), y1 - height)),
    };
  }

  function changeBox(key: BoxKey, next: Partial<WoOverlay[BoxKey]>) {
    if (locked) return;
    setOverlay((current) =>
      current ? { ...current, [key]: onPage({ ...current[key], ...next }) } : current,
    );
    setChecked((current) => ({ ...current, [key]: false }));
    setDone(null);
  }

  function changeValue(key: keyof WoValues, value: string) {
    if (locked) return;
    setValues((current) => (current ? { ...current, [key]: value } : current));
    setTyped((current) => ({ ...current, [key]: true }));
    setChecked((current) => ({ ...current, [VALUE_BOX[key]]: false }));
    setDone(null);
  }

  function resetValues(keys: (keyof WoValues)[]) {
    if (!found || locked) return;
    const fresh = defaultValues(defaults, found.times);
    setValues((current) =>
      current ? keys.reduce((all, key) => ({ ...all, [key]: fresh[key] }), current) : current,
    );
    setTyped((current) => keys.reduce((all, key) => ({ ...all, [key]: false }), current));
    for (const key of keys) {
      setChecked((current) => ({ ...current, [VALUE_BOX[key]]: false }));
    }
    // Back to the job's values is a change like any other: it used to leave
    // "Saved" up and no button to save the change with.
    setDone(null);
  }

  function findAgain() {
    if (!detected || locked) return;
    setOverlay(detected.overlay);
    setFound(detected.found);
    // The times follow the layout — a date with them where WorkMarket printed
    // its own — unless somebody typed their own.
    const fresh = defaultValues(defaults, detected.found.times);
    setValues((current) =>
      current
        ? {
            ...current,
            checkIn: typed.checkIn ? current.checkIn : fresh.checkIn,
            checkOut: typed.checkOut ? current.checkOut : fresh.checkOut,
          }
        : current,
    );
    setChecked({ times: false, notes: false, approval: false });
    setPage(detected.overlay.times.page);
    setDone(null);
  }

  function toggleCheck(key: BoxKey) {
    if (!canTick) return;
    setChecked((current) => ({ ...current, [key]: !current[key] }));
  }

  /** Brings the page into view, room left for an iPhone's status bar. */
  function viewerIntoView() {
    const viewer = viewerRef.current;
    if (!viewer) return;
    viewer.scrollIntoView({ block: "start" });
    // The offline notice sits over the top of the screen when it shows, as
    // the checkout wizard already allows for.
    const banner = window.document.querySelector<HTMLElement>("[data-offline-banner]");
    if (banner) window.scrollBy(0, -banner.getBoundingClientRect().height);
  }

  function show(key: BoxKey) {
    if (!overlay || !scan) return;
    const box = overlay[key];
    const boxView = scan.pages[box.page]?.view ?? [0, 0, 612, 792];
    const room = (scrollerRef.current?.clientWidth ?? frame) - 24;
    // As close as it can be while the whole box is still in view across: at a
    // fixed 200% the signature row was read a third at a time on a phone.
    const fit = ZOOMS.filter(
      (step) => box.width * ((frame * step) / (boxView[2] - boxView[0])) <= room,
    );
    setSelected(key);
    setPage(box.page);
    setZoom(fit.length > 0 ? Math.max(...fit) : ZOOMS[0]);
    focusRef.current = key;
    setFocusTick((tick) => tick + 1);
    viewerIntoView();
  }

  function nudge(key: BoxKey, dx: number, dy: number) {
    if (!overlay) return;
    const box = overlay[key];
    changeBox(key, { x: round(box.x + dx), y: round(box.y + dy) });
  }

  /** Stretched from the corner: the top-left stays where it is. */
  function stretch(key: BoxKey, box: WoOverlay[BoxKey], dWidth: number, dHeight: number) {
    // And the box stops at the page's edge rather than pushing its top up.
    const boxView = scan?.pages[box.page]?.view ?? [0, 0, 612, 792];
    const width = Math.min(Math.max(MIN_WIDTH[key], box.width + dWidth), boxView[2] - box.x);
    const height = Math.min(Math.max(8, box.height + dHeight), box.y + box.height - boxView[1]);
    const next: Partial<WoOverlay[BoxKey]> = {
      width: round(width),
      height: round(height),
      y: round(box.y + box.height - height),
    };
    // The signature and the date are set along the row by how far in they
    // are; stretched, they move with it. Fixed, a narrowed row left the date
    // outside its own box, drawn tiny, and a widened one changed nothing.
    if (key === "approval" && "signatureAt" in box) {
      const factor = width / box.width;
      Object.assign(next, {
        signatureAt: round(box.signatureAt * factor),
        dateAt: round(box.dateAt * factor),
      });
    }
    changeBox(key, next);
  }

  function onPointerDown(event: React.PointerEvent, key: BoxKey, mode: Drag["mode"]) {
    if (!overlay || locked) return;
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    setSelected(key);
    dragRef.current = {
      key,
      mode,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      box: overlay[key],
    };
  }

  function onPointerMove(event: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.stopPropagation();
    const dx = (event.clientX - drag.startX) / scale;
    const dy = (event.clientY - drag.startY) / scale;
    const box = drag.box;
    if (drag.mode === "move") {
      changeBox(drag.key, { x: round(box.x + dx), y: round(box.y - dy) });
    } else {
      stretch(drag.key, box, dx, dy);
    }
  }

  function onPointerUp(event: React.PointerEvent) {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  }

  function onBoxKey(event: React.KeyboardEvent, key: BoxKey) {
    if (event.key === "Escape") {
      setSelected(null);
      (event.currentTarget as HTMLElement).blur();
      return;
    }
    const step = event.shiftKey ? 10 : 1;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    };
    const move = moves[event.key];
    if (!move || !overlay) return;
    event.preventDefault();
    // With Alt, the arrows stretch rather than move: the dot on the corner
    // has to be reachable without a pointer too.
    if (event.altKey) stretch(key, overlay[key], move[0], -move[1]);
    else nudge(key, move[0], move[1]);
  }

  function save() {
    if (!overlay || !values || !found) return;
    setError(null);
    startSaving(async () => {
      const formData = new FormData();
      formData.set(
        "payload",
        JSON.stringify({
          jobId,
          workOrderId: workOrder.id,
          overlay,
          values,
          typed,
          found,
        }),
      );
      // A request that never gets an answer rejects rather than returning a
      // result. Uncaught, it took the whole screen with it — Next's error
      // page in place of the boxes, the ticks and everything typed.
      let result: Awaited<ReturnType<typeof saveSignedWorkOrder>>;
      try {
        result = await saveSignedWorkOrder(formData);
      } catch {
        setError(DROPPED);
        return;
      }
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDone({
        id: result.id,
        name: result.name,
        note: !result.signed
          ? "It went without a customer signature: none was captured on this job."
          : result.notesCut
            ? "The notes were cut short to fit; the whole of them is in the job report."
            : null,
      });
      router.refresh();
    });
  }

  // -------------------------------------------------------------------------

  if (phase === "failed") {
    return (
      <div role="alert" className="flex flex-col gap-3 rounded-xl border border-border p-4 text-sm">
        <p className="text-danger">This work order could not be read here.</p>
        {failure ? <p className="text-muted-foreground">{failure}</p> : null}
        <div className="flex flex-wrap gap-2">
          {failure !== LOCKED_WORK_ORDER ? (
            <Button type="button" variant="secondary" onClick={() => window.location.reload()}>
              <RefreshCw /> Try again
            </Button>
          ) : null}
          <a
            href={`/api/files/${workOrder.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border px-3 hover:bg-muted"
          >
            <ExternalLink className="size-4" aria-hidden /> Open the work order
          </a>
          <Link
            href={`/jobs/${jobId}`}
            className="inline-flex min-h-11 items-center rounded-lg border border-border px-3 hover:bg-muted"
          >
            Back to the job
          </Link>
        </div>
      </div>
    );
  }

  if (phase === "loading" || !overlay || !values || !found || !scan) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        Reading {workOrder.name} and finding where the sign-off goes…
      </p>
    );
  }

  const ticked = BOXES.filter((key) => checked[key]).length;
  const notesLines = Math.max(1, Math.floor((overlay.notes.height + 0.01) / overlay.notes.pitch));
  const zoomIndex = ZOOMS.indexOf(zoom);
  // The move buttons are for a box that can be seen. On another page they
  // moved it out of sight and un-ticked it.
  const selectedBox = selected && overlay[selected].page === page ? overlay[selected] : null;
  const step = coarse ? 10 : 1;
  const points = coarse ? "10 points" : "a point";

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      {/* The page. Scrolled to with room above it for an iPhone's status bar
          when the app is opened from the home screen. */}
      <div
        ref={viewerRef}
        className="flex min-w-0 scroll-mt-[calc(env(safe-area-inset-top)+0.75rem)] flex-col gap-2 lg:sticky lg:top-4 lg:w-[640px] lg:shrink-0"
      >
        <div className="flex flex-wrap items-center gap-2">
          {overlay.pages.length > 1 ? (
            <div role="group" aria-label="Page" className="flex flex-wrap gap-1">
              {overlay.pages.map((index) => (
                <Button
                  key={index}
                  type="button"
                  variant={index === page ? "primary" : "secondary"}
                  aria-pressed={index === page}
                  onClick={() => setPage(index)}
                >
                  Page {index + 1}
                </Button>
              ))}
            </div>
          ) : null}
          <div className="ml-auto flex items-center gap-1">
            <Button
              type="button"
              size="icon"
              variant="secondary"
              aria-label="Zoom out"
              disabled={zoomIndex <= 0}
              onClick={() => setZoom(ZOOMS[Math.max(0, zoomIndex - 1)])}
            >
              <Minus />
            </Button>
            <span className="tabular w-12 text-center text-sm text-muted-foreground">
              {Math.round(zoom * 100)}%
            </span>
            <Button
              type="button"
              size="icon"
              variant="secondary"
              aria-label="Zoom in"
              disabled={zoomIndex >= ZOOMS.length - 1}
              onClick={() => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, zoomIndex + 1)])}
            >
              <Plus />
            </Button>
          </div>
        </div>

        <div className="w-full">
          <div
            ref={scrollerRef}
            className="relative max-h-[75vh] overflow-auto rounded-xl border border-border bg-white [scrollbar-gutter:stable]"
          >
            <div
              className="relative"
              style={{ width: cssWidth, height: Math.round(pageHeight * scale) }}
              // A tap on the page, not on a box, puts the box down: there was
              // no way to see the values without its outline over them.
              onClick={(event) => {
                if (event.target === event.currentTarget || event.target === canvasRef.current) {
                  setSelected(null);
                }
              }}
            >
              <canvas ref={canvasRef} className="block" aria-label={`Page ${page + 1} of the work order, as it will be saved`} />

              {BOXES.filter((key) => overlay[key].page === page).map((key) => {
                const box = overlay[key];
                const active = selected === key;
                return (
                  <div
                    key={key}
                    role="button"
                    tabIndex={0}
                    aria-label={`${BOX_NAME[key]} box. Drag it, or use the arrow keys, to move it; Alt with the arrows stretches it.`}
                    aria-pressed={active}
                    aria-disabled={locked || undefined}
                    data-box={key}
                    onPointerDown={(event) => onPointerDown(event, key, "move")}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={onPointerUp}
                    onKeyDown={(event) => onBoxKey(event, key)}
                    onFocus={() => setSelected(key)}
                    // Drawn just outside the box, never over it: the 2 px edge
                    // used to sit on the first digit of the time it framed.
                    className={cn(
                      "absolute cursor-move touch-none select-none rounded-[2px] outline-2 outline-offset-2 [-webkit-touch-callout:none]",
                      active
                        ? "bg-[var(--color-primary)]/10 outline-solid outline-[var(--color-primary)]"
                        : checked[key]
                          ? "outline-dashed outline-success/70"
                          : "outline-dashed outline-[var(--color-primary)]/60",
                    )}
                    style={{
                      left: (box.x - view[0]) * scale,
                      top: (view[3] - (box.y + box.height)) * scale,
                      width: Math.max(12, box.width * scale),
                      height: Math.max(10, box.height * scale),
                    }}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "pointer-events-none absolute -top-6 left-0 whitespace-nowrap rounded px-1 text-[0.6875rem] font-medium leading-4",
                        active
                          ? "bg-[var(--color-primary)] text-primary-foreground"
                          : "bg-surface-raised text-foreground shadow-sm",
                      )}
                    >
                      {BOX_SHORT[key]}
                    </span>
                    {active ? (
                      // A 44 px place to press, with the dot it holds sitting
                      // outside the corner: inside, it covered the "PM" of the
                      // check-out the owner asked to have written out.
                      <span
                        aria-hidden
                        onPointerDown={(event) => onPointerDown(event, key, "resize")}
                        onPointerMove={onPointerMove}
                        onPointerUp={onPointerUp}
                        onPointerCancel={onPointerUp}
                        className="absolute -bottom-8 -right-8 flex size-11 cursor-nwse-resize touch-none select-none items-center justify-center [-webkit-touch-callout:none]"
                      >
                        <span className="pointer-events-none size-5 rounded-full border-2 border-white bg-[var(--color-primary)] shadow" />
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <p className="flex min-h-5 items-center gap-2 text-xs text-muted-foreground">
          {drawing ? (
            <>
              <Loader2 className="size-3 animate-spin" aria-hidden /> Drawing it…
            </>
          ) : previewError ? (
            <span role="alert" className="text-danger">
              The preview could not be drawn: {previewError}
            </span>
          ) : (
            "This is the page as it will be saved. Drag a box to move it; the dot on its corner stretches it. Tap the page to put it down."
          )}
        </p>

        {selected && selectedBox ? (
          <div
            role="group"
            aria-label={`Move the ${BOX_NAME[selected].toLowerCase()} box`}
            className="flex flex-wrap items-center gap-2 rounded-xl border border-border p-2"
          >
            <span className="text-sm font-medium">{BOX_SHORT[selected]}</span>
            <div className="flex items-center gap-1">
              <Button type="button" size="icon" variant="secondary" aria-label={`Left ${points}`} disabled={locked} onClick={() => nudge(selected, -step, 0)}>
                <ArrowLeft />
              </Button>
              <Button type="button" size="icon" variant="secondary" aria-label={`Up ${points}`} disabled={locked} onClick={() => nudge(selected, 0, step)}>
                <ArrowUp />
              </Button>
              <Button type="button" size="icon" variant="secondary" aria-label={`Down ${points}`} disabled={locked} onClick={() => nudge(selected, 0, -step)}>
                <ArrowDown />
              </Button>
              <Button type="button" size="icon" variant="secondary" aria-label={`Right ${points}`} disabled={locked} onClick={() => nudge(selected, step, 0)}>
                <ArrowRight />
              </Button>
            </div>
            {/* A point a tap is right for the last nudge and slow for the
                first; ten at a time gets a parked box across the page. */}
            <Button
              type="button"
              variant={coarse ? "primary" : "secondary"}
              aria-pressed={coarse}
              onClick={() => setCoarse((current) => !current)}
            >
              ×10
            </Button>
            {overlay.pages.length > 1 ? (
              <label className="ml-auto flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">On page</span>
                <select
                  value={selectedBox.page}
                  disabled={locked}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    changeBox(selected, { page: next });
                    setPage(next);
                  }}
                  className="min-h-11 rounded-lg border border-border bg-input px-2"
                >
                  {overlay.pages.map((index) => (
                    <option key={index} value={index}>
                      {index + 1}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* What goes where, and the three ticks. Its fields go side by side by
          the width of this column, not of the screen: beside the page on a
          desktop it is narrower than a phone held sideways, and a time in a
          half-width field read "11-16-2026 9:06 A". */}
      <div className="@container flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={ticked === 3 ? "success" : "neutral"}>
            {ticked === 3 ? "All three checked" : `${3 - ticked} of 3 left to check`}
          </Badge>
          {signedCopy ? (
            <a
              href={`/api/files/${signedCopy.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-muted-foreground underline-offset-2 hover:underline"
            >
              The signed copy already on the job
            </a>
          ) : null}
          <Button type="button" variant="ghost" className="ml-auto" disabled={locked} onClick={findAgain}>
            <RotateCcw /> Find the boxes again
          </Button>
        </div>

        <Section
          box="times"
          checked={checked.times}
          canTick={canTick}
          onShow={() => show("times")}
          onCheck={() => toggleCheck("times")}
          notes={[
            found.times === "lines"
              ? { text: "Written on the blank Arrival time and Departure time lines." }
              : found.times === "printed"
                ? {
                    text: "WorkMarket printed its own check-in and check-out here. They are painted over and these written in their place.",
                  }
                : {
                    text: "Not found on this work order. The box is parked at the top right — drag it to where the times go.",
                    warn: true,
                  },
            !defaults.checkIn || !defaults.checkOut
              ? { text: "This job has no complete check-in and check-out to give.", warn: true }
              : null,
          ]}
        >
          <div className="grid grid-cols-1 gap-3 @lg:grid-cols-2">
            <Field label="Check-in" htmlFor="wo-check-in">
              <Input
                id="wo-check-in"
                value={values.checkIn}
                maxLength={60}
                disabled={locked}
                onChange={(event) => changeValue("checkIn", event.target.value)}
              />
            </Field>
            <Field label="Check-out" htmlFor="wo-check-out">
              <Input
                id="wo-check-out"
                value={values.checkOut}
                maxLength={60}
                disabled={locked}
                onChange={(event) => changeValue("checkOut", event.target.value)}
              />
            </Field>
          </div>
          {typed.checkIn || typed.checkOut ? (
            <ResetLink disabled={locked} onClick={() => resetValues(["checkIn", "checkOut"])}>
              Back to the job&rsquo;s times
            </ResetLink>
          ) : null}
        </Section>

        <Section
          box="notes"
          checked={checked.notes}
          canTick={canTick}
          onShow={() => show("notes")}
          onCheck={() => toggleCheck("notes")}
          notes={[
            found.notes === "lines"
              ? {
                  text: `On the ${notesLines} ruled lines under Notes${overlay.notes.page > 0 ? `, on page ${overlay.notes.page + 1}` : ""}.`,
                }
              : found.notes === "heading"
                ? { text: "Found the Notes heading but no lines; the box sits under it." }
                : {
                    text: "No Notes box found. Drag the box to where the note should go.",
                    warn: true,
                  },
            drawn?.notes.cut
              ? {
                  text: "Too long for the box even at the smallest size: it is cut short and ends “… (continued in the job report)”. Shorten it here to keep it whole.",
                  warn: true,
                }
              : drawn && !drawn.notes.onRules
                ? { text: `Set smaller, at ${drawn.notes.size} pt, to fit the box.` }
                : null,
            !values.notes.trim()
              ? { text: "Nothing has been written under Work performed on this job.", warn: true }
              : null,
          ]}
        >
          <Field label="Work performed" htmlFor="wo-notes">
            <Textarea
              id="wo-notes"
              rows={5}
              value={values.notes}
              maxLength={4000}
              disabled={locked}
              onChange={(event) => changeValue("notes", event.target.value)}
            />
          </Field>
          {typed.notes ? (
            <ResetLink disabled={locked} onClick={() => resetValues(["notes"])}>
              Back to the job&rsquo;s report
            </ResetLink>
          ) : null}
        </Section>

        <Section
          box="approval"
          checked={checked.approval}
          canTick={canTick}
          onShow={() => show("approval")}
          onCheck={() => toggleCheck("approval")}
          notes={[
            found.approval
              ? { text: "On the Customer Name, Customer Signature and Date line." }
              : {
                  text: "No signature line found. The box is parked low on the last page of the first copy — drag it onto the line.",
                  warn: true,
                },
            !defaults.signature
              ? {
                  text: "No customer signature was captured on this job, so that part of the line stays empty.",
                  warn: true,
                }
              : drawn && !drawn.signed
                ? { text: "The signature on this job could not be drawn.", warn: true }
                : { text: "The customer's signature from the checkout goes on the line." },
          ]}
        >
          <div className="grid grid-cols-1 gap-3 @md:grid-cols-2">
            <Field label="Printed name" htmlFor="wo-name">
              <Input
                id="wo-name"
                value={values.name}
                maxLength={120}
                disabled={locked}
                onChange={(event) => changeValue("name", event.target.value)}
              />
            </Field>
            <Field label="Date" htmlFor="wo-date">
              <Input
                id="wo-date"
                value={values.date}
                maxLength={40}
                disabled={locked}
                onChange={(event) => changeValue("date", event.target.value)}
              />
            </Field>
          </div>
          {typed.name || typed.date ? (
            <ResetLink disabled={locked} onClick={() => resetValues(["name", "date"])}>
              Back to the job&rsquo;s name and date
            </ResetLink>
          ) : null}
        </Section>

        <div className="flex flex-col gap-3 rounded-xl border border-border p-3 text-sm">
          <p>
            Saved with the work orders as <strong className="[overflow-wrap:anywhere]">{signedName}</strong>.{" "}
            <span className="text-muted-foreground [overflow-wrap:anywhere]">
              {workOrder.name} stays on the job as it is; only its first copy is signed.
            </span>
          </p>
          {error ? (
            <p role="alert" className="text-danger">
              {error}
            </p>
          ) : null}
          {done ? (
            <div role="status" className="flex flex-col gap-2">
              <p className="font-medium text-success">Saved: {done.name}</p>
              {done.note ? <p className="text-muted-foreground">{done.note}</p> : null}
              <div className="flex flex-wrap gap-2">
                <a
                  href={`/api/files/${done.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border px-3 hover:bg-muted"
                >
                  <ExternalLink className="size-4" aria-hidden /> Open it
                </a>
                <Link
                  href={`/jobs/${jobId}`}
                  className="inline-flex min-h-11 items-center rounded-lg border border-border px-3 hover:bg-muted"
                >
                  Back to the job
                </Link>
              </div>
            </div>
          ) : (
            <>
              <Button
                type="button"
                block
                disabled={ticked < 3 || saving || drawing || previewError !== null}
                onClick={save}
              >
                {saving ? <Loader2 className="animate-spin" /> : <Check />}
                {signedCopy ? "Replace the signed work order" : "Save the signed work order"}
              </Button>
              {ticked < 3 ? (
                <p className="text-xs text-muted-foreground">
                  Look at each of the three on the page and press Looks right on it first.
                </p>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({
  box,
  checked,
  canTick,
  onShow,
  onCheck,
  notes,
  children,
}: {
  box: BoxKey;
  checked: boolean;
  /** Not while the page is being redrawn or saved: a tick is for what was seen. */
  canTick: boolean;
  onShow: () => void;
  onCheck: () => void;
  notes: ({ text: string; warn?: boolean } | null)[];
  children: React.ReactNode;
}) {
  return (
    <section
      aria-label={BOX_NAME[box]}
      className={cn(
        "flex flex-col gap-3 rounded-xl border p-3 transition-colors",
        checked ? "border-success/60 bg-success/5" : "border-border",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">{BOX_NAME[box]}</h2>
        {checked ? <Badge variant="success">Checked</Badge> : null}
      </div>
      <ul className="flex flex-col gap-1 text-sm">
        {notes
          .filter((note): note is { text: string; warn?: boolean } => note !== null)
          .map((note) => (
            <li key={note.text} className={note.warn ? "text-warning" : "text-muted-foreground"}>
              {note.text}
            </li>
          ))}
      </ul>
      {children}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" onClick={onShow}>
          <Crosshair /> Show me
        </Button>
        {/* The label says what pressing it does; it is not also a pressed
            toggle, which read the same change out twice. */}
        <Button
          type="button"
          variant={checked ? "ghost" : "primary"}
          disabled={!canTick}
          onClick={onCheck}
        >
          {checked ? (
            <>
              <Undo2 /> Checked — undo
            </>
          ) : (
            <>
              <Check /> Looks right
            </>
          )}
        </Button>
      </div>
    </section>
  );
}

function ResetLink({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="min-h-11 w-fit text-left text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50"
    >
      {children}
    </button>
  );
}
