import { readFile } from "node:fs/promises";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFFont,
  PDFName,
  StandardFonts,
  rgb,
} from "pdf-lib";
import type { PDFPage } from "pdf-lib";
import sharp from "sharp";
import type { FormPlacement } from "@prisma-client";
import { loadPdf } from "@/lib/forms/analyze";
import {
  STATIC_SOURCE,
  formSource,
  type FormFillContext,
} from "@/lib/forms/catalogue";
import { absolutePath } from "@/lib/storage";

/**
 * Turning a blank plus a job into the sheet the tech carries.
 *
 * Two rules the whole file is built around.
 *
 * Nothing appears on a filled form that a placement did not ask for. A
 * sign-off sheet goes to somebody else's customer, and a wrong value in a box
 * is worse than an empty box: the empty one gets filled in by hand on site,
 * the wrong one gets signed.
 *
 * And every value is drawn onto the page rather than typed into the form's own
 * fields. That looks like the harder way round, and it is the only one that
 * holds up. The blanks people actually keep are produced by whatever was to
 * hand — one of the two real sheets this was built against cannot be flattened
 * at all, and its fields would have gone to a customer still editable. Drawing
 * also means a value can never be silently truncated by a field's own length
 * limit; it shrinks to fit instead, which is a thing somebody can see.
 *
 * The form fields are then taken out entirely. That is what clears the
 * previous job's data: the blanks people keep are last year's sheet with the
 * values still in it, and one of the two samples arrived carrying another
 * store's name, address and ticket number.
 */

/** Point size used when a placement does not name one. */
const DEFAULT_FONT_SIZE = 10;
const MIN_FONT_SIZE = 5;
const LINE_SPACING = 1.15;
/** Text sits this far in from the left of its box. */
const PADDING_X = 2;

export type FillablePlacement = Pick<
  FormPlacement,
  | "page"
  | "x"
  | "y"
  | "width"
  | "height"
  | "kind"
  | "source"
  | "staticText"
  | "rowIndex"
  | "fontSize"
> & { fieldName?: string | null };

export type FillResult = {
  bytes: Buffer;
  /** Boxes that resolved to nothing, named so somebody can see the gaps. */
  empty: string[];
};

/**
 * Drops what a standard PDF font cannot draw.
 *
 * The fonts built into every PDF reader cover WinAnsi and nothing else, and
 * pdf-lib throws rather than substituting. Real data arrives with curly quotes
 * and en dashes from Word, and a form that fails to generate because somebody
 * pasted a smart apostrophe is not a form.
 */
export function toWinAnsi(text: string): string {
  return (
    text
      .replace(/[‘’‛]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[–—]/g, "-")
      .replace(/…/g, "...")
      .replace(/ /g, " ")
      .replace(/[•●]/g, "-")
      // Anything left outside Latin-1 would throw on draw. A character we
      // cannot render is better shown as a gap somebody can see than as a
      // failure to produce the form at all.
      .replace(/[^\x09\x0A\x0D\x20-\xFF]/g, "")
  );
}

/** Greedy wrap, breaking inside a word only when the word alone will not fit. */
function wrap(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string[] {
  const lines: string[] = [];

  for (const paragraph of text.split(/\r?\n/)) {
    if (paragraph.trim() === "") {
      lines.push("");
      continue;
    }

    let current = "";
    for (const word of paragraph.split(/\s+/)) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        current = candidate;
        continue;
      }

      if (current) lines.push(current);

      if (font.widthOfTextAtSize(word, size) <= maxWidth) {
        current = word;
        continue;
      }

      // A single word wider than the box — a long URL or a tracking number.
      let chunk = "";
      for (const character of word) {
        if (font.widthOfTextAtSize(chunk + character, size) > maxWidth) {
          lines.push(chunk);
          chunk = character;
        } else {
          chunk += character;
        }
      }
      current = chunk;
    }

    lines.push(current);
  }

  return lines;
}

/**
 * How the text should sit in its box.
 *
 * A form has two kinds of box and they want opposite things. A table cell is
 * one line tall: a date that does not fit belongs smaller, not broken after
 * "06-25-202" with a lonely "6" underneath spilling out of the row. A box for
 * a paragraph has room for many lines, and there the answer is the largest
 * size that fits — shrinking it to save a line only makes it harder to read.
 *
 * The box's own height says which it is, so nothing has to be guessed about
 * the text.
 */
export function fitText(
  text: string,
  font: PDFFont,
  requested: number,
  width: number,
  height: number,
): { size: number; lines: string[] } {
  const usable = Math.max(1, width - PADDING_X * 2);
  const roomForSeveralLines = height >= requested * LINE_SPACING * 2;

  let best: { size: number; lines: string[] } | null = null;
  for (let size = requested; size >= MIN_FONT_SIZE; size -= 0.5) {
    const lines = wrap(text, font, size, usable);
    if (lines.length * size * LINE_SPACING > height) continue;

    // A paragraph box takes the first candidate, which is the largest size.
    if (roomForSeveralLines) return { size, lines };

    // A single-line cell keeps shrinking until the value stops breaking.
    if (!best || lines.length < best.lines.length) best = { size, lines };
    if (lines.length === 1) break;
  }
  if (best) return best;

  // Nothing fits: draw at the floor and let it run over rather than dropping
  // the value silently. A visibly cramped box is something somebody notices.
  return { size: MIN_FONT_SIZE, lines: wrap(text, font, MIN_FONT_SIZE, usable) };
}

