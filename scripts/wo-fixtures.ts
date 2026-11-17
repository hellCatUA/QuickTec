import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

/**
 * Work orders in the shape WorkMarket prints them, made up from nothing.
 *
 * The two real ones this feature was built against carry customers' names,
 * phone numbers and addresses, so they stay out of the repository. These are
 * drawn to the same measurements — read off those two with pdf.js, to the
 * tenth of a point — with invented companies and 555 numbers:
 *
 *   "lines"    no times yet: ARRIVAL TIME and DEPARTURE TIME over blank lines
 *              ending in AM/PM, the notes box whole on the first page, the
 *              signature row on the second. Six pages, three copies.
 *   "printed"  WorkMarket's own Check-In and Check-Out printed in (the wrong
 *              day, as on the real one), "PDT" wrapped onto a line of its
 *              own, the notes box starting at the foot of page two with four
 *              lines and carrying on at the top of page three with six, the
 *              signature row under it. Ten pages, three copies.
 *
 * Text is drawn as a real generator draws it, one run per label, and every
 * line is a filled rectangle a fraction of a point tall, which is what the
 * real ones are made of.
 */

export type WoFixtureLayout = "lines" | "printed";

const GREY = rgb(0.6, 0.6, 0.6);
const LIGHT = rgb(0.85, 0.85, 0.85);
const BAR = rgb(0.93, 0.93, 0.93);
const RED = rgb(0.85, 0, 0);
const BLACK = rgb(0, 0, 0);

type Fonts = { regular: PDFFont; bold: PDFFont };

function text(
  page: PDFPage,
  fonts: Fonts,
  value: string,
  x: number,
  y: number,
  options: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb> } = {},
) {
  page.drawText(value, {
    x,
    y,
    size: options.size ?? 9,
    font: options.bold ? fonts.bold : fonts.regular,
    color: options.color ?? BLACK,
  });
}

/** A rule as the real ones are: a filled rectangle, not a stroked line. */
function rule(page: PDFPage, x0: number, x1: number, y: number, height = 0.4, color = LIGHT) {
  page.drawRectangle({ x: x0, y, width: x1 - x0, height, color });
}

function frame(page: PDFPage, x0: number, x1: number, y0: number, y1: number) {
  rule(page, x0, x1, y1 - 0.8, 0.8, GREY);
  rule(page, x0, x1, y0, 0.7, GREY);
  page.drawRectangle({ x: x0, y: y0, width: 0.8, height: y1 - y0, color: GREY });
  page.drawRectangle({ x: x1 - 0.7, y: y0, width: 0.7, height: y1 - y0, color: GREY });
}

/** A section heading on its grey bar, at the baseline the real ones use. */
function heading(page: PDFPage, fonts: Fonts, label: string, x0: number, x1: number, baseline: number) {
  page.drawRectangle({ x: x0, y: baseline - 4.8, width: x1 - x0, height: 17.9, color: BAR });
  text(page, fonts, label, x0 + 2.3, baseline, { size: 11.3, bold: true });
}

function footer(page: PDFPage, fonts: Fonts, number: number, of: number) {
  rule(page, 36, 576, 35.3, 0.7, GREY);
  text(page, fonts, "Thank you. Your business is appreciated.", 36, 14.5);
  text(page, fonts, `Page ${number} of ${of}`, 529.9, 14.5);
}

function copyHeading(page: PDFPage, fonts: Fonts, copy: string, y = 766.1) {
  const width = fonts.bold.widthOfTextAtSize(copy, 11.3);
  text(page, fonts, copy, 576 - width, y, { size: 11.3, bold: true });
  text(page, fonts, "HARLOW FIELD SERVICES", 36, 766.1, { size: 16, bold: true });
}

