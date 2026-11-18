import {
  pagesToRead,
  type WoDetectOptions,
  type WoRule,
  type WoScan,
  type WoScanPage,
  type WoTextItem,
} from "@/lib/forms/wo-layout";

/**
 * Reads a work order the way wo-layout.ts needs it: every run of text with
 * where it sits, and every thin horizontal line.
 *
 * The lines matter as much as the words. A notes box is ten ruled lines and
 * nothing else, and writing on those lines rather than at some fixed spacing
 * of our own is the difference between a note that looks written on the form
 * and one that looks pasted over it.
 *
 * pdf.js is handed in rather than imported. The screen loads its browser
 * build on demand, and the suites load the Node one; this file is the same
 * for both and pulls neither into a bundle that does not want it.
 */

/** The few operator codes this reads, from the pdf.js build in use. */
export type PdfjsOps = {
  save: number;
  restore: number;
  transform: number;
  constructPath: number;
  endPath: number;
  paintFormXObjectBegin: number;
  paintFormXObjectEnd: number;
};

type PdfjsTextItem = { str?: string; transform?: number[]; width?: number; height?: number };

export type PdfjsPageLike = {
  view: number[];
  getTextContent(): Promise<{ items: unknown[] }>;
  getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[] }>;
};

export type PdfjsDocumentLike = {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfjsPageLike>;
};