function drawText(
  page: PDFPage,
  placement: FillablePlacement,
  text: string,
  font: PDFFont,
): void {
  const { size, lines } = fitText(
    text,
    font,
    placement.fontSize ?? DEFAULT_FONT_SIZE,
    placement.width,
    placement.height,
  );

  const lineHeight = size * LINE_SPACING;
  // One line sits centred on the rule somebody drew the box around; several
  // start at the top and run down.
  const top =
    lines.length === 1
      ? placement.y + (placement.height - size) / 2 + size * 0.22
      : placement.y + placement.height - lineHeight;

  lines.forEach((line, index) => {
    if (line === "") return;
    page.drawText(line, {
      x: placement.x + PADDING_X,
      y: top - index * lineHeight,
      size,
      font,
      color: rgb(0, 0, 0),
    });
  });
}

function drawCheck(page: PDFPage, placement: FillablePlacement): void {
  // Drawn rather than typed: the tick glyph is not in the standard fonts, and
  // two strokes read as a tick at any box size.
  const size = Math.min(placement.width, placement.height);
  const x = placement.x + (placement.width - size) / 2;
  const y = placement.y + (placement.height - size) / 2;
  const thickness = Math.max(0.8, size / 8);

  page.drawLine({
    start: { x: x + size * 0.18, y: y + size * 0.5 },
    end: { x: x + size * 0.42, y: y + size * 0.22 },
    thickness,
    color: rgb(0, 0, 0),
  });
  page.drawLine({
    start: { x: x + size * 0.42, y: y + size * 0.22 },
    end: { x: x + size * 0.84, y: y + size * 0.8 },
    thickness,
    color: rgb(0, 0, 0),
  });
}

async function drawImage(
  pdf: PDFDocument,
  page: PDFPage,
  placement: FillablePlacement,
  storagePath: string,
): Promise<void> {
  let bytes: Buffer;
  try {
    bytes = await readFile(absolutePath(storagePath));
  } catch {
    // The signature row exists but its file is gone. An empty box is the
    // honest outcome; refusing to produce the form is not.
    return;
  }

  let image;
  try {
    // Re-encoded rather than handed over as read. pdf-lib's PNG decoder does
    // not loop-guard: a truncated file — a write that ran out of disk, an
    // upload that was cut off — spins forever inside embedPng, and a request
    // that never returns is far worse than one that fails. sharp is native,
    // rejects a corrupt file cleanly, and normalises whatever format the
    // signature was stored in.
    image = await pdf.embedPng(
      await sharp(bytes).png({ compressionLevel: 9 }).toBuffer(),
    );
  } catch (error) {
    console.error("[forms] a signature image could not be embedded", error);
    return;
  }

  // Fitted, never stretched — a signature squashed to a box shape reads as a
  // forgery even when it is not.
  const scale = Math.min(
    placement.width / image.width,
    placement.height / image.height,
  );
  const width = image.width * scale;
  const height = image.height * scale;

  page.drawImage(image, {
    x: placement.x + (placement.width - width) / 2,
    y: placement.y + (placement.height - height) / 2,
    width,
    height,
  });
}

/** What a placement resolves to for this job. */
export function valueFor(
  placement: FillablePlacement,
  context: FormFillContext,
): { text: string } | { image: string } | null {
  if (!placement.source) return null;

  if (placement.source === STATIC_SOURCE) {
    const text = placement.staticText?.trim();
    return text ? { text } : null;
  }

  const source = formSource(placement.source);
  if (!source) return null;

  if (source.resolveImage) {
    const path = source.resolveImage(context);
    return path ? { image: path } : null;
  }

  const text = source.resolve?.(context, placement.rowIndex ?? 0)?.trim();
  return text ? { text } : null;
}

/**
 * Takes the interactive form out of a document, values and all.
 *
 * Both halves matter. Dropping /AcroForm alone leaves the widget annotations
 * on the page still showing the previous job's values; dropping the widgets
 * alone leaves a form definition pointing at nothing. Together they leave a
 * page that is exactly what it looks like.
 */
function stripForm(pdf: PDFDocument): void {
  for (const page of pdf.getPages()) {
    const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    if (!annots) continue;

    const keep = [];
    for (let index = 0; index < annots.size(); index++) {
      const raw = annots.get(index);
      let subtype: string | undefined;
      try {
        subtype = annots.lookup(index, PDFDict).get(PDFName.of("Subtype"))?.toString();
      } catch {
        // Unreadable annotation: dropping it is safer than carrying it into a
        // document that is about to be signed.
        continue;
      }
      if (subtype !== "/Widget") keep.push(raw);
    }

    if (keep.length === annots.size()) continue;
    page.node.set(PDFName.of("Annots"), pdf.context.obj(keep));
  }

  pdf.catalog.delete(PDFName.of("AcroForm"));
}

export async function fillForm(
  blank: Buffer,
  placements: FillablePlacement[],
  context: FormFillContext,
): Promise<FillResult> {
  const pdf = await loadPdf(blank);
  const font = await pdf.embedFont(StandardFonts.Helvetica);

  // Before anything is drawn: whatever the blank was carrying is not ours to
  // pass on, and a value drawn under a widget still showing last job's text
  // would be worse than either on its own.
  stripForm(pdf);

  const pages = pdf.getPages();
  const empty: string[] = [];

  for (const placement of placements) {
    const value = valueFor(placement, context);
    if (!value) {
      empty.push(
        placement.fieldName ||
          `page ${placement.page + 1} at ${Math.round(placement.x)},${Math.round(placement.y)}`,
      );
      continue;
    }

    const page = pages[placement.page];
    if (!page) continue;

    if ("image" in value) {
      await drawImage(pdf, page, placement, value.image);
    } else if (placement.kind === "CHECK") {
      drawCheck(page, placement);
    } else {
      drawText(page, placement, toWinAnsi(value.text), font);
    }
  }

  return { bytes: Buffer.from(await pdf.save()), empty };
}