/** The left column every first page has: what the job is. */
function description(page: PDFPage, fonts: Fonts) {
  heading(page, fonts, "Assignment Description", 42, 416.9, 699.4);
  frame(page, 42, 416.9, 420, 694.6);
  const lines = [
    "Install a replacement ONT and test every service at the store.",
    "Quill & Ivy Market #12, 400 Example Avenue, Lodi, CA 95240",
    "Store contact: (555) 010-0142",
    "Tech must call the help desk on arrival and on departure.",
    "Tech must also call for any reason that may delay prompt arrival.",
  ];
  lines.forEach((line, index) => text(page, fonts, line, 46.5, 680 - index * 11));
}

function timesBlock(page: PDFPage, fonts: Fonts, layout: WoFixtureLayout, shift = 0) {
  heading(page, fonts, "Assignment Date", 422.2, 570, 699.4);
  if (layout === "lines") {
    frame(page, 422.2, 570, 596.3 + shift, 694.6);
    text(page, fonts, "September 18, 2026 8:00AM PDT", 426.7, 681.7);
    text(page, fonts, "CHECK IN REQUIRED", 426.7, 671.0, { bold: true, color: RED });
    text(page, fonts, "ARRIVAL TIME", 426.7, 649.2 + shift, { size: 9.8, bold: true });
    rule(page, 430.4, 520.7, 633.5 + shift, 0.7, BLACK);
    text(page, fonts, "AM/PM", 524.4, 638.6 + shift);
    text(page, fonts, "DEPARTURE TIME", 426.7, 620.3 + shift, { size: 9.8, bold: true });
    rule(page, 430.4, 520.7, 604.6 + shift, 0.7, BLACK);
    text(page, fonts, "AM/PM", 524.4, 609.7 + shift);
    heading(page, fonts, "Contact Information", 422.2, 570, 579.5 + shift);
  } else {
    frame(page, 422.2, 570, 607.6 + shift, 694.6);
    text(page, fonts, "September 29, 2026 9:00AM PDT", 426.7, 681.7);
    text(page, fonts, "CHECK IN REQUIRED", 426.7, 671.0, { bold: true, color: RED });
    text(page, fonts, "CHECK IN / OUT TIMES", 426.7, 649.2 + shift, { size: 9.8, bold: true });
    rule(page, 426.7, 565.5, 644.0 + shift, 0.7, GREY);
    text(page, fonts, "Check-In:", 426.7, 635.3 + shift, { bold: true });
    text(page, fonts, "9/25/2026 8:57AM PDT", 470.2, 635.3 + shift);
    text(page, fonts, "Check-Out:", 426.7, 624.6 + shift, { bold: true });
    text(page, fonts, "9/25/2026 8:57AM", 477.7, 624.6 + shift);
    text(page, fonts, "PDT", 426.7, 614.1 + shift);
    heading(page, fonts, "Contact Information", 422.2, 570, 590.7 + shift);
  }
  text(page, fonts, "Customer Contact", 426.7, 560.8 + shift, { size: 9.8, bold: true });
  text(page, fonts, "Rowan Pike (555) 010-0177", 426.7, 550.2 + shift);
}

/** The notes heading, its box, and ruled lines from `top` down, `count` of them. */
function notesBox(
  page: PDFPage,
  fonts: Fonts,
  options: { heading?: number; top: number; count: number; boxBottom: number; boxTop: number },
) {
  if (options.heading !== undefined) {
    heading(page, fonts, "Notes", 42, 570, options.heading);
  }
  frame(page, 42, 570, options.boxBottom, options.boxTop);
  for (let index = 0; index < options.count; index++) {
    rule(page, 50.3, 561.8, options.top - index * 10.77, 0.35);
  }
}

