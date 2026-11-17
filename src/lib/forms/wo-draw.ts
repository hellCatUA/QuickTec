import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import { sizeToFit, toWinAnsi, wrapText } from "@/lib/forms/text-fit";
import {
  RULE_LIFT,
  TIMES_ASCENT,
  TIMES_DESCENT,
  type WoNotesBox,
  type WoOverlay,
} from "@/lib/forms/wo-layout";

/**
 * Writing the sign-off onto a work order.
 *
 * The same code draws the preview on the phone and the file that is kept, so
 * what somebody confirmed on the screen is what the customer's copy carries,
 * to the point: a note that wraps after "replaced" on the screen wraps after
 * "replaced" in the file.
 *
 * Only the first copy is written on. The whole work order is kept — it is
 * their document, and the customer's copy and the instructions travel with
 * it — but it is signed once, where the customer signs.
 *
 * WorkMarket's own check-in and check-out are painted over in white before
 * ours go on. Painted, not removed: the printed text is still inside the file
 * under the white, which a PDF reader's select-all would find. What anybody
 * reading or printing it sees is ours.
 */

export type WoValues = {
  checkIn: string;
  checkOut: string;
  notes: string;
  name: string;
  date: string;
};

export const WO_VALUE_LIMITS: Record<keyof WoValues, number> = {
  checkIn: 60,
  checkOut: 60,
  notes: 4000,
  name: 120,
  date: 40,
};

/** Smallest a note is set before it is cut short instead. */
export const NOTES_MIN_SIZE = 6;
/** Where a note too long for the box ends. The whole of it is in the report. */
export const NOTES_CUT = "... (continued in the job report)";

export type NotesFit = {
  size: number;
  pitch: number;
  lines: string[];
  /** Still on the box's ruled lines, rather than closer together. */
  onRules: boolean;
  cut: boolean;
};