type Matrix = [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function multiply(m: Matrix, n: number[]): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

function apply(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** A box in the coordinates a path was built in: x0, y0, x1, y1. */
type Box = [number, number, number, number];

/**
 * A path's pieces, one box each.
 *
 * pdf.js builds a path as one flat list — an operation, then its points: 0
 * moves (x y), 1 draws a line (x y), 2 a curve (three points), 3 a quadratic
 * curve (two), 4 closes. Its own numbering, not exported, so written out here.
 * A move starts a new piece.
 */
function piecesOf(path: ArrayLike<number>): Box[] | null {
  const boxes: Box[] = [];
  let box: Box | null = null;
  const add = (x: number, y: number) => {
    if (!box) {
      box = [x, y, x, y];
      return;
    }
    box[0] = Math.min(box[0], x);
    box[1] = Math.min(box[1], y);
    box[2] = Math.max(box[2], x);
    box[3] = Math.max(box[3], y);
  };
  const points: Record<number, number> = { 0: 1, 1: 1, 2: 3, 3: 2, 4: 0 };
  let index = 0;
  while (index < path.length) {
    const op = path[index++];
    const count = points[op];
    // Something this does not know how to read: the whole path's box is
    // still there to fall back on.
    if (count === undefined || index + count * 2 > path.length) return null;
    if (op === 0 && box) {
      boxes.push(box);
      box = null;
    }
    for (let point = 0; point < count; point++) {
      add(path[index + point * 2], path[index + point * 2 + 1]);
    }
    index += count * 2;
  }
  if (box) boxes.push(box);
  return boxes;
}

/** The flat list of a path's operations, wherever this pdf.js keeps it. */
function pathOf(data: unknown): ArrayLike<number> | null {
  const candidate = Array.isArray(data) ? data[0] : data;
  return ArrayBuffer.isView(candidate) || Array.isArray(candidate)
    ? (candidate as ArrayLike<number>)
    : null;
}

/** A box put on the page through the transform in force when it was drawn. */
function onPage(ctm: Matrix, [x0, y0, x1, y1]: Box): WoRule {
  const corners = [
    apply(ctm, x0, y0),
    apply(ctm, x1, y0),
    apply(ctm, x0, y1),
    apply(ctm, x1, y1),
  ];
  const xs = corners.map(([x]) => x);
  const ys = corners.map(([, y]) => y);
  return {
    x0: Math.min(...xs),
    x1: Math.max(...xs),
    y0: Math.min(...ys),
    y1: Math.max(...ys),
  };
}

const thin = (rule: WoRule) => rule.y1 - rule.y0 <= 1.6 && rule.x1 - rule.x0 >= 20;

/**
 * Thin horizontal shapes on a page.
 *
 * pdf.js hands a path over with its bounding box already worked out, in the
 * coordinates of the moment it was drawn; tracking the transforms around it
 * puts that box on the page. Clipping paths are skipped — they bound what is
 * drawn rather than drawing anything — and so is anything taller than a line.
 *
 * A path taller than a line is looked into, piece by piece. Ruled lines drawn
 * as one path — ten moves and ten lines, one stroke — came as a single box a
 * hundred points tall, so a notes box drawn that way was never seen and its
 * note was written at a spacing of our own, drifting off the real lines.
 */
function rulesOf(list: { fnArray: number[]; argsArray: unknown[] }, ops: PdfjsOps): WoRule[] {
  const rules: WoRule[] = [];
  const stack: Matrix[] = [];
  let ctm: Matrix = IDENTITY;

  for (let index = 0; index < list.fnArray.length; index++) {
    const fn = list.fnArray[index];
    const args = list.argsArray[index] as unknown[] | null;

    if (fn === ops.save) {
      stack.push(ctm);
    } else if (fn === ops.restore) {
      ctm = stack.pop() ?? IDENTITY;
    } else if (fn === ops.transform && Array.isArray(args)) {
      ctm = multiply(ctm, args as number[]);
    } else if (fn === ops.paintFormXObjectBegin && Array.isArray(args)) {
      stack.push(ctm);
      const matrix = args[0];
      if (Array.isArray(matrix) || ArrayBuffer.isView(matrix)) {
        ctm = multiply(ctm, Array.from(matrix as ArrayLike<number>));
      }
    } else if (fn === ops.paintFormXObjectEnd) {
      ctm = stack.pop() ?? IDENTITY;
    } else if (fn === ops.constructPath && Array.isArray(args)) {
      const [paint, data, minMax] = args as [number, unknown, ArrayLike<number> | null];
      if (paint === ops.endPath || !minMax || minMax.length < 4) continue;
      if (!Number.isFinite(minMax[0]) || !Number.isFinite(minMax[3])) continue;

      const whole = onPage(ctm, [minMax[0], minMax[1], minMax[2], minMax[3]]);
      if (thin(whole)) {
        rules.push(whole);
        continue;
      }
      const path = pathOf(data);
      const pieces = path ? piecesOf(path) : null;
      if (!pieces || pieces.length < 2) continue;
      for (const piece of pieces) {
        const rule = onPage(ctm, piece);
        if (thin(rule)) rules.push(rule);
      }
    }
  }
  return rules;
}

function itemsOf(items: unknown[]): WoTextItem[] {
  return (items as PdfjsTextItem[])
    .filter((item) => typeof item.str === "string" && item.str.trim() !== "" && item.transform)
    .map((item) => ({
      text: item.str!.trim().replace(/\s+/g, " "),
      x: item.transform![4],
      y: item.transform![5],
      width: item.width ?? 0,
      height: item.height ?? Math.abs(item.transform![3]),
    }));
}

/**
 * Every page's text, and the lines of the pages that can be written on.
 *
 * Reading a page's drawing is the slow half of reading it — on a phone, most
 * of a second for a ten-page work order, and for a scan, every picture on the
 * page decoded to look for lines that are not there. So the text comes first,
 * and the drawing is read only for the pages it can matter on: those in the
 * first copy with something to find on them (wo-layout.ts says which), or in
 * the whole document when somebody has chosen every page.
 *
 * A page whose drawing cannot be read still gives its text: the words find
 * more than the lines do.
 */
export async function scanWorkOrder(
  document: PdfjsDocumentLike,
  ops: PdfjsOps,
  options: WoDetectOptions = {},
): Promise<WoScan> {
  const read: { page: PdfjsPageLike; scanned: WoScanPage }[] = [];
  for (let number = 1; number <= document.numPages; number++) {
    const page = await document.getPage(number);
    const [x0 = 0, y0 = 0, x1 = 612, y1 = 792] = page.view;
    read.push({
      page,
      scanned: {
        view: [x0, y0, x1, y1],
        items: itemsOf((await page.getTextContent()).items),
        rules: [],
      },
    });
  }

  const scan: WoScan = { pages: read.map(({ scanned }) => scanned) };
  for (const index of pagesToRead(scan, options)) {
    try {
      read[index].scanned.rules = rulesOf(await read[index].page.getOperatorList(), ops);
    } catch (error) {
      console.warn("[work order] page drawing could not be read", error);
    }
  }
  return scan;
}