function approvalRow(page: PDFPage, fonts: Fonts, headingAt: number) {
  heading(page, fonts, "Approval", 42, 570, headingAt);
  const top = headingAt - 4.8;
  frame(page, 42, 570, top - 63.4, top);
  text(
    page,
    fonts,
    "By signing below, you acknowledge your agreement with the satisfactory completion of the assignment details listed above.",
    46.5,
    headingAt - 17.7,
    { size: 8.6 },
  );
  text(
    page,
    fonts,
    "Additionally, you verify the accuracy of the arrival and departure time(s) entered on this form.",
    46.5,
    headingAt - 28.1,
    { size: 8.6 },
  );
  const line = headingAt - 53.4;
  for (const [x0, x1] of [
    [46.5, 191.8],
    [210.6, 355.9],
    [374.6, 519.9],
  ]) {
    rule(page, x0, x1, line, 0.8, BLACK);
  }
  const labels = line - 8.3;
  text(page, fonts, "Customer Name (Printed)", 46.5, labels);
  text(page, fonts, "Customer Signature", 210.6, labels);
  text(page, fonts, "Date", 374.6, labels);
}

function instructions(page: PDFPage, fonts: Fonts) {
  heading(page, fonts, "Instructions", 42, 570, 699.4);
  [
    "Bring a ladder, a laptop and a spare patch cable.",
    "Photograph the rack before and after.",
    "Do not leave until the help desk confirms service.",
  ].forEach((line, index) => text(page, fonts, line, 46.5, 680 - index * 11));
}

export async function workMarketOrder(layout: WoFixtureLayout): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(layout === "lines" ? "2600000002" : "2600000001");
  const fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
  };
  const pages: PDFPage[] = [];
  const add = () => {
    const page = pdf.addPage([612, 792]);
    pages.push(page);
    return page;
  };

  if (layout === "lines") {
    for (const copy of ["RESOURCE COPY — CUSTOMER SIGNATURE REQUIRED", "CUSTOMER COPY"]) {
      const first = add();
      copyHeading(first, fonts, copy);
      description(first, fonts);
      timesBlock(first, fonts, layout);
      notesBox(first, fonts, { heading: 177.1, top: 153.3, count: 10, boxBottom: 48.2, boxTop: 172.3 });
      const second = add();
      copyHeading(second, fonts, copy);
      approvalRow(second, fonts, 705.4);
    }
    const third = add();
    copyHeading(third, fonts, "RESOURCE INSTRUCTIONS");
    timesBlock(third, fonts, layout, 6);
    const fourth = add();
    copyHeading(fourth, fonts, "RESOURCE INSTRUCTIONS");
    instructions(fourth, fonts);
  } else {
    for (const copy of ["RESOURCE COPY — CUSTOMER SIGNATURE REQUIRED", "CUSTOMER COPY"]) {
      const first = add();
      // The real one sets this heading forty points low, over the logo.
      copyHeading(first, fonts, copy, copy === "CUSTOMER COPY" ? 766.1 : 724.9);
      description(first, fonts);
      timesBlock(first, fonts, layout);
      const second = add();
      copyHeading(second, fonts, copy);
      instructions(second, fonts);
      notesBox(second, fonts, { heading: 96.3, top: 72.4, count: 4, boxBottom: 36, boxTop: 91.5 });
      const third = add();
      copyHeading(third, fonts, copy);
      notesBox(third, fonts, { top: 707.7, count: 6, boxBottom: 645.7, boxTop: 718.5 });
      approvalRow(third, fonts, 628.8);
    }
    for (let index = 0; index < 4; index++) {
      const page = add();
      copyHeading(page, fonts, "RESOURCE INSTRUCTIONS");
      if (index === 0) timesBlock(page, fonts, layout, 6);
      else instructions(page, fonts);
    }
  }

  pages.forEach((page, index) => footer(page, fonts, index + 1, pages.length));
  return Buffer.from(await pdf.save());
}

/** A page with nothing on it this feature recognises: somebody else's paperwork. */
export async function plainDocument(): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText("SERVICE TICKET 5512 — NOTHING TO SIGN HERE", { x: 60, y: 720, size: 14, font });
  return Buffer.from(await pdf.save());
}
