"use client";

import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  ExternalLink,
  Loader2,
  Minus,
  Pencil,
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
import { lettersPrintedDifferently, toWinAnsi } from "@/lib/forms/text-fit";
import type { WoDrawResult, WoValues } from "@/lib/forms/wo-draw";
import { DAMAGED_WORK_ORDER, LOCKED_WORK_ORDER, pagesDisagree } from "@/lib/forms/wo-errors";
import {
  detectWoLayout,
  type WoFound,
  type WoLayout,
  type WoOverlay,
  type WoRect,
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
 * the page on the screen is the page that is saved.
 *
 * Two ways through it, by the width of the screen. On a computer the page sits
 * beside the three places, each with Show and Apply, and the file is saved
 * once all three are applied. On a phone it is one place at a time, the owner's
 * design: the page as large as the screen allows, moved to each place in turn,
 * and a block under it for the place in front — Back, Edit, Next. Next applies
 * it and moves on; after the third comes Approve, for the whole document.
 * Nothing on the page moves there until Edit is pressed, so a thumb panning
 * round the page cannot shift a box by accident.
 *
 * Built for the end of a job, possibly with gloves on: the nudges are buttons
 * rather than a fingertip's guess.
 */

type BoxKey = "times" | "notes" | "approval";
type PdfDocument = Awaited<ReturnType<Pdfjs["getDocument"]>["promise"]>;
type PdfWorker = InstanceType<Pdfjs["PDFWorker"]>;
type Note = { text: string; warn?: boolean };
type SignatureState = "none" | "read" | "unreadable";

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
const BOX_PLACE: Record<BoxKey, string> = {
  times: "where the times go",
  notes: "where the note should go",
  approval: "onto the signature line",
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
const LETTER_VIEW: [number, number, number, number] = [0, 0, 612, 792];

/**
 * Narrower than a laptop: the steps. The owner's choice — a phone gets one
 * place at a time, a computer keeps the page with the three beside it.
 */
const STEPS_QUERY = "(max-width: 1023.98px)";
/** The least of the page a phone shows while a place is being changed under it. */
const MIN_PREVIEW = 180;
/**
 * How long a new step waits before Next or Approve can be pressed on it. Two
 * taps 120 ms apart went straight through a place nobody had looked at, and on
 * the last place the second tap landed on Approve and saved the document.
 */
const SETTLE_MS = 700;
/** The step after the last place: the whole document, to approve. */
const ALL_DONE = BOXES.length;

const DROPPED =
  "The connection dropped before that was saved. Nothing here was lost — check your signal and press it again.";

/** What no second try will fix: the file itself is the trouble. */
class FinalFailure extends Error {}

const round = (value: number) => Math.round(value * 10) / 10;

const sameBox = (a: WoRect, b: WoRect) =>
  a.page === b.page && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

function useMediaQuery(query: string): boolean {
  const subscribe = React.useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    // On the server: nothing is drawn there before the work order is read.
    () => false,
  );
}

/** Brings the page into view, room left for an iPhone's status bar. */
function intoView(viewer: HTMLElement | null) {
  if (!viewer) return;
  viewer.scrollIntoView({ block: "start" });
  // The offline notice sits over the top of the screen when it shows, as the
  // checkout wizard already allows for.
  const banner = window.document.querySelector<HTMLElement>("[data-offline-banner]");
  if (banner) window.scrollBy(0, -banner.getBoundingClientRect().height);
}

/** "page 1", "pages 1–3". */
const pagesLabel = (count: number) => (count === 1 ? "page 1" : `pages 1–${count}`);

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
  const steps = useMediaQuery(STEPS_QUERY);

  const [phase, setPhase] = React.useState<"loading" | "ready" | "failed">("loading");
  const [failure, setFailure] = React.useState<{ message: string; final: boolean } | null>(null);
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
  const [signatureState, setSignatureState] = React.useState<SignatureState>("none");
  const [everyPage, setEveryPage] = React.useState(false);
  // What was found on the first copy alone, to go back to from every page.
  const [firstCopy, setFirstCopy] = React.useState<WoLayout | null>(null);
  const [widening, setWidening] = React.useState(false);

  const [page, setPage] = React.useState(0);
  // Null: as close as the place in front allows. A number: chosen with the buttons.
  const [zoomChoice, setZoom] = React.useState<number | null>(null);
  const [selected, setSelected] = React.useState<BoxKey | null>(null);
  const [coarse, setCoarse] = React.useState(false);
  const [frame, setFrame] = React.useState(0);
  // Bumped by Show so the screen always renders and centres the box, even
  // when nothing else about it changed — pressed twice, it used to do nothing
  // the second time and then jump at the next unrelated render.
  const [, setFocusTick] = React.useState(0);

  // The phone's steps: which place is in front, and whether it is being changed.
  const [step, setStep] = React.useState(0);
  const [editing, setEditing] = React.useState(false);
  // A new step, not yet long enough in front to have been looked at.
  const [settling, setSettling] = React.useState(false);
  // The page and width the canvas last finished drawing, so a step's Next
  // waits for its own page rather than the one before it.
  const [painted, setPainted] = React.useState<string | null>(null);
  // Which boxes somebody has put in place by hand. By position, a parked box
  // moved away and back again counted as never moved; and a box put in place
  // by hand was thrown away when every page was read.
  const [moved, setMoved] = React.useState<Record<BoxKey, boolean>>({
    times: false,
    notes: false,
    approval: false,
  });
  // What reading every page, or going back to the first copy, did to the boxes.
  const [notice, setNotice] = React.useState<string | null>(null);
  const [previewHeight, setPreviewHeight] = React.useState<number | null>(null);

  const [preview, setPreview] = React.useState<PdfDocument | null>(null);
  const [drawn, setDrawn] = React.useState<WoDrawResult | null>(null);
  // What the page on screen was drawn from. Anything else means a newer
  // version is on its way, and applying and saving wait for it: what is saved
  // should be what was last looked at.
  const [drawnFor, setDrawnFor] = React.useState<{
    overlay: WoOverlay;
    values: WoValues;
  } | null>(null);
  const [previewError, setPreviewError] = React.useState<string | null>(null);

  const [saving, startSaving] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<{ id: string; name: string } | null>(null);

  const pdfjsRef = React.useRef<Pdfjs | null>(null);
  // One pdf.js worker for the whole screen. Each document used to start its
  // own, and a preview redrawn on every change left one behind each time: a
  // short session ran eleven, and the app kept open on a phone all day piles
  // them up.
  const workerRef = React.useRef<PdfWorker | null>(null);
  // The work order as read, kept open: choosing every page reads the rest.
  const scanDocumentRef = React.useRef<PdfDocument | null>(null);
  const previewRef = React.useRef<PdfDocument | null>(null);
  const sourceRef = React.useRef<Uint8Array | null>(null);
  const signatureRef = React.useRef<Uint8Array | null>(null);
  const viewerRef = React.useRef<HTMLDivElement>(null);
  const scrollerRef = React.useRef<HTMLDivElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const scratchRef = React.useRef<HTMLCanvasElement | null>(null);
  const currentRef = React.useRef<HTMLElement>(null);
  const dragRef = React.useRef<Drag | null>(null);
  const focusRef = React.useRef<BoxKey | null>(null);
  const placedRef = React.useRef(false);
  // Whether the page has ever been drawn with the sign-off on it.
  const everDrawnRef = React.useRef(false);
  const settleRef = React.useRef<number | null>(null);
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  const focusHeadingRef = React.useRef(false);

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
        if (cancelled) {
          void document.destroy();
          return;
        }
        scanDocumentRef.current = document;
        const { scanWorkOrder } = await import("@/lib/forms/wo-scan");
        const firstRead = await scanWorkOrder(document, pdfjs.OPS);
        const firstLayout = detectWoLayout(firstRead);

        // The pages as they will be written on. pdf.js shows a damaged file
        // one way and pdf-lib writes on it another; a box placed on page 3
        // here could land on a customer copy there. Said now, before anybody
        // spends five minutes placing boxes on it.
        const { workOrderPageCount } = await import("@/lib/forms/wo-draw");
        let writable: number;
        try {
          writable = await workOrderPageCount(bytes);
        } catch (caught) {
          if (caught instanceof Error && caught.message === LOCKED_WORK_ORDER) {
            throw new FinalFailure(LOCKED_WORK_ORDER);
          }
          console.error("[work order] it cannot be opened to write on", caught);
          throw new FinalFailure(DAMAGED_WORK_ORDER);
        }
        if (writable !== firstRead.pages.length) {
          throw new FinalFailure(pagesDisagree(firstRead.pages.length, writable));
        }

        // The signature as the server will draw it, from the server: the
        // stored file handed to pdf-lib here froze the page when it was
        // damaged, and showed one the saved copy went without.
        let signature: Uint8Array | null = null;
        let signatureRead: SignatureState = "none";
        if (defaults.signature) {
          const fetched = await fetch(`/api/jobs/${jobId}/wo-signature`, { cache: "no-store" });
          if (fetched.ok) {
            signature = new Uint8Array(await fetched.arrayBuffer());
            signatureRead = "read";
          } else {
            signatureRead = "unreadable";
          }
        }
        if (cancelled) return;

        // Last time's boxes, if they still fit this file; else a fresh read.
        // Signed across every page last time, it is read across every page.
        const fits =
          saved !== null &&
          saved.overlay.pages.every((index) => index < firstRead.pages.length);
        const start = fits ? saved : null;
        const wide =
          start !== null && start.overlay.pages.length > firstLayout.overlay.pages.length;
        const read = wide
          ? await scanWorkOrder(document, pdfjs.OPS, { everyPage: true })
          : firstRead;
        const layout = wide ? detectWoLayout(read, { everyPage: true }) : firstLayout;
        if (cancelled) return;

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

        setFirstCopy(firstLayout);
        sourceRef.current = bytes;
        signatureRef.current = signature;
        setSignatureState(signatureRead);
        setScan(read);
        setDetected(layout);
        setEveryPage(wide);
        setOverlay(start?.overlay ?? layout.overlay);
        setFound(startFound);
        // Last time's boxes were looked at and saved: in place, not parked.
        if (start) setMoved({ times: true, notes: true, approval: true });
        setValues(kept);
        setTyped(start?.typed ?? {});
        setPage((start?.overlay ?? layout.overlay).times.page);
        focusRef.current = "times";
        setPhase("ready");
      } catch (caught) {
        if (cancelled) return;
        console.error("[work order] reading it failed", caught);
        setFailure({
          message: caught instanceof Error ? caught.message : "Unknown error",
          final: caught instanceof FinalFailure,
        });
        setPhase("failed");
      }
    })();
    return () => {
      cancelled = true;
    };
    // Read once. A different work order is a different key on this component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Leaving the screen lets go of the documents and of the worker.
  React.useEffect(
    () => () => {
      void previewRef.current?.destroy();
      previewRef.current = null;
      void scanDocumentRef.current?.destroy();
      scanDocumentRef.current = null;
      workerRef.current?.destroy();
      workerRef.current = null;
      if (settleRef.current !== null) window.clearTimeout(settleRef.current);
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
        everDrawnRef.current = true;
      } catch (caught) {
        if (cancelled) return;
        // pdf.js reads a locked file happily; only writing on it fails. That
        // is not a preview that went wrong but a work order this cannot sign,
        // and it used to leave a blank page under ticks that could still be
        // pressed.
        if (caught instanceof Error && caught.message === LOCKED_WORK_ORDER) {
          setFailure({ message: LOCKED_WORK_ORDER, final: true });
          setPhase("failed");
          return;
        }
        console.error("[work order] drawing the preview failed", caught);
        // Never drawn at all: the file is damaged where pdf-lib has to write,
        // and the same failure waits on the server. Said in words, and with
        // nothing to place boxes on — it used to say "Expected instance of
        // PDFDict, but got instance of PDFInvalidObject" under the page.
        if (!everDrawnRef.current) {
          setFailure({ message: DAMAGED_WORK_ORDER, final: true });
          setPhase("failed");
          return;
        }
        setPreviewError(
          "the work order's file is damaged where this box is, so it cannot be written on there. Put the box back, or onto another page.",
        );
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
  // wide gave every width a sideways scroll at 100%. Measured again when the
  // screen turns past the width where the steps begin: that is a new frame.
  React.useEffect(() => {
    const element = scrollerRef.current;
    if (!element) return;
    const measure = () => setFrame(Math.min(MAX_WIDTH, element.clientWidth));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [phase, steps]);

  // On a phone the page takes what the screen has left over the block under
  // it — most of it — and grows and shrinks with that block as a place is
  // opened for editing and closed again.
  React.useEffect(() => {
    if (!steps || phase !== "ready") return;
    const viewer = viewerRef.current;
    const scroller = scrollerRef.current;
    const current = currentRef.current;
    if (!viewer || !scroller || !current) return;
    const main = viewer.closest("main");
    const measure = () => {
      const top = Number.parseFloat(getComputedStyle(viewer).scrollMarginTop) || 12;
      const above = scroller.getBoundingClientRect().top - viewer.getBoundingClientRect().top;
      // Under the main column: room kept clear of the tab bar.
      const below = main ? Number.parseFloat(getComputedStyle(main).paddingBottom) || 0 : 0;
      const room = window.innerHeight - top - above - 12 - current.offsetHeight - below;
      setPreviewHeight(Math.max(MIN_PREVIEW, Math.round(room)));
    };
    measure();
    let width = window.innerWidth;
    const onResize = () => {
      // Only a real change of shape. A phone's browser grows and shrinks its
      // own bar as the page scrolls, and following that made the page jump
      // under a thumb.
      if (window.innerWidth === width) return;
      width = window.innerWidth;
      measure();
    };
    const observer = new ResizeObserver(measure);
    observer.observe(current);
    window.addEventListener("resize", onResize);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, [steps, phase]);

  const drawing =
    phase === "ready" && (drawnFor?.overlay !== overlay || drawnFor?.values !== values);
  /** Nothing is changed or applied while it is being saved, or once it is. */
  const locked = saving || done !== null;
  const canTick = !locked && !drawing && previewError === null;
  /** The place in front on a phone; none once all three are through. */
  const current: BoxKey | null = steps && step < ALL_DONE ? BOXES[step] : null;

  const view = scan?.pages[page]?.view ?? LETTER_VIEW;
  const pageWidth = view[2] - view[0];
  const pageHeight = view[3] - view[1];

  /**
   * As close as it can be while the whole box is still in view across: at a
   * fixed 200% the signature row was read a third at a time on a phone.
   */
  function fitZoom(box: WoRect, room = frame - 24): number {
    const boxView = scan?.pages[box.page]?.view ?? LETTER_VIEW;
    const fit = ZOOMS.filter(
      (level) => box.width * ((frame * level) / (boxView[2] - boxView[0])) <= room,
    );
    return fit.length > 0 ? Math.max(...fit) : ZOOMS[0];
  }

  const zoom = zoomChoice ?? (current && overlay ? fitZoom(overlay[current]) : 1);
  const cssWidth = Math.max(0, Math.floor(frame * zoom));
  const scale = pageWidth > 0 ? cssWidth / pageWidth : 1;

  /** The page for the place in front is on the screen, drawn at its size. */
  const pagePainted = painted === `${page}:${cssWidth}`;
  /** Next on a phone: the place in front drawn, in front long enough, not a parked guess. */
  const canNext = current !== null && canTick && !settling && pagePainted && !parked(current);
  const canApprove = canTick && !settling && pagePainted && BOXES.every((key) => checked[key]);

  // On a phone, once the page has its size: brought up under the top of the
  // screen, so it is the page that fills it rather than the title over it.
  React.useEffect(() => {
    // Turned to the wide layout and back, the page is brought up again.
    if (!steps) {
      placedRef.current = false;
      return;
    }
    if (phase !== "ready" || previewHeight === null || placedRef.current) return;
    placedRef.current = true;
    intoView(viewerRef.current);
  }, [steps, phase, previewHeight]);

  // A new step's heading takes the focus, so a screen reader says where it
  // is — and Enter pressed again does not go on to apply the next place
  // unheard. Without a scroll: on a phone that would move the page.
  React.useLayoutEffect(() => {
    if (!focusHeadingRef.current) return;
    focusHeadingRef.current = false;
    headingRef.current?.focus({ preventScroll: true });
  });

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
        // Upright as the file has it, never turned: the boxes are placed in
        // the page's own coordinates, and on a page saved turned a quarter
        // they were drawn across the wrong part of it.
        const base = rendered.getViewport({ scale: 1, rotation: 0 });
        const viewport = rendered.getViewport({ scale: cssWidth / base.width, rotation: 0 });
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
        setPainted(`${page}:${cssWidth}`);
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

  // After Show, or a step to the next place: the box in the middle of what
  // can be seen. Not before the frame has a width — centred on a page drawn
  // zero wide, the first place on a phone was left in the corner.
  React.useLayoutEffect(() => {
    const key = focusRef.current;
    const scroller = scrollerRef.current;
    if (!key || !overlay || !scroller || overlay[key].page !== page || cssWidth <= 0) return;
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
  // Changes. Any change to a box un-applies it: what was read is not there
  // now. None while saving: what was typed meanwhile used to be reported as
  // saved when the file held the version from before it.

  /**
   * A box kept whole on its page. Dragged past the edge it would be written
   * off the paper — and, off the canvas, there would be nothing left to grab
   * to bring it back.
   */
  function onPage<T extends WoOverlay[BoxKey]>(box: T): T {
    const [x0, y0, x1, y1] = scan?.pages[box.page]?.view ?? LETTER_VIEW;
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
    if (["x", "y", "width", "height", "page"].some((field) => field in next)) {
      setMoved((current) => ({ ...current, [key]: true }));
    }
  }

  function changeValue(key: keyof WoValues, value: string) {
    if (locked) return;
    setValues((current) => (current ? { ...current, [key]: value } : current));
    setTyped((current) => ({ ...current, [key]: true }));
    setChecked((current) => ({ ...current, [VALUE_BOX[key]]: false }));
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
  }

  /**
   * The times follow the layout — a date with them where WorkMarket printed
   * its own — unless somebody typed their own.
   */
  function timesFollow(times: WoFound["times"]) {
    const fresh = defaultValues(defaults, times);
    setValues((current) =>
      current
        ? {
            ...current,
            checkIn: typed.checkIn ? current.checkIn : fresh.checkIn,
            checkOut: typed.checkOut ? current.checkOut : fresh.checkOut,
          }
        : current,
    );
  }

  function findAgain() {
    if (!detected || locked) return;
    setOverlay(detected.overlay);
    setFound(detected.found);
    timesFollow(detected.found.times);
    setChecked({ times: false, notes: false, approval: false });
    setMoved({ times: false, notes: false, approval: false });
    setPage(detected.overlay.times.page);
  }

  /** One box back where it was found, and only that one: the phone's undo for a place. */
  function resetBox(key: BoxKey) {
    if (!detected || !found || locked) return;
    setOverlay((current) =>
      current
        ? {
            ...current,
            [key]: detected.overlay[key],
            covers: key === "times" ? detected.overlay.covers : current.covers,
          }
        : current,
    );
    setFound((current) =>
      current
        ? {
            ...current,
            ...(key === "times" ? { times: detected.found.times } : {}),
            ...(key === "notes" ? { notes: detected.found.notes } : {}),
            ...(key === "approval" ? { approval: detected.found.approval } : {}),
          }
        : current,
    );
    if (key === "times") timesFollow(detected.found.times);
    setChecked((current) => ({ ...current, [key]: false }));
    setMoved((current) => ({ ...current, [key]: false }));
    setPage(detected.overlay[key].page);
    setZoom(null);
    focusRef.current = key;
    setFocusTick((tick) => tick + 1);
  }

  function toggleCheck(key: BoxKey) {
    if (!canTick) return;
    setChecked((current) => ({ ...current, [key]: !current[key] }));
  }

  /**
   * Whether a place that was not found is still where it was parked. On a
   * phone Next waits for it to be moved: Next applies what is in front, and a
   * guess applied unmoved puts the customer's signature wherever the guess was.
   */
  function parked(key: BoxKey): boolean {
    if (!found) return false;
    const missing =
      key === "times" ? found.times === null : key === "notes" ? found.notes === null : !found.approval;
    return missing && !moved[key];
  }

  /**
   * WorkMarket's own times painted out, or left. The patches are found by
   * where WorkMarket prints its times, and where a work order is laid out
   * differently they can reach something that is not a time; off, nothing of
   * theirs is touched.
   */
  function choosePainting(on: boolean) {
    if (locked || !detected) return;
    setOverlay((current) =>
      current ? { ...current, covers: on ? detected.overlay.covers : [] } : current,
    );
    setChecked((current) => ({ ...current, times: false }));
  }

  /** The notes' line spacing, a tenth of a point at a time, for lines it could not measure. */
  function changePitch(delta: number) {
    if (!overlay) return;
    changeBox("notes", { pitch: Math.min(20, Math.max(6, round(overlay.notes.pitch + delta))) });
  }

  /**
   * Every page open to the boxes, or only the first copy's again.
   *
   * The way out when the copies were told apart wrongly. Wider, the places
   * that were not found are looked for across every page; what was found
   * stays where it is, moved or not. Narrower, a box left on a later page
   * goes back to where it was found on the first copy.
   */
  async function chooseEveryPage(on: boolean) {
    if (!overlay || !found || locked || widening) return;
    const names = (keys: BoxKey[]) =>
      keys.map((key) => BOX_SHORT[key]).join(keys.length === 2 ? " and " : ", ");
    if (on) {
      const pdfjs = pdfjsRef.current;
      const document = scanDocumentRef.current;
      if (!pdfjs || !document) return;
      setWidening(true);
      try {
        const { scanWorkOrder } = await import("@/lib/forms/wo-scan");
        const read = await scanWorkOrder(document, pdfjs.OPS, { everyPage: true });
        const layout = detectWoLayout(read, { everyPage: true });
        // What was found, or put in place by hand, stays where it is; the
        // rest is looked for again across every page.
        const keep = {
          times: found.times !== null || moved.times,
          notes: found.notes !== null || moved.notes,
          approval: found.approval || moved.approval,
        };
        const nextFound: WoFound = {
          times: keep.times ? found.times : layout.found.times,
          notes: keep.notes ? found.notes : layout.found.notes,
          approval: keep.approval ? found.approval : layout.found.approval,
          copies: found.copies,
        };
        const replaced = BOXES.filter(
          (key) => !keep[key] && !sameBox(overlay[key], layout.overlay[key]),
        );
        setScan(read);
        setDetected(layout);
        setOverlay({
          ...overlay,
          pages: layout.overlay.pages,
          times: keep.times ? overlay.times : layout.overlay.times,
          notes: keep.notes ? overlay.notes : layout.overlay.notes,
          approval: keep.approval ? overlay.approval : layout.overlay.approval,
          covers: keep.times ? overlay.covers : layout.overlay.covers,
        });
        setFound(nextFound);
        if (!keep.times) timesFollow(nextFound.times);
        setChecked((current) => ({
          times: !replaced.includes("times") && current.times,
          notes: !replaced.includes("notes") && current.notes,
          approval: !replaced.includes("approval") && current.approval,
        }));
        setEveryPage(true);
        setNotice(
          replaced.length > 0
            ? `${names(replaced)} found on the other pages — ${replaced.length === 1 ? "it needs" : "they need"} checking again.`
            : "Every page is open to the boxes now; nothing more was found on the other pages.",
        );
        if (steps && current) {
          setZoom(null);
          setPage((current === "times" ? (keep.times ? overlay.times : layout.overlay.times) : current === "notes" ? (keep.notes ? overlay.notes : layout.overlay.notes) : keep.approval ? overlay.approval : layout.overlay.approval).page);
          focusRef.current = current;
          setFocusTick((tick) => tick + 1);
        }
      } catch (caught) {
        console.error("[work order] reading every page failed", caught);
        setError("The other pages could not be read. Try again, or put the boxes on the first copy.");
      } finally {
        setWidening(false);
      }
      return;
    }

    const first = firstCopy;
    if (!first) return;
    const inFirst = (box: WoRect) => first.overlay.pages.includes(box.page);
    const back = {
      times: !inFirst(overlay.times),
      notes: !inFirst(overlay.notes),
      approval: !inFirst(overlay.approval),
    };
    const returned = BOXES.filter((key) => back[key]);
    const nextOverlay: WoOverlay = {
      ...overlay,
      pages: first.overlay.pages,
      times: back.times ? first.overlay.times : overlay.times,
      notes: back.notes ? first.overlay.notes : overlay.notes,
      approval: back.approval ? first.overlay.approval : overlay.approval,
      covers: back.times ? first.overlay.covers : overlay.covers.filter(inFirst),
    };
    setDetected(first);
    setOverlay(nextOverlay);
    setFound({
      times: back.times ? first.found.times : found.times,
      notes: back.notes ? first.found.notes : found.notes,
      approval: back.approval ? first.found.approval : found.approval,
      copies: found.copies,
    });
    if (back.times) timesFollow(first.found.times);
    setChecked((current) => ({
      times: !back.times && current.times,
      notes: !back.notes && current.notes,
      approval: !back.approval && current.approval,
    }));
    setMoved((current) => ({
      times: !back.times && current.times,
      notes: !back.notes && current.notes,
      approval: !back.approval && current.approval,
    }));
    setEveryPage(false);
    setNotice(
      returned.length > 0
        ? `${names(returned)} ${returned.length === 1 ? "was" : "were"} on later pages, so ${returned.length === 1 ? "it is" : "they are"} back where ${returned.length === 1 ? "it was" : "they were"} found on the first copy — check ${returned.length === 1 ? "it" : "them"} again.`
        : "Back to the first copy only.",
    );
    if (steps && current) {
      setZoom(null);
      setPage(nextOverlay[current].page);
      focusRef.current = current;
      setFocusTick((tick) => tick + 1);
    } else if (!first.overlay.pages.includes(page)) {
      setPage(first.overlay.pages[0] ?? 0);
    }
  }

  /** The computer's Show: the page turned to the box, zoomed to it, and brought into view. */
  function show(key: BoxKey) {
    if (!overlay || !scan) return;
    const box = overlay[key];
    setSelected(key);
    setPage(box.page);
    setZoom(fitZoom(box, (scrollerRef.current?.clientWidth ?? frame) - 24));
    focusRef.current = key;
    setFocusTick((tick) => tick + 1);
    intoView(viewerRef.current);
  }

  /** The phone's Show, and every step: the place in front, as close as it fits. */
  function focusOn(key: BoxKey | null) {
    if (!overlay) return;
    setZoom(null);
    if (key) {
      setPage(overlay[key].page);
      focusRef.current = key;
      setFocusTick((tick) => tick + 1);
    } else {
      // All three through: the page with the signature on it, whole.
      setPage(overlay.approval.page);
      scrollerRef.current?.scrollTo({ left: 0, top: 0 });
    }
  }

  function goTo(target: number) {
    setEditing(false);
    dragRef.current = null;
    setStep(target);
    // What went wrong on another place is not this one's to say.
    setError(null);
    setNotice(null);
    focusOn(target < ALL_DONE ? BOXES[target] : null);
    focusHeadingRef.current = true;
    setSettling(true);
    if (settleRef.current !== null) window.clearTimeout(settleRef.current);
    settleRef.current = window.setTimeout(() => {
      settleRef.current = null;
      setSettling(false);
    }, SETTLE_MS);
  }

  /** Applies the place in front and moves on to the next. */
  function next() {
    if (!current || !canNext) return;
    setChecked((state) => ({ ...state, [current]: true }));
    goTo(step + 1);
  }

  function back() {
    if (step === 0 || locked) return;
    goTo(step - 1);
  }

  /** A box onto another page, and the page turned to follow it. */
  function moveToPage(key: BoxKey, target: number) {
    changeBox(key, { page: target });
    setPage(target);
    if (steps) {
      focusRef.current = key;
      setFocusTick((tick) => tick + 1);
    }
  }

  function nudge(key: BoxKey, dx: number, dy: number) {
    if (!overlay) return;
    const box = overlay[key];
    changeBox(key, { x: round(box.x + dx), y: round(box.y + dy) });
  }

  /** Stretched from the corner: the top-left stays where it is. */
  function stretch(key: BoxKey, box: WoOverlay[BoxKey], dWidth: number, dHeight: number) {
    // And the box stops at the page's edge rather than pushing its top up.
    const boxView = scan?.pages[box.page]?.view ?? LETTER_VIEW;
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

  /** Whether a box can be taken hold of: always on a computer, on a phone only the one being edited. */
  const movable = (key: BoxKey) => !locked && (!steps || (editing && key === current));

  function onPointerDown(event: React.PointerEvent, key: BoxKey, mode: Drag["mode"]) {
    if (!overlay || !movable(key)) return;
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    if (!steps) setSelected(key);
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
    // Edit closed under a finger still down: the drag ends there, rather than
    // the box going on following it.
    if (!movable(drag.key)) {
      dragRef.current = null;
      return;
    }
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
      if (!steps) setSelected(null);
      (event.currentTarget as HTMLElement).blur();
      return;
    }
    const distance = event.shiftKey ? 10 : 1;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-distance, 0],
      ArrowRight: [distance, 0],
      ArrowUp: [0, distance],
      ArrowDown: [0, -distance],
    };
    const move = moves[event.key];
    if (!move || !overlay || !movable(key)) return;
    event.preventDefault();
    // With Alt, the arrows stretch rather than move: the dot on the corner
    // has to be reachable without a pointer too.
    if (event.altKey) stretch(key, overlay[key], move[0], -move[1]);
    else nudge(key, move[0], move[1]);
  }

  function save() {
    if (!overlay || !values || !found || !scan || locked) return;
    setError(null);
    startSaving(async () => {
      const formData = new FormData();
      formData.set(
        "payload",
        JSON.stringify({
          jobId,
          workOrderId: workOrder.id,
          pageCount: scan.pages.length,
          overlay,
          values,
          typed,
          found,
        }),
      );
      // A request that never gets an answer rejects rather than returning a
      // result. Uncaught, it took the whole screen with it — Next's error
      // page in place of the boxes and everything typed.
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
      setDone({ id: result.id, name: result.name });
      // Straight back to the job, which says it was saved and what to know
      // about it: the owner's flow. Replaced rather than pushed, so Back from
      // the job goes where it went before this screen, not into it again.
      const notes = [
        result.signature === "none" ? "unsigned" : result.signature === "unreadable" ? "unreadable" : null,
        result.notesCut ? "notes-cut" : null,
        result.cut.length > 0 ? "cut" : null,
      ].filter(Boolean);
      router.replace(
        `/jobs/${jobId}?signed=${encodeURIComponent(result.id)}${notes.length > 0 ? `&note=${notes.join(",")}` : ""}`,
      );
    });
  }

  // -------------------------------------------------------------------------

  if (phase === "failed") {
    return (
      <div role="alert" className="flex flex-col gap-3 rounded-xl border border-border p-4 text-sm">
        <p className="text-danger">This work order could not be read here.</p>
        {failure ? <p className="text-muted-foreground">{failure.message}</p> : null}
        <div className="flex flex-wrap gap-2">
          {/* A damaged or locked file is the same file the second time. */}
          {failure && !failure.final ? (
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

  if (phase === "loading" || !overlay || !values || !found || !scan || !detected) {
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
  const firstCopyPages = firstCopy?.overlay.pages.length ?? overlay.pages.length;
  const allPages = overlay.pages.length === scan.pages.length;
  const pageIndex = overlay.pages.indexOf(page);
  const step10 = coarse ? 10 : 1;
  const points = coarse ? "10 points" : "a point";

  // -------------------------------------------------------------------------
  // What each place says about itself, and what it is edited with. The same
  // on both screens.

  /** What prints where somebody typed a letter the work order's font has not got. */
  function lettersNote(single: boolean, ...texts: string[]): Note | null {
    const changed = lettersPrintedDifferently(texts.join(" "));
    if (changed.length === 0) return null;
    const missing = changed.slice(0, 6).map(({ from }) => from).join(" ");
    const more = changed.length > 6 ? " and others" : "";
    if (single) {
      const printed = texts.map((text) => toWinAnsi(text).replace(/\s+/g, " ").trim()).join(" · ");
      return {
        text: `Prints as “${printed}”: the work order's font has no ${missing}${more}.`,
        warn: true,
      };
    }
    const pairs = changed
      .slice(0, 4)
      .map(({ from, to }) => `${from} as ${to || "nothing"}`)
      .join(", ");
    return {
      text: `The work order's font has no ${missing}${more}; they print as the nearest it has (${pairs}).`,
      warn: true,
    };
  }

  const cutNote = (cut: boolean): Note | null =>
    cut
      ? {
          text: "Too long for its line even at the smallest size, so it is cut short and ends “...”. Shorten it here to keep it whole.",
          warn: true,
        }
      : null;

  function notFound(key: BoxKey, where: string): Note {
    if (steps) {
      return parked(key)
        ? {
            text: `Not found on this work order. The box is parked ${where}: press Edit and move it ${BOX_PLACE[key]}. Next waits until it has been moved.`,
            warn: true,
          }
        : { text: "Not found on this work order; put in place by hand.", warn: true };
    }
    return {
      text: `Not found on this work order. The box is parked ${where} — drag it ${BOX_PLACE[key]}.`,
      warn: true,
    };
  }

  /**
   * `brief`: the phone's wording. The page above it already shows what the
   * longer sentences explain, and on a short phone every line of them came off
   * the page.
   */
  function notesFor(key: BoxKey, brief = false): Note[] {
    if (!overlay || !values || !found) return [];
    const list: (Note | null)[] =
      key === "times"
        ? [
            found.times === "lines"
              ? {
                  text: brief
                    ? "On the blank Arrival and Departure lines."
                    : "Written on the blank Arrival time and Departure time lines.",
                }
              : found.times === "printed"
                ? overlay.covers.length > 0
                  ? {
                      text: brief
                        ? "WorkMarket's own times are painted over (outlined in red) and these written instead."
                        : "WorkMarket printed its own check-in and check-out here. They are painted over — outlined in red on the page — and these written in their place.",
                    }
                  : {
                      text: "WorkMarket printed its own check-in and check-out here. They are left as printed, and these written beside them.",
                      warn: true,
                    }
                : notFound("times", `at the top right of page ${overlay.times.page + 1}`),
            !defaults.checkIn || !defaults.checkOut
              ? { text: "This job has no complete check-in and check-out to give.", warn: true }
              : null,
            cutNote(Boolean(drawn?.cut.includes("checkIn") || drawn?.cut.includes("checkOut"))),
            lettersNote(true, values.checkIn, values.checkOut),
          ]
        : key === "notes"
          ? [
              found.notes === "lines"
                ? {
                    text: `On the ${notesLines} ruled lines under Notes${overlay.notes.page > 0 ? `, on page ${overlay.notes.page + 1}` : ""}.`,
                  }
                : found.notes === "heading"
                  ? { text: "Found the Notes heading but no lines; the box sits under it." }
                  : notFound("notes", `low on page ${overlay.notes.page + 1}`),
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
              lettersNote(false, values.notes),
            ]
          : [
              found.approval
                ? {
                    text: brief
                      ? "On the Customer Name, Signature and Date line."
                      : "On the Customer Name, Customer Signature and Date line.",
                  }
                : notFound(
                    "approval",
                    `low on the last page${allPages ? "" : " of the first copy"}`,
                  ),
              signatureState === "none"
                ? {
                    text: "No customer signature was captured on this job, so that part of the line stays empty.",
                    warn: true,
                  }
                : signatureState === "unreadable"
                  ? {
                      text: "The signature captured on this job could not be read, so that part of the line stays empty.",
                      warn: true,
                    }
                  : drawn && !drawn.signed
                    ? { text: "The signature on this job could not be drawn.", warn: true }
                    : brief
                      ? null
                      : { text: "The customer's signature from the checkout goes on the line." },
              cutNote(Boolean(drawn?.cut.includes("name") || drawn?.cut.includes("date"))),
              lettersNote(true, values.name),
            ];
    return list.filter((note): note is Note => note !== null);
  }

  function fieldsFor(key: BoxKey): React.ReactNode {
    if (!overlay || !values || !detected) return null;
    if (key === "times") {
      return (
        <>
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
          {detected.overlay.covers.length > 0 || overlay.covers.length > 0 ? (
            <label className="flex min-h-11 items-center gap-3 text-sm">
              <input
                type="checkbox"
                checked={overlay.covers.length > 0}
                disabled={locked}
                onChange={(event) => choosePainting(event.target.checked)}
                className="size-5 accent-[var(--color-primary)]"
              />
              Paint over WorkMarket&rsquo;s own times
            </label>
          ) : null}
        </>
      );
    }
    if (key === "notes") {
      return (
        <>
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
          {/* Where the lines could not be measured — drawn as a picture, or
              not drawn at all — the spacing is a guess, and a guess eleven
              points apart drifted off ruled lines ten and three quarters
              apart by the fifth line. */}
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Line spacing</span>
            <Button
              type="button"
              size="icon"
              variant="secondary"
              aria-label="Lines closer together"
              disabled={locked || overlay.notes.pitch <= 6}
              onClick={() => changePitch(-0.1)}
            >
              <Minus />
            </Button>
            <span className="tabular w-16 text-center">{overlay.notes.pitch.toFixed(1)} pt</span>
            <Button
              type="button"
              size="icon"
              variant="secondary"
              aria-label="Lines further apart"
              disabled={locked || overlay.notes.pitch >= 20}
              onClick={() => changePitch(0.1)}
            >
              <Plus />
            </Button>
          </div>
        </>
      );
    }
    return (
      <>
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
      </>
    );
  }

  function nudgeBar(key: BoxKey): React.ReactNode {
    if (!overlay) return null;
    const box = overlay[key];
    return (
      <div
        role="group"
        aria-label={`Move the ${BOX_NAME[key].toLowerCase()} box`}
        className="flex flex-wrap items-center gap-2 rounded-xl border border-border p-2"
      >
        <span className="text-sm font-medium">{BOX_SHORT[key]}</span>
        <div className="flex items-center gap-1">
          <Button type="button" size="icon" variant="secondary" aria-label={`Left ${points}`} disabled={locked} onClick={() => nudge(key, -step10, 0)}>
            <ArrowLeft />
          </Button>
          <Button type="button" size="icon" variant="secondary" aria-label={`Up ${points}`} disabled={locked} onClick={() => nudge(key, 0, step10)}>
            <ArrowUp />
          </Button>
          <Button type="button" size="icon" variant="secondary" aria-label={`Down ${points}`} disabled={locked} onClick={() => nudge(key, 0, -step10)}>
            <ArrowDown />
          </Button>
          <Button type="button" size="icon" variant="secondary" aria-label={`Right ${points}`} disabled={locked} onClick={() => nudge(key, step10, 0)}>
            <ArrowRight />
          </Button>
        </div>
        {/* A point a tap is right for the last nudge and slow for the first;
            ten at a time gets a parked box across the page. */}
        <Button
          type="button"
          variant={coarse ? "primary" : "secondary"}
          aria-pressed={coarse}
          onClick={() => setCoarse((state) => !state)}
        >
          ×10
        </Button>
        {overlay.pages.length > 1 ? (
          <label className="ml-auto flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">On page</span>
            <select
              value={box.page}
              disabled={locked}
              onChange={(event) => moveToPage(key, Number(event.target.value))}
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
    );
  }

  /** Only where the copies were told apart, or every page was chosen. */
  const pagesChoice =
    overlay.pages.length < scan.pages.length || everyPage ? (
      <ResetLink disabled={locked || widening} onClick={() => void chooseEveryPage(!everyPage)}>
        {widening
          ? "Reading every page…"
          : everyPage
            ? `Back to the first copy only (${pagesLabel(firstCopyPages)})`
            : `Use every page, not only the first copy (${pagesLabel(overlay.pages.length)} of ${scan.pages.length})`}
      </ResetLink>
    ) : null;

  // -------------------------------------------------------------------------
  // The page, with the boxes on it.

  const covers = overlay.covers.filter(
    (cover) => cover.page === page && (!steps || current === "times" || step === ALL_DONE),
  );

  const pageContent = (
    <div
      className="relative"
      style={{ width: cssWidth, height: Math.round(pageHeight * scale) }}
      // A tap on the page, not on a box, puts the box down: there was no way
      // to see the values without its outline over them.
      onClick={(event) => {
        if (!steps && (event.target === event.currentTarget || event.target === canvasRef.current)) {
          setSelected(null);
        }
      }}
    >
      <canvas
        ref={canvasRef}
        className="block"
        aria-label={`Page ${page + 1} of the work order, as it will be saved`}
      />

      {covers.map((cover, index) => (
        <div
          key={`cover-${index}`}
          aria-hidden
          className="pointer-events-none absolute outline-1 outline-dashed outline-danger/80"
          style={{
            left: (cover.x - view[0]) * scale,
            top: (view[3] - (cover.y + cover.height)) * scale,
            width: Math.max(4, cover.width * scale),
            height: Math.max(4, cover.height * scale),
          }}
        />
      ))}

      {BOXES.filter((key) => overlay[key].page === page).map((key) => {
        const box = overlay[key];
        const canMove = movable(key);
        // On a phone the place in front is the one marked; the rest are faint
        // until all three are through.
        const active = steps ? key === current : selected === key;
        const faint = steps && step < ALL_DONE && key !== current;
        return (
          <div
            key={key}
            role={canMove ? "button" : undefined}
            tabIndex={canMove ? 0 : undefined}
            aria-label={
              canMove
                ? `${BOX_NAME[key]} box. Drag it, or use the arrow keys, to move it; Alt with the arrows stretches it.`
                : undefined
            }
            aria-hidden={canMove ? undefined : true}
            aria-pressed={canMove && !steps ? active : undefined}
            data-box={key}
            onPointerDown={(event) => onPointerDown(event, key, "move")}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onKeyDown={(event) => onBoxKey(event, key)}
            onFocus={() => {
              if (!steps) setSelected(key);
            }}
            // Drawn just outside the box, never over it: the 2 px edge used
            // to sit on the first digit of the time it framed.
            className={cn(
              "absolute select-none rounded-[2px] outline-offset-2 [-webkit-touch-callout:none]",
              // Out of the way of a thumb panning the page, unless it is the
              // box being edited.
              canMove ? "cursor-move touch-none" : "pointer-events-none",
              faint
                ? "outline-1 outline-dashed outline-muted-foreground/40"
                : active && (!steps || editing)
                  ? "bg-[var(--color-primary)]/10 outline-2 outline-solid outline-[var(--color-primary)]"
                  : checked[key]
                    ? "outline-2 outline-dashed outline-success/70"
                    : "outline-2 outline-dashed outline-[var(--color-primary)]/70",
            )}
            style={{
              left: (box.x - view[0]) * scale,
              top: (view[3] - (box.y + box.height)) * scale,
              width: Math.max(12, box.width * scale),
              height: Math.max(10, box.height * scale),
            }}
          >
            {faint ? null : (
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
            )}
            {canMove && active ? (
              // A 44 px place to press, with the dot it holds sitting outside
              // the corner: inside, it covered the "PM" of the check-out the
              // owner asked to have written out.
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
  );

  const previewStatus = drawing ? (
    <>
      <Loader2 className="size-3 animate-spin" aria-hidden /> Drawing it…
    </>
  ) : previewError ? (
    <span role="alert" className="text-danger">
      The preview could not be drawn: {previewError}
    </span>
  ) : null;

  const savedStatus = done ? (
    <div role="status" className="flex flex-col gap-2 text-sm">
      <p className="flex items-center gap-2 font-medium text-success">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        Saved as {done.name}. Going back to the job…
      </p>
      <Link
        href={`/jobs/${jobId}`}
        className="inline-flex min-h-11 w-fit items-center rounded-lg border border-border px-3 hover:bg-muted"
      >
        Back to the job
      </Link>
    </div>
  ) : null;

  // -------------------------------------------------------------------------
  // A phone: one place at a time.

  if (steps) {
    const notes = current ? notesFor(current, true) : [];
    const unchecked = BOXES.findIndex((key) => !checked[key]);
    // Kept above the tab bar however long the block above it grows: on a short
    // phone the row sat under the bar, and Next took a scroll to reach.
    const actionRow =
      "sticky bottom-[calc(env(safe-area-inset-bottom)+3.75rem)] z-10 -mx-3 -mb-3 mt-auto rounded-b-xl border-t border-border bg-surface px-3 pb-3 pt-2 md:bottom-3";
    return (
      // No double-tap zoom: two quick taps are two presses here, and the guard
      // on Next is for those, not for a browser zooming the page.
      <div className="flex touch-manipulation flex-col gap-3">
        <div
          ref={viewerRef}
          className="flex min-w-0 scroll-mt-[calc(env(safe-area-inset-top)+0.75rem)] flex-col gap-2"
        >
          <div className="flex items-center gap-1">
            {overlay.pages.length > 1 ? (
              <div role="group" aria-label="Page" className="flex items-center">
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label="Previous page"
                  disabled={pageIndex <= 0}
                  onClick={() => setPage(overlay.pages[pageIndex - 1])}
                >
                  <ChevronLeft />
                </Button>
                <span className="tabular min-w-11 text-center text-sm text-muted-foreground" aria-live="polite">
                  <span className="sr-only">Page </span>
                  {page + 1}
                  <span aria-hidden> / </span>
                  <span className="sr-only"> of </span>
                  {overlay.pages.length}
                </span>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label="Next page"
                  disabled={pageIndex < 0 || pageIndex >= overlay.pages.length - 1}
                  onClick={() => setPage(overlay.pages[pageIndex + 1])}
                >
                  <ChevronRight />
                </Button>
              </div>
            ) : null}
            <div className="ml-auto flex items-center gap-1">
              <Button
                type="button"
                size="icon"
                variant="secondary"
                aria-label={`Zoom out, now ${Math.round(zoom * 100)}%`}
                disabled={zoomIndex <= 0}
                onClick={() => setZoom(ZOOMS[Math.max(0, zoomIndex - 1)])}
              >
                <Minus />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="secondary"
                aria-label={`Zoom in, now ${Math.round(zoom * 100)}%`}
                disabled={zoomIndex >= ZOOMS.length - 1}
                onClick={() => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, zoomIndex + 1)])}
              >
                <Plus />
              </Button>
              {current ? (
                // Its word goes under 360 px, the mark stays: with the pages
                // and the zoom beside it, the row ran 15 px past a 320 px
                // screen.
                <Button
                  type="button"
                  variant="secondary"
                  className="px-3 max-[359px]:w-11 max-[359px]:px-0"
                  onClick={() => focusOn(current)}
                >
                  <Crosshair /> <span className="max-[359px]:sr-only">Show</span>
                </Button>
              ) : null}
            </div>
          </div>

          <div className="relative">
            <div
              ref={scrollerRef}
              role="region"
              aria-label="The work order page"
              tabIndex={0}
              className="relative overflow-auto overscroll-contain rounded-xl border border-border bg-white [scrollbar-gutter:stable]"
              style={{ height: previewHeight ?? "55dvh" }}
            >
              {pageContent}
            </div>
            {previewStatus ? (
              <p className="pointer-events-none absolute left-2 top-2 flex items-center gap-2 rounded-md bg-surface-raised/95 px-2 py-1 text-xs text-muted-foreground shadow-sm">
                {previewStatus}
              </p>
            ) : null}
          </div>
        </div>

        <section
          ref={currentRef}
          aria-label={current ? `Current: ${BOX_NAME[current]}` : "Approve"}
          className="@container flex flex-col gap-2 rounded-xl border border-border bg-surface p-3"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span id="wo-step" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {current
                ? `Current · ${step + 1} of ${BOXES.length}`
                : unchecked < 0
                  ? "All three checked"
                  : `${BOXES.filter((key) => !checked[key]).length} still to check`}
            </span>
            <StepDots step={step} checked={checked} />
          </div>

          {savedStatus ? (
            savedStatus
          ) : current ? (
            <>
              <h2
                ref={headingRef}
                tabIndex={-1}
                aria-describedby="wo-step"
                className="text-base font-semibold outline-none"
              >
                {BOX_NAME[current]}
              </h2>
              {notice ? (
                <p role="status" className="text-sm text-warning">
                  {notice}
                </p>
              ) : null}
              {/* While editing, only what needs doing: the rest was read
                  before Edit was pressed, and on a phone every line of it
                  came off the page above. */}
              <ul className="flex flex-col gap-1 text-sm">
                {notes
                  .filter((note) => !editing || note.warn)
                  .map((note) => (
                    <li key={note.text} className={note.warn ? "text-warning" : "text-muted-foreground"}>
                      {note.text}
                    </li>
                  ))}
              </ul>
              {editing ? (
                // The arrows first, next to the page they move the box on;
                // the rest scrolls inside the block, so the page above and
                // the buttons below both stay on the screen.
                <div className="-mx-1 flex max-h-[34dvh] flex-col gap-3 overflow-y-auto overscroll-contain px-1">
                  {nudgeBar(current)}
                  <p className="text-xs text-muted-foreground">
                    Or drag the box on the page; the dot on its corner stretches it.
                  </p>
                  {fieldsFor(current)}
                  {pagesChoice}
                  <ResetLink disabled={locked} onClick={() => resetBox(current)}>
                    Put the box back where it was found
                  </ResetLink>
                </div>
              ) : (
                <Summary
                  item={current}
                  values={values}
                  signature={
                    signatureState === "read"
                      ? "From the checkout"
                      : signatureState === "unreadable"
                        ? "Could not be read"
                        : "None captured"
                  }
                />
              )}
              {error ? (
                <p role="alert" className="text-sm text-danger">
                  {error}
                </p>
              ) : null}
              <div className={cn("grid grid-cols-3 gap-2", actionRow)}>
                <Button
                  type="button"
                  variant="secondary"
                  className="px-2"
                  disabled={step === 0 || locked}
                  onClick={back}
                >
                  <ArrowLeft /> Back
                </Button>
                {/* Done, not Apply: here it only puts the editing away, and
                    Apply on a computer means the place is checked — the
                    same word for two things. Next is what applies. */}
                <Button
                  type="button"
                  variant="secondary"
                  className="px-2"
                  disabled={locked}
                  aria-expanded={editing}
                  onClick={() => {
                    dragRef.current = null;
                    setEditing((state) => !state);
                  }}
                >
                  {editing ? (
                    <>
                      <Check /> Done
                    </>
                  ) : (
                    <>
                      <Pencil /> Edit
                    </>
                  )}
                </Button>
                <Button type="button" className="px-2" disabled={!canNext} onClick={next}>
                  Next <ArrowRight />
                </Button>
              </div>
            </>
          ) : (
            <>
              <h2
                ref={headingRef}
                tabIndex={-1}
                aria-describedby="wo-step"
                className="text-base font-semibold outline-none"
              >
                {unchecked < 0 ? "Ready to approve" : "Not ready yet"}
              </h2>
              {notice ? (
                <p role="status" className="text-sm text-warning">
                  {notice}
                </p>
              ) : null}
              <p className="text-sm text-muted-foreground">
                Saved with the work orders as{" "}
                <strong className="text-foreground [overflow-wrap:anywhere]">{signedName}</strong>.{" "}
                <span className="[overflow-wrap:anywhere]">
                  {workOrder.name} stays on the job as it is; only its first copy is signed.
                </span>
                {signedCopy ? " The signed copy already on the job is replaced." : null}
              </p>
              {unchecked >= 0 ? (
                // Taken straight to it, rather than told to find it by Back:
                // reading every page late on can send an earlier place back.
                <Button type="button" variant="secondary" disabled={locked} onClick={() => goTo(unchecked)}>
                  Check {BOX_SHORT[BOXES[unchecked]].toLowerCase()} again
                </Button>
              ) : null}
              {error ? (
                <p role="alert" className="text-sm text-danger">
                  {error}
                </p>
              ) : null}
              <div className={cn("grid grid-cols-[auto_1fr] gap-2", actionRow)}>
                <Button type="button" variant="secondary" className="px-3" disabled={locked} onClick={back}>
                  <ArrowLeft /> Back
                </Button>
                <Button
                  type="button"
                  size="lg"
                  disabled={!canApprove}
                  onClick={() => {
                    if (canApprove) save();
                  }}
                >
                  {saving ? <Loader2 className="animate-spin" /> : <Check />}
                  Approve
                </Button>
              </div>
            </>
          )}
        </section>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // A computer: the page, and the three beside it.

  // The move buttons are for a box that can be seen. On another page they
  // moved it out of sight and un-applied it.
  const selectedBox = selected && overlay[selected].page === page ? overlay[selected] : null;

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      {/* The page. Scrolled to with room above it for an iPhone's status bar
          when the app is opened from the home screen. */}
      <div
        ref={viewerRef}
        // At most 640 px, and never so wide that the three beside it lose their
        // room: at 1024 px they were left 80 px and the page scrolled sideways.
        className="flex min-w-0 scroll-mt-[calc(env(safe-area-inset-top)+0.75rem)] flex-col gap-2 lg:sticky lg:top-4 lg:w-[min(640px,calc(100%_-_24rem))] lg:shrink-0"
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
            role="region"
            aria-label="The work order page"
            tabIndex={0}
            className="relative max-h-[75vh] overflow-auto rounded-xl border border-border bg-white [scrollbar-gutter:stable]"
          >
            {pageContent}
          </div>
        </div>

        <p className="flex min-h-5 items-center gap-2 text-xs text-muted-foreground">
          {previewStatus ??
            "This is the page as it will be saved. Drag a box to move it; the dot on its corner stretches it. Tap the page to put it down."}
        </p>

        {selected && selectedBox ? nudgeBar(selected) : null}
      </div>

      {/* What goes where, and the three Apply buttons. Its fields go side by
          side by the width of this column, not of the screen: beside the page
          on a desktop it is narrower than a phone held sideways, and a time
          in a half-width field read "11-16-2026 9:06 A". */}
      <div className="@container flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={ticked === 3 ? "success" : "neutral"}>
            {ticked === 3 ? "All three applied" : `${3 - ticked} of 3 left to apply`}
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
        {pagesChoice}
        {notice ? (
          <p role="status" className="text-sm text-warning">
            {notice}
          </p>
        ) : null}

        {BOXES.map((key) => (
          <Section
            key={key}
            box={key}
            applied={checked[key]}
            canApply={canTick}
            onShow={() => show(key)}
            onApply={() => toggleCheck(key)}
            notes={notesFor(key)}
          >
            {fieldsFor(key)}
          </Section>
        ))}

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
          {savedStatus ?? (
            <>
              <Button
                type="button"
                block
                disabled={ticked < 3 || !canTick}
                onClick={save}
              >
                {saving ? <Loader2 className="animate-spin" /> : <Check />}
                {signedCopy ? "Replace the signed work order" : "Save the signed work order"}
              </Button>
              {ticked < 3 ? (
                <p className="text-xs text-muted-foreground">
                  Look at each of the three on the page and press Apply on it first.
                </p>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Where the phone's steps have got to: applied, in front, still to come. */
function StepDots({ step, checked }: { step: number; checked: Record<BoxKey, boolean> }) {
  return (
    <ol className="ml-auto flex items-center gap-1" aria-label="The three places">
      {BOXES.map((key, index) => {
        const state = checked[key] ? "applied" : index === step ? "in front" : "to come";
        return (
          <li
            key={key}
            className={cn(
              "flex h-6 items-center gap-1 rounded-full px-2 text-[0.6875rem] font-medium",
              checked[key]
                ? "bg-success/15 text-success"
                : index === step
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground",
            )}
          >
            {checked[key] ? <Check className="size-3" aria-hidden /> : null}
            {BOX_SHORT[key]}
            <span className="sr-only">: {state}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** The place in front as it reads, before Edit: what is written, not where. */
function Summary({
  item,
  values,
  signature,
}: {
  item: BoxKey;
  values: WoValues;
  signature: string;
}) {
  const nothing = <span className="text-muted-foreground">Nothing</span>;
  if (item === "notes") {
    return (
      <p className="line-clamp-3 whitespace-pre-line text-sm [overflow-wrap:anywhere]">
        {values.notes.trim() || nothing}
      </p>
    );
  }
  const rows: [string, React.ReactNode][] =
    item === "times"
      ? [
          ["Check-in", values.checkIn || nothing],
          ["Check-out", values.checkOut || nothing],
        ]
      : [
          ["Name", values.name || nothing],
          ["Date", values.date || nothing],
          ["Signature", signature],
        ];
  return (
    <dl className="flex flex-col gap-1 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="flex gap-3">
          <dt className="w-20 shrink-0 text-muted-foreground">{label}</dt>
          <dd className="min-w-0 [overflow-wrap:anywhere]">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Section({
  box,
  applied,
  canApply,
  onShow,
  onApply,
  notes,
  children,
}: {
  box: BoxKey;
  applied: boolean;
  /** Not while the page is being redrawn or saved: applying is for what was seen. */
  canApply: boolean;
  onShow: () => void;
  onApply: () => void;
  notes: Note[];
  children: React.ReactNode;
}) {
  return (
    <section
      aria-label={BOX_NAME[box]}
      className={cn(
        "flex flex-col gap-3 rounded-xl border p-3 transition-colors",
        applied ? "border-success/60 bg-success/5" : "border-border",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">{BOX_NAME[box]}</h2>
        {applied ? <Badge variant="success">Applied</Badge> : null}
      </div>
      <ul className="flex flex-col gap-1 text-sm">
        {notes.map((note) => (
          <li key={note.text} className={note.warn ? "text-warning" : "text-muted-foreground"}>
            {note.text}
          </li>
        ))}
      </ul>
      {children}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" onClick={onShow}>
          <Crosshair /> Show
        </Button>
        {/* The label says what pressing it does; it is not also a pressed
            toggle, which read the same change out twice. */}
        <Button
          type="button"
          variant={applied ? "ghost" : "primary"}
          disabled={!canApply}
          onClick={onApply}
        >
          {applied ? (
            <>
              <Undo2 /> Applied — undo
            </>
          ) : (
            <>
              <Check /> Apply
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
