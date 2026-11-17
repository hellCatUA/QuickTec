import type { WoRule, WoScan, WoScanPage, WoTextItem } from "@/lib/forms/wo-layout";

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

/**
 * Thin horizontal shapes on a page.
 *
 * pdf.js hands a path over with its bounding box already worked out, in the
 * coordinates of the moment it was drawn; tracking the transforms around it
 * puts that box on the page. Clipping paths are skipped — they bound what is
 * drawn rather than drawing anything — and so is anything taller than a line.
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
      const [paint, , minMax] = args as [number, unknown, ArrayLike<number> | null];
      if (paint === ops.endPath || !minMax || minMax.length < 4) continue;
      if (!Number.isFinite(minMax[0]) || !Number.isFinite(minMax[3])) continue;

      const [ax, ay] = apply(ctm, minMax[0], minMax[1]);
      const [bx, by] = apply(ctm, minMax[2], minMax[3]);
      const rule = {
        x0: Math.min(ax, bx),
        x1: Math.max(ax, bx),
        y0: Math.min(ay, by),
        y1: Math.max(ay, by),
      };
      if (rule.y1 - rule.y0 <= 1.6 && rule.x1 - rule.x0 >= 20) rules.push(rule);
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
 * The lines are only ever looked for on the first copy, and reading a page's
 * drawing is the slow half of reading it — on a phone, most of a second for a
 * ten-page work order. So the text comes first, and the drawing is read up to
 * the page before "CUSTOMER COPY", or for every page when there is none.
 *
 * A page whose drawing cannot be read still gives its text: the words find
 * more than the lines do.
 */
export async function scanWorkOrder(
  document: PdfjsDocumentLike,
  ops: PdfjsOps,
): Promise<WoScan> {
  const read: { page: PdfjsPageLike; items: WoTextItem[] }[] = [];
  for (let number = 1; number <= document.numPages; number++) {
    const page = await document.getPage(number);
    read.push({ page, items: itemsOf((await page.getTextContent()).items) });
  }

  const customerCopy = read.findIndex(({ items }) =>
    items.some((item) => /^CUSTOMER COPY\b/i.test(item.text)),
  );
  const drawnUpTo = customerCopy > 0 ? customerCopy - 1 : read.length - 1;

  const pages: WoScanPage[] = [];
  for (const [index, { page, items }] of read.entries()) {
    let rules: WoRule[] = [];
    if (index <= drawnUpTo) {
      try {
        rules = rulesOf(await page.getOperatorList(), ops);
      } catch (error) {
        console.warn("[work order] page drawing could not be read", error);
      }
    }
    const [x0 = 0, y0 = 0, x1 = 612, y1 = 792] = page.view;
    pages.push({ view: [x0, y0, x1, y1], items, rules });
  }
  return { pages };
}
