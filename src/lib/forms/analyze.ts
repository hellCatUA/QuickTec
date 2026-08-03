import {
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFOptionList,
  PDFRadioGroup,
  PDFString,
  PDFTextField,
  PDFArray,
  PDFDict,
} from "pdf-lib";
import type { FormBoxSource, FormPlacementKind } from "@prisma-client";

/**
 * Reading a blank to find out where its boxes are.
 *
 * Two kinds of file arrive. Some carry real form fields, and then the boxes
 * are already described in the file and we only have to say what goes in each.
 * The rest are flat — the sort of PDF somebody today opens in a phone annotator
 * and types on top of — and there the boxes have to be drawn by hand once.
 *
 * Either way this runs on upload, so the mapping screen opens knowing what it
 * is looking at rather than re-parsing the file every time.
 */

export type SeededPlacement = {
  fieldName: string | null;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  kind: FormPlacementKind;
  /** Whatever the blank already had in the field, as a hint for mapping. */
  sampleText: string | null;
  order: number;
};

export type FormAnalysis = {
  boxSource: FormBoxSource;
  pageCount: number;
  pageWidth: number;
  pageHeight: number;
  placements: SeededPlacement[];
};

/**
 * Boxes lifted from a copy somebody already filled in by hand.
 *
 * A phone annotator leaves its text behind as FreeText annotations with real
 * rectangles, so a filled sheet is a map of where everything goes — drawn by
 * the person who knows the form. Offered on flat blanks, where the alternative
 * is placing twenty boxes from memory.
 */
export type LiftedBox = {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
};

function rectOf(dict: PDFDict): [number, number, number, number] | null {
  const rect = dict.lookupMaybe(PDFName.of("Rect"), PDFArray);
  if (!rect || rect.size() < 4) return null;
  const numbers = [0, 1, 2, 3].map((index) =>
    rect.lookup(index, PDFNumber).asNumber(),
  );
  // A rectangle may be stored with either corner first.
  return [
    Math.min(numbers[0], numbers[2]),
    Math.min(numbers[1], numbers[3]),
    Math.abs(numbers[2] - numbers[0]),
    Math.abs(numbers[3] - numbers[1]),
  ];
}

function textOf(dict: PDFDict, key: string): string | null {
  const value = dict.get(PDFName.of(key));
  if (value instanceof PDFString || value instanceof PDFHexString) {
    const text = value.decodeText().trim();
    return text.length > 0 ? text : null;
  }
  return null;
}

export async function loadPdf(bytes: Buffer): Promise<PDFDocument> {
  // Blanks come from other companies and are frequently produced by whatever
  // was to hand; being strict here only means refusing files that open fine
  // everywhere else.
  return PDFDocument.load(bytes, {
    ignoreEncryption: true,
    updateMetadata: false,
    throwOnInvalidObject: false,
  });
}

export async function analyzeForm(bytes: Buffer): Promise<FormAnalysis> {
  const pdf = await loadPdf(bytes);
  const pages = pdf.getPages();
  const first = pages[0];

  const analysis: FormAnalysis = {
    boxSource: "DRAWN",
    pageCount: pages.length,
    pageWidth: first?.getWidth() ?? 612,
    pageHeight: first?.getHeight() ?? 792,
    placements: [],
  };

  let form;
  try {
    form = pdf.getForm();
  } catch {
    return analysis;
  }

  const fields = form.getFields();
  if (fields.length === 0) return analysis;

  analysis.boxSource = "FIELDS";

  // Which page a widget sits on. A widget knows its rectangle but not its
  // page, so the lookup has to go the other way.
  const pageOfRef = new Map<string, number>();
  pages.forEach((page, index) => {
    const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    if (!annots) return;
    for (let i = 0; i < annots.size(); i++) {
      pageOfRef.set(String(annots.get(i)), index);
    }
  });

  let order = 0;
  for (const field of fields) {
    const kind: FormPlacementKind =
      field instanceof PDFCheckBox || field instanceof PDFRadioGroup
        ? "CHECK"
        : "TEXT";

    let sampleText: string | null = null;
    if (field instanceof PDFTextField) {
      sampleText = field.getText()?.trim() || null;
    } else if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
      sampleText = field.getSelected().join(", ") || null;
    }

    for (const widget of field.acroField.getWidgets()) {
      const rect = rectOf(widget.dict);
      if (!rect) continue;
      const [x, y, width, height] = rect;
      if (width <= 0 || height <= 0) continue;

      analysis.placements.push({
        fieldName: field.getName(),
        page: pageOfRef.get(String(widget.dict)) ?? 0,
        x,
        y,
        width,
        height,
        kind,
        sampleText,
        order: order++,
      });
    }
  }

  // Top-left first, the order somebody reads the page in, so the mapping list
  // runs down the form instead of following whatever order the file stored.
  analysis.placements.sort(
    (a, b) => a.page - b.page || b.y - a.y || a.x - b.x,
  );
  analysis.placements.forEach((placement, index) => {
    placement.order = index;
  });

  return analysis;
}

/**
 * Pulls the boxes out of a PDF somebody already annotated.
 *
 * Only annotation types that carry visible text are taken. A signature stamp
 * has no text and is skipped: where the signature goes is a choice, and a
 * silently-added image box is the kind of thing nobody checks.
 */
export async function liftBoxes(bytes: Buffer): Promise<LiftedBox[]> {
  const pdf = await loadPdf(bytes);
  const boxes: LiftedBox[] = [];

  pdf.getPages().forEach((page, index) => {
    const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    if (!annots) return;
    for (let i = 0; i < annots.size(); i++) {
      let dict: PDFDict;
      try {
        dict = annots.lookup(i, PDFDict);
      } catch {
        continue;
      }

      const subtype = dict.get(PDFName.of("Subtype"))?.toString();
      if (subtype !== "/FreeText" && subtype !== "/Square") continue;

      const text = textOf(dict, "Contents");
      if (!text) continue;

      const rect = rectOf(dict);
      if (!rect) continue;

      boxes.push({
        page: index,
        x: rect[0],
        y: rect[1],
        width: rect[2],
        height: rect[3],
        text,
      });
    }
  });

  boxes.sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
  return boxes;
}