/** A note as one text: paragraphs kept, the blank lines between them dropped. */
export function notesText(raw: string): string {
  return toWinAnsi(raw)
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

/**
 * How a note goes into its box.
 *
 * On the ruled lines first, at the box's size and then a little smaller —
 * written on the lines is what makes it look filled in rather than stuck on.
 * Past that the lines give way: smaller and closer together. Past the floor
 * it is cut, and says that the rest is in the report, which travels with it.
 */
export function fitNotes(raw: string, font: PDFFont, box: WoNotesBox): NotesFit {
  const text = notesText(raw);
  const width = Math.max(10, box.width - 4);
  const room = (pitch: number) => Math.max(1, Math.floor((box.height + 0.01) / pitch));
  if (!text) return { size: box.size, pitch: box.pitch, lines: [], onRules: true, cut: false };

  const floorOnRules = Math.max(NOTES_MIN_SIZE, box.size - 1.5);
  for (let size = box.size; size >= floorOnRules; size -= 0.5) {
    const lines = wrapText(text, font, size, width);
    if (lines.length <= room(box.pitch)) {
      return { size, pitch: box.pitch, lines, onRules: true, cut: false };
    }
  }

  for (let size = floorOnRules - 0.5; size >= NOTES_MIN_SIZE; size -= 0.5) {
    const pitch = Math.min(box.pitch, size * 1.18);
    const lines = wrapText(text, font, size, width);
    if (lines.length <= room(pitch)) {
      return { size, pitch, lines, onRules: false, cut: false };
    }
  }

  const size = NOTES_MIN_SIZE;
  const pitch = Math.min(box.pitch, size * 1.18);
  const kept = wrapText(text, font, size, width).slice(0, room(pitch));
  let last = kept[kept.length - 1] ?? "";
  while (last && font.widthOfTextAtSize(`${last} ${NOTES_CUT}`, size) > width) {
    last = last.replace(/\s*\S+$/, "");
  }
  kept[kept.length - 1] = last ? `${last} ${NOTES_CUT}` : NOTES_CUT;
  return { size, pitch, lines: kept, onRules: false, cut: true };
}

const INK = rgb(0, 0, 0);

/** One line of text, made smaller rather than allowed past its width. */
function writeLine(
  page: PDFPage,
  font: PDFFont,
  raw: string,
  x: number,
  baseline: number,
  size: number,
  width: number,
) {
  const text = toWinAnsi(raw).replace(/\s+/g, " ").trim();
  if (!text) return;
  page.drawText(text, {
    x,
    y: baseline,
    size: sizeToFit(text, font, size, Math.max(10, width)),
    font,
    color: INK,
  });
}

export type WoDrawResult = { notes: NotesFit; signed: boolean };

/**
 * Draws the overlay onto an opened work order. The caller saves it.
 *
 * `signature` is the customer's signature as PNG bytes, or nothing; a work
 * order is still filled without one, and the screen says so before saving.
 */
export async function drawWorkOrder(
  pdf: PDFDocument,
  overlay: WoOverlay,
  values: WoValues,
  signature: Uint8Array | null,
): Promise<WoDrawResult> {
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const pages = pdf.getPages();
  const writable = new Set(overlay.pages);
  const pageAt = (index: number) => (writable.has(index) ? (pages[index] ?? null) : null);

  for (const cover of overlay.covers) {
    pageAt(cover.page)?.drawRectangle({
      x: cover.x,
      y: cover.y,
      width: cover.width,
      height: cover.height,
      color: rgb(1, 1, 1),
    });
  }

  const times = overlay.times;
  const timesPage = pageAt(times.page);
  if (timesPage) {
    const top = times.y + times.height - TIMES_ASCENT * times.size;
    const bottom = times.y + TIMES_DESCENT * times.size;
    writeLine(timesPage, font, values.checkIn, times.x, top, times.size, times.width);
    writeLine(timesPage, font, values.checkOut, times.x, bottom, times.size, times.width);
  }

  const box = overlay.notes;
  const notes = fitNotes(values.notes, font, box);
  const notesPage = pageAt(box.page);
  if (notesPage) {
    notes.lines.forEach((line, index) => {
      if (!line) return;
      notesPage.drawText(line, {
        x: box.x + 2,
        y: box.y + box.height - (index + 1) * notes.pitch + RULE_LIFT,
        size: notes.size,
        font,
        color: INK,
      });
    });
  }

  const row = overlay.approval;
  const rowPage = pageAt(row.page);
  let signed = false;
  if (rowPage) {
    const baseline = row.y + RULE_LIFT + 0.5;
    writeLine(rowPage, font, values.name, row.x + 2, baseline, row.size, row.signatureAt - 10);
    writeLine(
      rowPage,
      font,
      values.date,
      row.x + row.dateAt + 2,
      baseline,
      row.size,
      row.width - row.dateAt - 4,
    );

    if (signature) {
      try {
        const image = await pdf.embedPng(signature);
        const area = {
          x: row.x + row.signatureAt + 2,
          y: row.y + 0.8,
          width: Math.max(10, row.dateAt - row.signatureAt - 14),
          height: Math.max(6, row.height - 0.8),
        };
        // Fitted, never stretched, and sitting on the line where a pen would
        // have put it.
        const scale = Math.min(area.width / image.width, area.height / image.height);
        rowPage.drawImage(image, {
          x: area.x,
          y: area.y,
          width: image.width * scale,
          height: image.height * scale,
        });
        signed = true;
      } catch (error) {
        console.error("[work order] the signature could not be drawn", error);
      }
    }
  }

  return { notes, signed };
}

export const LOCKED_WORK_ORDER =
  "This work order is locked against changes by whoever made it, so nothing can be written on it.";

/**
 * A work order, opened for drawing, as a new document holding its pages.
 *
 * Its pages are copied rather than the file edited in place. The work orders
 * arrive broken in ways readers forgive — one of the two this was built on
 * has an object stream that does not parse and a cross-reference pointing at
 * the wrong generation — and pdf-lib, saving such a file as it found it, wrote
 * one that neither pdf.js nor Poppler would open. Copying the pages walks only
 * what the pages actually use, renumbered, and the result opens everywhere.
 *
 * Lenient on the way in, because strict parsing refuses files that open
 * everywhere else; but not about encryption: a locked file loads, and then
 * saves into one no reader can open.
 */
export async function openWorkOrder(
  bytes: Uint8Array | ArrayBuffer,
  /**
   * Only the pages up to this one, for a preview that shows nothing else.
   * Always from the first page, so a page's number means the same page.
   */
  through?: number,
): Promise<PDFDocument> {
  const source = await PDFDocument.load(bytes, {
    ignoreEncryption: true,
    updateMetadata: false,
    throwOnInvalidObject: false,
  });
  if (source.isEncrypted) throw new Error(LOCKED_WORK_ORDER);

  const indices = source
    .getPageIndices()
    .filter((index) => through === undefined || index <= through);
  const pdf = await PDFDocument.create();
  for (const page of await pdf.copyPages(source, indices)) {
    pdf.addPage(page);
  }
  const title = source.getTitle();
  if (title) pdf.setTitle(title);
  return pdf;
}
