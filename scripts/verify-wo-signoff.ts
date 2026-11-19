import "dotenv/config";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { encode } from "next-auth/jwt";
import {
  lineTo,
  moveTo,
  PDFDocument,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setLineWidth,
  StandardFonts,
  stroke,
} from "pdf-lib";
import { chromium, type Browser, type Page } from "playwright";
import sharp from "sharp";
import { db } from "@/lib/db";
import { usDateInZone, zonedParts, zonedWallTime } from "@/lib/datetime";
import { lettersPrintedDifferently, toWinAnsi } from "@/lib/forms/text-fit";
import {
  drawWorkOrder,
  fitNotes,
  LOCKED_WORK_ORDER,
  NOTES_CUT,
  openWorkOrder,
  workOrderPageCount,
  type WoValues,
} from "@/lib/forms/wo-draw";
import {
  detectWoLayout,
  pagesToRead,
  RULE_LIFT,
  TIMES_ASCENT,
  TIMES_DESCENT,
  type WoLayout,
  type WoRect,
  type WoScan,
} from "@/lib/forms/wo-layout";
import { signatureInk } from "@/lib/forms/wo-signature";
import { scanWorkOrder } from "@/lib/forms/wo-scan";
import { absolutePath, storeFile } from "@/lib/storage";
import {
  defaultValues,
  isSignedWorkOrder,
  signableWorkOrder,
  signedWorkOrderName,
  workIsDone,
} from "@/lib/wo-sign-off";
import { plainDocument, workMarketOrder } from "./wo-fixtures";

/**
 * The paying company's work order, signed as the job's sign-off.
 *
 * First without a browser: that the three places are found on work orders
 * drawn to the measurements of the two real ones, that the sign-off lands on
 * their lines and only on the first copy, that WorkMarket's own times are
 * painted out, and that a note too long for its box shrinks and then says so.
 *
 * Then the cases the second review built to break it: a sentence that starts
 * "CUSTOMER COPY", labels set with wide spaces, ruled lines drawn as one path,
 * a "Notes" in the description, a second column beside the times, letters the
 * font has not got, a name too long for its line, the pad's white signature.
 *
 * Then in one, as the tech: refused before the job is closed, offered once
 * the last clock-out closes it, and on a phone one place at a time — Back,
 * Edit, Next, and Approve after the third — saved beside the original as
 * "<name>-Signed.pdf" and straight back to the job. Saved again in place
 * rather than twice, twice at the same moment too. At 320 px, and on a
 * computer's wider screen, where the three sit beside the page.
 *
 * Needs the app on BASE_URL with the same AUTH_SECRET. Writes jobs, a company
 * and a customer of its own: a development database only.
 *
 *   QUICKTEC_ALLOW_DESTRUCTIVE_VERIFY=1 npm run verify:wo
 */
if (process.env.QUICKTEC_ALLOW_DESTRUCTIVE_VERIFY !== "1") {
  console.error(
    "Refusing to run: this writes jobs, a company and a customer.\n" +
      "Set QUICKTEC_ALLOW_DESTRUCTIVE_VERIFY=1 on a development database to proceed.",
  );
  process.exit(1);
}

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const LA = "America/Los_Angeles";
const COMPANY = "WO Sign-Off Co";
const CUSTOMER_CODE = "WOSO";
const NOTE =
  "Replaced the failed ONT and its power supply. Tested all four data ports and both voice lines with the store manager; dial tone and internet confirmed.";

let failures = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label}\n      got ${actual}${ok ? "" : `  want ${expected}`}`,
  );
}

function near(label: string, actual: number | undefined, expected: number, within = 0.6) {
  const ok = actual !== undefined && Math.abs(actual - expected) <= within;
  if (!ok) failures++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label}\n      got ${actual?.toFixed(2)}${ok ? "" : `  want ${expected} ± ${within}`}`,
  );
}

// ---------------------------------------------------------------------------
// Reading a PDF the way the screen does.

async function pdfjs() {
  return import("pdfjs-dist/legacy/build/pdf.mjs");
}

async function scanOf(bytes: Uint8Array | Buffer): Promise<WoScan> {
  const lib = await pdfjs();
  const document = await lib.getDocument({
    data: new Uint8Array(bytes),
    verbosity: 0,
  }).promise;
  const scan = await scanWorkOrder(document, lib.OPS);
  await document.destroy();
  return scan;
}

async function layoutOf(bytes: Buffer): Promise<WoLayout> {
  return detectWoLayout(await scanOf(bytes));
}

/** The text runs on a page, for finding what was written where. */
function itemsOn(scan: WoScan, page: number) {
  return scan.pages[page]?.items ?? [];
}

/** How many pictures a page paints: the signature is the only one these have. */
async function imagesOn(bytes: Buffer, page: number): Promise<number> {
  const lib = await pdfjs();
  const document = await lib.getDocument({
    data: new Uint8Array(bytes),
    verbosity: 0,
  }).promise;
  const list = await (await document.getPage(page + 1)).getOperatorList();
  await document.destroy();
  return list.fnArray.filter((fn) => fn === lib.OPS.paintImageXObject).length;
}

/**
 * How light a patch of a page is when printed, 255 being white. Through
 * Poppler, which is not the app's renderer and so a fair second opinion;
 * null where it is not installed.
 */
async function lightness(
  bytes: Buffer,
  page: number,
  area: { x0: number; x1: number; y0: number; y1: number },
): Promise<number | null> {
  const dir = await mkdtemp(path.join(tmpdir(), "wo-verify-"));
  try {
    const file = path.join(dir, "in.pdf");
    await writeFile(file, bytes);
    try {
      execFileSync("pdftoppm", ["-r", "72", "-f", String(page + 1), "-l", String(page + 1), "-png", "-singlefile", file, path.join(dir, "out")]);
    } catch {
      return null;
    }
    const left = Math.round(area.x0);
    const top = Math.round(792 - area.y1);
    // Raw pixels of the patch, averaged here: sharp's own stats() reads the
    // whole input, whatever was extracted from it first.
    const pixels = await sharp(path.join(dir, "out.png"))
      .extract({ left, top, width: Math.round(area.x1 - area.x0), height: Math.round(area.y1 - area.y0) })
      .greyscale()
      .raw()
      .toBuffer();
    return pixels.reduce((sum, value) => sum + value, 0) / pixels.length;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** A signature as the pad leaves one: a stroke on a transparent PNG. */
async function signaturePng(): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="180"><path d="M20 120 C 80 20, 120 170, 180 90 S 260 40, 300 110 S 380 150, 420 70 C 450 30, 500 140, 580 100" stroke="#112233" stroke-width="7" fill="none"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** A signature as the phone's pad really keeps one: the whole pad, in white. */
async function padSignature(): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1074" height="540"><rect width="100%" height="100%" fill="#ffffff"/><path d="M190 300 C 280 160, 330 420, 440 290 S 560 180, 640 300 S 760 400, 880 220" stroke="#111111" stroke-width="6.6" stroke-linecap="round" fill="none"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

const overlapping = (a: WoRect, b: WoRect) =>
  a.page === b.page &&
  a.x < b.x + b.width &&
  b.x < a.x + a.width &&
  a.y < b.y + b.height &&
  b.y < a.y + a.height;

/** A page of its own for one case: words, rules, and the font they are set in. */
async function casePage(
  build: (page: {
    text: (value: string, x: number, y: number, options?: { size?: number; bold?: boolean; spaced?: boolean }) => void;
    rule: (x0: number, x1: number, y: number, height?: number) => void;
    raw: import("pdf-lib").PDFPage;
  }) => void,
): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  build({
    text: (value, x, y, options = {}) => {
      const size = options.size ?? 9;
      const font = options.bold ? bold : regular;
      if (!options.spaced) {
        page.drawText(value, { x, y, size, font });
        return;
      }
      // Word by word, two and a half spaces apart: how pdf.js comes to hand
      // a label over in pieces.
      let at = x;
      for (const word of value.split(" ")) {
        page.drawText(word, { x: at, y, size, font });
        at += font.widthOfTextAtSize(word, size) + font.widthOfTextAtSize(" ", size) * 2.5;
      }
    },
    rule: (x0, x1, y, height = 0.7) =>
      page.drawRectangle({ x: x0, y, width: x1 - x0, height, color: rgb(0.6, 0.6, 0.6) }),
    raw: page,
  });
  return Buffer.from(await pdf.save());
}

// ---------------------------------------------------------------------------

async function offline() {
  console.log("\n— finding the places —");

  const lines = await workMarketOrder("lines");
  const printed = await workMarketOrder("printed");

  const a = await layoutOf(lines);
  check("blank lines: found as lines", a.found.times, "lines");
  check("blank lines: the notes by their ruled lines", a.found.notes, "lines");
  check("blank lines: the signature row", a.found.approval, true);
  check("blank lines: the copies told apart", a.found.copies, true);
  check("blank lines: the first copy is pages 1 and 2", a.overlay.pages.join(","), "0,1");
  check("blank lines: times on page 1", a.overlay.times.page, 0);
  near(
    "check-in sits on the arrival line",
    a.overlay.times.y + a.overlay.times.height - TIMES_ASCENT * a.overlay.times.size,
    633.5 + 0.7 + RULE_LIFT,
  );
  near(
    "check-out sits on the departure line",
    a.overlay.times.y + TIMES_DESCENT * a.overlay.times.size,
    604.6 + 0.7 + RULE_LIFT,
  );
  check("nothing printed there to paint out", a.overlay.covers.length, 0);
  check("notes on page 1", a.overlay.notes.page, 0);
  check(
    "all ten ruled lines",
    Math.round(a.overlay.notes.height / a.overlay.notes.pitch),
    10,
  );
  near("their spacing", a.overlay.notes.pitch, 10.77, 0.05);
  near(
    "the first line of the note on the first rule",
    a.overlay.notes.y + a.overlay.notes.height - a.overlay.notes.pitch + RULE_LIFT,
    153.3 + 0.35 + RULE_LIFT,
  );
  check("signature row on page 2", a.overlay.approval.page, 1);
  near("on its line", a.overlay.approval.y, 652.8);
  near("the signature where its label is", a.overlay.approval.x + a.overlay.approval.signatureAt, 210.6);
  near("the date where its label is", a.overlay.approval.x + a.overlay.approval.dateAt, 374.6);

  const b = await layoutOf(printed);
  check("printed times: found as printed", b.found.times, "printed");
  check("printed times: the first copy is pages 1 to 3", b.overlay.pages.join(","), "0,1,2");
  near("check-in on WorkMarket's check-in line", b.overlay.times.y + b.overlay.times.height - TIMES_ASCENT * b.overlay.times.size, 635.3);
  near("check-out on its check-out line", b.overlay.times.y + TIMES_DESCENT * b.overlay.times.size, 624.6);
  check(
    "after the labels, not over them",
    b.overlay.times.x > 475 && b.overlay.times.x < 484,
    true,
  );
  check("their check-in, check-out and the wrapped PDT painted out", b.overlay.covers.length, 3);
  check(
    "the covers are where those were",
    b.overlay.covers.map((cover) => Math.round(cover.x)).sort((x, y) => x - y).join(","),
    "426,470,477",
  );
  check(
    "the heading 'CHECK IN / OUT TIMES' is not taken for a label",
    b.overlay.covers.every((cover) => cover.y + cover.height < 644),
    true,
  );
  check("the notes where there are more lines: page 3", b.overlay.notes.page, 2);
  check(
    "six lines there, not the four at the foot of page 2",
    Math.round(b.overlay.notes.height / b.overlay.notes.pitch),
    6,
  );
  check("signature row on page 3", b.overlay.approval.page, 2);
  near("on its line", b.overlay.approval.y, 576.2);

  const c = await layoutOf(await plainDocument());
  check("somebody else's paperwork: no times", c.found.times, null);
  check("no notes", c.found.notes, null);
  check("no signature row", c.found.approval, false);
  check("no copies, so every page is the first", c.overlay.pages.join(","), "0");
  check("and the boxes are still there to drag", [c.overlay.times, c.overlay.notes, c.overlay.approval].every((box) => box.page === 0 && box.width > 0), true);

  console.log("\n— writing on it —");

  const values = (layout: WoLayout): WoValues => ({
    ...defaultValues(
      {
        checkIn: { time: "9:05 AM", date: "09-29-2026" },
        checkOut: { time: "1:40 PM", date: "09-29-2026" },
        notes: NOTE,
        name: "Dana Reyes",
        date: "09-29-2026",
        signature: null,
      },
      layout.found.times,
    ),
  });

  const signature = new Uint8Array(await signaturePng());
  const pdfB = await openWorkOrder(new Uint8Array(printed));
  const drawnB = await drawWorkOrder(pdfB, b.overlay, values(b), signature);
  const signedB = Buffer.from(await pdfB.save());
  const scanB = await scanOf(signedB);

  check("the whole work order is kept", scanB.pages.length, 10);
  const inB = itemsOn(scanB, 0).find((item) => item.text === "09-29-2026 9:05 AM");
  near("check-in written with its date, on WorkMarket's line", inB?.y, 635.3, 0.3);
  const outB = itemsOn(scanB, 0).find((item) => item.text === "09-29-2026 1:40 PM");
  near("check-out too", outB?.y, 624.6, 0.3);
  const nameB = itemsOn(scanB, 2).find((item) => item.text === "Dana Reyes");
  near("the printed name on the signature line", nameB?.y, 576.2 + RULE_LIFT + 0.5, 0.3);
  const noteB = itemsOn(scanB, 2).find((item) => item.text.startsWith("Replaced the failed ONT"));
  near("the note on the first ruled line", noteB?.y, 707.7 + 0.35 + RULE_LIFT, 0.3);
  check("the note on the lines, at its own size", drawnB.notes.onRules, true);
  check("signed", drawnB.signed, true);
  check("the signature is on the first copy's row", await imagesOn(signedB, 2), 1);
  check("and not on the customer's copy", await imagesOn(signedB, 5), 0);
  check(
    "nothing written on the customer's copy",
    itemsOn(scanB, 3).some((item) => item.text.includes("9:05 AM")),
    false,
  );

  const pdtArea = { x0: 427, x1: 444, y0: 614, y1: 620 };
  const before = await lightness(printed, 0, pdtArea);
  const after = await lightness(signedB, 0, pdtArea);
  if (before === null || after === null) {
    console.log("SKIP  WorkMarket's wrapped PDT painted out (pdftoppm is not installed)");
  } else {
    check("WorkMarket's wrapped PDT was there", before < 245, true);
    check("and is painted out", after > 252, true);
  }

  const pdfA = await openWorkOrder(new Uint8Array(lines));
  await drawWorkOrder(pdfA, a.overlay, values(a), signature);
  const scanA = await scanOf(Buffer.from(await pdfA.save()));
  const inA = itemsOn(scanA, 0).find((item) => item.text === "9:05 AM");
  near("on a blank line the time alone, on the line", inA?.y, 633.5 + 0.7 + RULE_LIFT, 0.3);
  check(
    "with no date beside it",
    itemsOn(scanA, 0).some((item) => item.text.includes("09-29-2026 9:05")),
    false,
  );
  check(
    "only the first copy is written on",
    itemsOn(scanA, 2).some((item) => item.text === "9:05 AM"),
    false,
  );

  console.log("\n— a note that does not fit —");
  const font = await (await PDFDocument.create()).embedFont("Helvetica");
  const box = b.overlay.notes;
  const long = Array.from({ length: 16 }, (_, index) => `Step ${index + 1}: replaced the ONT, tested every port and labelled the patch panel.`).join(" ");
  const shrunk = fitNotes(long, font, box);
  check("a long note leaves the lines and shrinks", shrunk.onRules, false);
  check("but is kept whole", shrunk.cut, false);
  const huge = fitNotes(long.repeat(8), font, box);
  check("a note past the smallest size is cut", huge.cut, true);
  check(
    "and says the rest is in the report",
    huge.lines[huge.lines.length - 1]?.endsWith(NOTES_CUT),
    true,
  );
  check(
    "blank lines between paragraphs are not spent on the box",
    fitNotes("First.\n\n\nSecond.", font, box).lines.join("|"),
    "First.|Second.",
  );

  console.log("\n— the rules around it —");
  const twoDays = defaultValues(
    {
      checkIn: { time: "9:05 AM", date: "09-29-2026" },
      checkOut: { time: "1:40 PM", date: "09-30-2026" },
      notes: "",
      name: "",
      date: "09-30-2026",
      signature: null,
    },
    "lines",
  );
  check(
    "a job over two days keeps its dates even on blank lines",
    `${twoDays.checkIn} / ${twoDays.checkOut}`,
    "09-29-2026 9:05 AM / 09-30-2026 1:40 PM",
  );
  check("named after theirs", signedWorkOrderName("2509062645.pdf"), "2509062645-Signed.pdf");
  check("whatever the case of .pdf", signedWorkOrderName("WO 55120.PDF"), "WO 55120-Signed.pdf");
  check("not before the job is closed", workIsDone("IN_PROGRESS"), false);
  check("from the last clock-out on", workIsDone("PENDING_REVIEW"), true);
  check("and after it is sent back", workIsDone("CHANGES_REQUESTED"), true);
  check(
    "a work order we made is not one to sign",
    signableWorkOrder({ jobDocumentKind: "CLIENT_WORK_ORDER", generated: true, mimeType: "application/pdf" }),
    false,
  );
  check(
    "nor a photo of one",
    signableWorkOrder({ jobDocumentKind: "CLIENT_WORK_ORDER", generated: false, mimeType: "image/jpeg" }),
    false,
  );
  check(
    "a filled work-order blank is not a signed work order, its blank deleted or not",
    isSignedWorkOrder({ jobDocumentKind: "CLIENT_WORK_ORDER", generated: true, overlay: null }),
    false,
  );
  check(
    "a signed one is the one that kept where its sign-off went",
    isSignedWorkOrder({ jobDocumentKind: "CLIENT_WORK_ORDER", generated: true, overlay: { pages: [0] } }),
    true,
  );

  // A locked file loads leniently and would save into one nobody can open.
  const locked = await PDFDocument.load(lines);
  locked.context.trailerInfo.Encrypt = locked.context.obj({ Filter: "Standard", V: 1, R: 2 });
  const lockedBytes = await locked.save({ useObjectStreams: false });
  let refusal = "opened";
  try {
    await openWorkOrder(lockedBytes);
  } catch (error) {
    refusal = error instanceof Error ? error.message : String(error);
  }
  check("a locked work order is refused, saying why", refusal, LOCKED_WORK_ORDER);

  await reviewCases(lines, printed, b, values(b));
}

async function reviewCases(lines: Buffer, printed: Buffer, b: WoLayout, valuesB: WoValues) {
  console.log("\n— the copies told apart —");
  {
    const pdf = await PDFDocument.load(printed);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    pdf.getPage(1).drawText("CUSTOMER COPY stays with the store manager.", { x: 46.5, y: 640, size: 9, font });
    const layout = await layoutOf(Buffer.from(await pdf.save()));
    check("a sentence starting 'CUSTOMER COPY' does not end the first copy", layout.overlay.pages.join(","), "0,1,2");
    check("so the signature row is still in reach", layout.found.approval, true);
  }
  {
    const pdf = await PDFDocument.load(lines);
    while (pdf.getPageCount() > 2) pdf.removePage(2);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    pdf.getPage(0).drawText("Customer signature required on this work order.", { x: 46.5, y: 600, size: 9, font });
    const layout = await layoutOf(Buffer.from(await pdf.save()));
    check("a line starting 'Customer signature' is not the signature row", layout.overlay.pages.join(","), "0,1");
    check("the real one is found", `${layout.found.approval} p${layout.overlay.approval.page + 1}`, "true p2");
  }
  {
    const scan = await scanOf(printed);
    check(
      "every page, when somebody chooses it",
      detectWoLayout(scan, { everyPage: true }).overlay.pages.length,
      10,
    );
  }

  console.log("\n— labels and lines drawn other ways —");
  {
    const layout = await layoutOf(
      await casePage(({ text, rule }) => {
        text("ARRIVAL TIME", 426.7, 649.2, { size: 9.8, bold: true, spaced: true });
        rule(430.4, 520.7, 633.5);
        text("AM/PM", 524.4, 638.6);
        text("DEPARTURE TIME", 426.7, 620.3, { size: 9.8, bold: true, spaced: true });
        rule(430.4, 520.7, 604.6);
        text("AM/PM", 524.4, 609.7);
        for (const [x0, x1] of [[46.5, 191.8], [210.6, 355.9], [374.6, 519.9]]) rule(x0, x1, 300, 0.8);
        text("Customer Name (Printed)", 46.5, 291.7, { spaced: true });
        text("Customer Signature", 210.6, 291.7, { spaced: true });
        text("Date", 374.6, 291.7);
      }),
    );
    check("labels set with wide spaces are found: the times", layout.found.times, "lines");
    check("and the signature row", layout.found.approval, true);
  }
  {
    const layout = await layoutOf(
      await casePage(({ text, raw }) => {
        text("Notes", 44.3, 177.1, { size: 11.3, bold: true });
        raw.pushOperators(
          pushGraphicsState(),
          setLineWidth(0.35),
          ...Array.from({ length: 10 }, (_, index) => [
            moveTo(50.3, 153.3 - index * 10.77),
            lineTo(561.8, 153.3 - index * 10.77),
          ]).flat(),
          stroke(),
          popGraphicsState(),
        );
      }),
    );
    check("ruled lines drawn as one path are seen", layout.found.notes, "lines");
    near("at their own spacing", layout.overlay.notes.pitch, 10.77, 0.05);
  }
  {
    const pdf = await PDFDocument.load(lines);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    pdf.getPage(0).drawText("Notes", { x: 46.5, y: 600, size: 9, font });
    const layout = await layoutOf(Buffer.from(await pdf.save()));
    check("a 'Notes' line in the description is passed over", layout.found.notes, "lines");
    near("for the box with the lines", layout.overlay.notes.y, 56.7, 0.5);
  }
  {
    const image = await (async () => {
      const pdf = await PDFDocument.create();
      const picture = await pdf.embedPng(await signaturePng());
      for (let index = 0; index < 3; index++) {
        pdf.addPage([612, 792]).drawImage(picture, { x: 0, y: 0, width: 612, height: 792 });
      }
      return Buffer.from(await pdf.save());
    })();
    check("a scanned work order's pictures are not read for lines", pagesToRead(await scanOf(image)).length, 0);
    check(
      "on theirs, only the pages with something to find",
      pagesToRead(await scanOf(lines)).join(","),
      "0,1",
    );
  }
  {
    const plain = await layoutOf(await plainDocument());
    const boxes = [plain.overlay.times, plain.overlay.notes, plain.overlay.approval];
    check(
      "boxes parked on a one-page document do not sit on each other",
      boxes.some((box, index) => boxes.slice(index + 1).some((other) => overlapping(box, other))),
      false,
    );
  }

  console.log("\n— WorkMarket's own times, and nothing else —");
  {
    const layout = await layoutOf(
      await casePage(({ text, rule }) => {
        text("CHECK IN / OUT TIMES", 46.5, 649.2, { bold: true });
        rule(46.5, 200, 644);
        text("Check-In:", 46.5, 635.3, { bold: true });
        text("9/25/2026 8:57AM PDT", 90, 635.3);
        text("Check-Out:", 46.5, 624.6, { bold: true });
        text("9/25/2026 1:15PM PDT", 97.5, 624.6);
        text("Site contact: Rowan Pike", 230, 635.3);
        text("Store phone: (555) 010-0177", 230, 624.6);
        rule(42, 570, 600);
      }),
    );
    check("their two times painted out", layout.overlay.covers.length, 2);
    check(
      "and not the second column on the same lines",
      layout.overlay.covers.every((cover) => cover.x + cover.width < 230),
      true,
    );
  }
  {
    const layout = await layoutOf(
      await casePage(({ text, rule }) => {
        text("CHECK IN / OUT TIMES", 426.7, 649.2, { bold: true });
        rule(426.7, 565.5, 644);
        text("Check-In:", 426.7, 635.3, { bold: true });
        text("9/25/2026 8:57AM", 470.2, 635.3);
        text("Check-Out:", 426.7, 624.6, { bold: true });
        text("9/25/2026 1:15PM", 477.7, 624.6);
        text("Total: 4.30 hrs", 426.7, 614.1);
        rule(422.2, 570, 607.6);
      }),
    );
    check(
      "a third line under Check-Out is not taken for the end of a time",
      `${layout.overlay.covers.length} ${layout.overlay.covers.every((cover) => cover.y > 615)}`,
      "2 true",
    );
  }

  console.log("\n— letters, long lines, the file —");
  check("Polish letters lose only what the font has not got", toWinAnsi("Łukasz Żółć"), "Lukasz Zólc");
  check("Ukrainian is spelled in Latin letters", toWinAnsi("Олександр Юрченко"), "Oleksandr Yurchenko");
  check("a control character pasted in is left out", toWinAnsi("O\u0092Brien"), "OBrien");
  check(
    "and what prints differently can be said",
    lettersPrintedDifferently("Łukasz").map(({ from, to }) => `${from}>${to}`).join(","),
    "Ł>L",
  );
  {
    const pdf = await openWorkOrder(new Uint8Array(printed));
    await drawWorkOrder(pdf, b.overlay, { ...valuesB, name: "Łukasz Żółć" }, null);
    const scan = await scanOf(Buffer.from(await pdf.save()));
    check("a Polish name is written, not dropped", itemsOn(scan, 2).some((item) => item.text === "Lukasz Zólc"), true);
  }
  {
    const pdf = await openWorkOrder(new Uint8Array(printed));
    const long =
      "Bartholomew-Alexander Montgomery-Fitzwilliam of the Northern Regional Facilities Maintenance Department";
    const drawn = await drawWorkOrder(pdf, b.overlay, { ...valuesB, name: `${long} ${long}` }, null);
    check("a name too long even at the smallest size is cut", drawn.cut.join(","), "name");
    const scan = await scanOf(Buffer.from(await pdf.save()));
    const name = itemsOn(scan, 2).find((item) => item.text.startsWith("Bartholomew"));
    check("and ends saying so", name?.text.endsWith("...") ?? false, true);
    check(
      "short of the signature",
      (name ? name.x + name.width : Infinity) <= b.overlay.approval.x + b.overlay.approval.signatureAt,
      true,
    );
  }
  {
    const source = await PDFDocument.load(printed);
    const copy = await openWorkOrder(new Uint8Array(printed));
    check("the copy keeps the work order's title", copy.getTitle(), source.getTitle());
    check(
      "and when it was made",
      copy.getCreationDate()?.toISOString(),
      source.getCreationDate()?.toISOString(),
    );
    check("its pages counted as they will be written on", await workOrderPageCount(new Uint8Array(printed)), 10);
  }

  console.log("\n— the customer's signature —");
  {
    const pad = await padSignature();
    const ink = await signatureInk(new Uint8Array(pad));
    const meta = ink ? await sharp(Buffer.from(ink)).metadata() : null;
    check("the pad's white is taken away", meta?.hasAlpha, true);
    check("and the picture cut down to the ink", (meta?.width ?? 9999) < 760 && (meta?.height ?? 9999) < 300, true);
    const corner = ink ? (await sharp(Buffer.from(ink)).ensureAlpha().raw().toBuffer())[3] : -1;
    check("round the ink it is clear", corner, 0);
    const blank = await sharp({ create: { width: 300, height: 100, channels: 3, background: "#ffffff" } })
      .png()
      .toBuffer();
    check("a pad saved blank gives no signature", await signatureInk(new Uint8Array(blank)), null);
    check(
      "nor does a damaged file, rather than hanging",
      await signatureInk(new Uint8Array(pad.subarray(0, Math.floor(pad.length / 2)))),
      null,
    );
    const pdf = await openWorkOrder(new Uint8Array(printed));
    const drawn = await drawWorkOrder(pdf, b.overlay, valuesB, ink);
    const bytes = Buffer.from(await pdf.save());
    check("drawn on the row", drawn.signed, true);
    check("on its clear ground, not a white patch", bytes.toString("latin1").includes("/SMask"), true);
  }
}

// ---------------------------------------------------------------------------

async function tokenFor(email: string) {
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  return {
    user,
    token: await encode({
      token: { sub: user.nextcloudSub ?? user.id, userId: user.id },
      secret: process.env.AUTH_SECRET!,
      salt: "authjs.session-token",
      maxAge: 3600,
    }),
  };
}

async function cleanup() {
  const customer = await db.customer.findUnique({ where: { code: CUSTOMER_CODE } });
  const company = await db.client.findFirst({ where: { name: COMPANY }, select: { id: true } });
  await db.job.deleteMany({
    where: {
      OR: [
        ...(customer ? [{ customerId: customer.id }] : []),
        ...(company ? [{ clientId: company.id }] : []),
      ],
    },
  });
  if (customer) await db.customer.delete({ where: { id: customer.id } });
  if (company) {
    // A template holds its file rather than the other way round, so the file
    // is not taken with it when the company goes.
    const templates = await db.clientDocumentTemplate.findMany({
      where: { clientId: company.id },
      select: { attachmentId: true },
    });
    await db.client.delete({ where: { id: company.id } });
    await db.attachment.deleteMany({
      where: { id: { in: templates.map((template) => template.attachmentId) } },
    });
  }
}

/**
 * Pictures of the screens, for a person to look at, when WO_SHOTS names a
 * folder. Not checks: the checks are above and below.
 */
async function shot(page: Page, name: string) {
  const dir = process.env.WO_SHOTS;
  if (!dir) return;
  await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true });
}

/** Whether something shows up within a while, rather than at this instant. */
async function soon(locator: ReturnType<Page["locator"]>, timeout = 15_000): Promise<boolean> {
  try {
    await locator.first().waitFor({ state: "visible", timeout });
    return true;
  } catch {
    return false;
  }
}

async function jobTab(page: Page, name: "Details" | "Notes" | "Deliverables") {
  const button = page.getByRole("tab", { name: new RegExp(`^${name}`) });
  await button.waitFor({ state: "visible", timeout: 15_000 });
  if ((await button.getAttribute("aria-selected")) !== "true") {
    await button.click();
    await page.waitForTimeout(150);
  }
}

/** The page drawn on its canvas, in either layout. */
async function canvasDrawn(page: Page) {
  await page.waitForFunction(
    () => {
      const canvas = document.querySelector("canvas[aria-label^='Page']") as HTMLCanvasElement | null;
      return Boolean(canvas && canvas.width > 100);
    },
    undefined,
    { timeout: 45_000 },
  );
}

/** Waits for a button with exactly this text to be pressable. */
async function enabled(page: Page, label: string, timeout = 20_000) {
  await page.waitForFunction(
    (text) =>
      [...document.querySelectorAll("button")].some(
        (button) => button.textContent?.trim() === text && !button.disabled,
      ),
    label,
    { timeout },
  );
}

/** A phone's screen once it has read the work order and drawn the first place. */
async function readyPhone(page: Page) {
  await canvasDrawn(page);
  await page.getByText(/^Current · 1 of 3$/).waitFor({ timeout: 30_000 });
  await enabled(page, "Next", 30_000);
}

/** A computer's screen once it has read the work order and drawn the page. */
async function readyDesktop(page: Page) {
  await canvasDrawn(page);
  await page.getByText("This is the page as it will be saved").waitFor({ timeout: 30_000 });
}

/** Which place a phone has in front, as it says it. */
async function caption(page: Page): Promise<string> {
  return (await page.getByText(/^(Current · \d of 3|All three checked)$/).first().textContent())?.trim() ?? "";
}

async function pressNext(page: Page) {
  await enabled(page, "Next");
  await page.getByRole("button", { name: "Next", exact: true }).click();
}

async function approve(page: Page) {
  await enabled(page, "Approve", 30_000);
  await page.getByRole("button", { name: "Approve", exact: true }).click();
}

/** Where a box is drawn on the page, as its position on the screen. */
async function boxAt(page: Page, key: string): Promise<string> {
  return page.locator(`[data-box='${key}']`).evaluate((element) => {
    const style = (element as HTMLElement).style;
    return `${style.left} ${style.top}`;
  });
}

/** A drag across a box, as a thumb panning the page would make. */
async function dragAcross(page: Page, key: string, dx: number, dy: number) {
  const box = await page.locator(`[data-box='${key}']`).boundingBox();
  if (!box) return;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 5 });
  await page.mouse.up();
}

/** Two taps on a button's place, 120 ms apart, as a hurried thumb gives them. */
async function doubleTap(page: Page, label: string) {
  await enabled(page, label);
  const box = await page.getByRole("button", { name: label, exact: true }).boundingBox();
  if (!box) throw new Error(`No ${label} button`);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.click(x, y);
  await page.waitForTimeout(120);
  await page.mouse.click(x, y);
  await page.waitForTimeout(300);
}

type Captured = { url: string; headers: Record<string, string>; body: string };

/** The captured save sent again from the page, changed or not; its answer as text. */
async function resend(page: Page, sent: Captured, copies = 1, change?: (body: string) => string) {
  return page.evaluate(
    async ({ request, body, times }) =>
      Promise.all(
        Array.from({ length: times }, async () => {
          const response = await fetch(request.url, {
            method: "POST",
            headers: {
              accept: request.headers.accept ?? "text/x-component",
              "content-type": request.headers["content-type"],
              "next-action": request.headers["next-action"],
              "next-router-state-tree": request.headers["next-router-state-tree"] ?? "",
            },
            body,
          });
          return { status: response.status, text: await response.text() };
        }),
      ),
    { request: sent, body: change ? change(sent.body) : sent.body, times: copies },
  );
}

/** On a computer, every place applied in turn. */
async function applyAll(page: Page) {
  for (let index = 0; index < 3; index++) {
    const button = page.getByRole("button", { name: "Apply", exact: true }).first();
    if ((await button.count()) === 0) break;
    await enabled(page, "Apply");
    await button.click();
  }
}

/** The zoom the page is shown at: written beside the buttons on a computer, said by them on a phone. */
async function zoomShown(page: Page): Promise<string> {
  const said = await page.getByRole("button", { name: /^Zoom in, now/ }).first().getAttribute("aria-label").catch(() => null);
  if (said) return /now (\d+%)/.exec(said)?.[1] ?? "";
  return (await page.getByText(/^\d+%$/).first().textContent())?.trim() ?? "";
}

/** How tall the page's frame is on the screen. */
async function frameHeight(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      (document.querySelector("canvas[aria-label^='Page']")?.closest(".overflow-auto") as HTMLElement | null)
        ?.clientHeight ?? 0,
  );
}

/** The page's frame, as the screen lays it out. */
async function frameScroll(page: Page) {
  return page.evaluate(() => {
    const scroller = document
      .querySelector("canvas[aria-label^='Page']")
      ?.closest(".overflow-auto") as HTMLElement | null;
    return scroller
      ? {
          sideways: scroller.scrollWidth - scroller.clientWidth,
          left: scroller.scrollLeft,
          top: scroller.scrollTop,
        }
      : null;
  });
}

async function scrollFrameTo(page: Page, left: number, top: number) {
  await page.evaluate(
    ([x, y]) => {
      const scroller = document
        .querySelector("canvas[aria-label^='Page']")
        ?.closest(".overflow-auto") as HTMLElement | null;
      scroller?.scrollTo({ left: x, top: y });
    },
    [left, top],
  );
}

/** The last one out, through the whole checkout, as a tech does it. */
async function clockOutThroughWizard(page: Page) {
  await page.getByRole("button", { name: "Clock out", exact: true }).click();
  await page.waitForSelector("text=Step 1 of 6", { timeout: 15_000 });
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Completed" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByText("No release code for this job").click();
  await page.getByRole("button", { name: "Continue" }).click();
  const modName = page.locator("#mod-name");
  if (await modName.count()) await modName.fill("Dana Reyes");
  else await page.locator("#mod-picker").selectOption({ index: 0 });
  await drawSignature(page);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForSelector("text=Signing as", { timeout: 30_000 });
  await drawSignature(page);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Clock out now" }).click();
  await page.getByText("Clocked out. The job is closed.").waitFor({ timeout: 30_000 });
}

async function drawSignature(page: Page) {
  const canvas = page.locator("canvas").first();
  await canvas.waitFor({ timeout: 15_000 });
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Signature pad has no box");
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + 20, y);
  await page.mouse.down();
  for (let step = 1; step <= 6; step++) {
    await page.mouse.move(box.x + 20 + (box.width - 40) * (step / 6), y + (step % 2 === 0 ? -18 : 18));
  }
  await page.mouse.up();
}

async function online(browser: Browser) {
  console.log("\n— on the job —");

  const boss = await tokenFor("boss@417group.org");
  const tech = await tokenFor("tech@417group.org");
  await cleanup();

  const company = await db.client.create({ data: { name: COMPANY } });
  const customer = await db.customer.create({
    data: { name: "Quill & Ivy Market", code: CUSTOMER_CODE },
  });
  const site = await db.site.create({
    data: {
      customerId: customer.id,
      siteNumber: "12",
      addressLine1: "400 Example Avenue",
      city: "Lodi",
      state: "CA",
      postalCode: "95240",
      timeZone: LA,
    },
  });

  const now = new Date();
  const today = zonedParts(now, LA);
  const at = (hour: number, minute = 0) =>
    zonedWallTime(today.year, today.month, today.day, hour, minute, LA);
  const date = usDateInZone(at(12), LA);

  let sequence = 7000 + Math.floor(Math.random() * 900);
  async function job(
    title: string,
    options: {
      lifecycle: "IN_PROGRESS" | "PENDING_REVIEW";
      workOrder?: "lines" | "printed";
      open?: boolean;
      signed?: boolean | "unreadable";
      /** The company's own sign-off blank on the job, mapped and still empty. */
      blank?: boolean;
      /** A sign-off sheet attached already signed, by hand. */
      signOffAttached?: boolean;
    },
  ) {
    sequence += 1;
    const created = await db.job.create({
      data: {
        intWoId: `WOSO-${sequence}`,
        intWoSequence: sequence,
        title,
        clientId: company.id,
        customerId: customer.id,
        siteId: site.id,
        createdById: boss.user.id,
        scheduledStart: at(9),
        lifecycle: options.lifecycle,
        outcome: options.lifecycle === "PENDING_REVIEW" ? "COMPLETED" : null,
        workPerformedMerged: NOTE,
        // Nothing to photograph, so a checkout here is about the paperwork.
        deliverablesOwn: true,
        deliverableRules: {
          create: [
            { category: "PRE_INSTALL", enabled: false },
            { category: "POST_INSTALL", enabled: false },
          ],
        },
      },
    });
    const assignment = await db.jobAssignment.create({
      data: { jobId: created.id, userId: tech.user.id, isLead: true, payType: "HOURLY" },
    });
    await db.visit.create({
      data: {
        assignmentId: assignment.id,
        clockInAt: options.open ? new Date(now.getTime() - 3 * 3600_000) : at(9, 5),
        clockOutAt: options.open ? null : at(13, 40),
        clockOutSource: options.open ? null : "NOW",
      },
    });
    const contact = await db.pointOfContact.create({
      data: { jobId: created.id, type: "MOD", name: "Dana Reyes" },
    });
    if (options.signed) {
      const stored = await storeFile(
        created.id,
        options.signed === "unreadable" ? Buffer.from("not a picture at all") : await signaturePng(),
        "image/png",
      );
      const file = await db.attachment.create({
        data: {
          storagePath: stored.storagePath,
          originalName: "signature.png",
          mimeType: "image/png",
          sizeBytes: stored.sizeBytes,
          uploadedById: tech.user.id,
        },
      });
      await db.signature.create({
        data: {
          jobId: created.id,
          kind: "MOD",
          pointOfContactId: contact.id,
          signerName: "Dana Reyes",
          attachmentId: file.id,
          signedAt: at(13, 38),
        },
      });
    }
    let workOrderId: string | null = null;
    if (options.workOrder) {
      const bytes = await workMarketOrder(options.workOrder);
      const stored = await storeFile(created.id, bytes, "application/pdf");
      workOrderId = (
        await db.attachment.create({
          data: {
            storagePath: stored.storagePath,
            originalName: options.workOrder === "printed" ? "2600000001.pdf" : "2600000002.pdf",
            mimeType: "application/pdf",
            sizeBytes: stored.sizeBytes,
            uploadedById: boss.user.id,
            jobDocumentId: created.id,
            jobDocumentKind: "CLIENT_WORK_ORDER",
          },
        })
      ).id;
    }
    if (options.blank) {
      const template = await companyBlank();
      const stored = await storeFile(created.id, await plainDocument(), "application/pdf");
      await db.attachment.create({
        data: {
          storagePath: stored.storagePath,
          originalName: "WOSO sign-off.pdf",
          mimeType: "application/pdf",
          sizeBytes: stored.sizeBytes,
          uploadedById: boss.user.id,
          jobDocumentId: created.id,
          jobDocumentKind: "SIGN_OFF",
          sourceTemplateId: template,
        },
      });
    }
    if (options.signOffAttached) {
      const stored = await storeFile(created.id, await plainDocument(), "application/pdf");
      await db.attachment.create({
        data: {
          storagePath: stored.storagePath,
          originalName: "Signed sheet scan.pdf",
          mimeType: "application/pdf",
          sizeBytes: stored.sizeBytes,
          uploadedById: tech.user.id,
          jobDocumentId: created.id,
          jobDocumentKind: "SIGN_OFF",
        },
      });
    }
    return { id: created.id, workOrderId };
  }

  /** The company's sign-off blank, with one box that fills itself. */
  let blankId: string | null = null;
  async function companyBlank(): Promise<string> {
    if (blankId) return blankId;
    const stored = await storeFile("templates", await plainDocument(), "application/pdf");
    const file = await db.attachment.create({
      data: {
        storagePath: stored.storagePath,
        originalName: "WOSO sign-off.pdf",
        mimeType: "application/pdf",
        sizeBytes: stored.sizeBytes,
        uploadedById: boss.user.id,
      },
    });
    const template = await db.clientDocumentTemplate.create({
      data: {
        clientId: company.id,
        kind: "SIGN_OFF",
        label: "WOSO sign-off",
        attachmentId: file.id,
        boxSource: "DRAWN",
        pageCount: 1,
        pageWidth: 612,
        pageHeight: 792,
        placements: {
          create: [{ page: 0, x: 60, y: 600, width: 200, height: 18, source: "job.title" }],
        },
      },
    });
    blankId = template.id;
    return template.id;
  }

  const openJob = await job("WOSO Still on site", { lifecycle: "IN_PROGRESS", workOrder: "printed", open: true });
  const closedJob = await job("WOSO Closed", { lifecycle: "PENDING_REVIEW", workOrder: "printed", signed: true });
  const unreadableJob = await job("WOSO Unreadable signature", {
    lifecycle: "PENDING_REVIEW",
    workOrder: "lines",
    signed: "unreadable",
  });
  const checkoutJob = await job("WOSO Checkout", { lifecycle: "IN_PROGRESS", workOrder: "lines", open: true });
  const checkoutBoth = await job("WOSO Checkout both", {
    lifecycle: "IN_PROGRESS",
    workOrder: "lines",
    open: true,
    blank: true,
  });
  const checkoutSigned = await job("WOSO Checkout signed", {
    lifecycle: "IN_PROGRESS",
    workOrder: "lines",
    open: true,
    blank: true,
    signOffAttached: true,
  });

  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addCookies([{ name: "authjs.session-token", value: tech.token, url: BASE }]);
  const page = await context.newPage();

  // --- before the job is closed ---------------------------------------------
  await page.goto(`${BASE}/jobs/${openJob.id}`, { waitUntil: "domcontentloaded" });
  await jobTab(page, "Deliverables");
  const early = page.getByRole("button", { name: "Use WM WO as a Sign-Off" });
  check("the button is in the Sign-off block before the job is closed", await early.count(), 1);
  check("but says it cannot be pressed", await early.getAttribute("aria-disabled"), "true");
  // aria-disabled, not disabled: a person can still press it and be told
  // why. Playwright will not press it, so the click is sent to it directly.
  await early.scrollIntoViewIfNeeded();
  await early.dispatchEvent("click");
  check(
    "and pressed, says why",
    await soon(page.getByRole("alert").filter({ hasText: "Not yet" })),
    true,
  );
  await page.goto(`${BASE}/jobs/${openJob.id}/wo-sign-off`, { waitUntil: "domcontentloaded" });
  check(
    "the page refuses too, opened by its address",
    await page.getByRole("alert").filter({ hasText: "once the job is closed" }).isVisible(),
    true,
  );

  // --- a closed job, on a phone: one place at a time --------------------------
  await page.goto(`${BASE}/jobs/${closedJob.id}`, { waitUntil: "domcontentloaded" });
  await jobTab(page, "Deliverables");
  await shot(page, "job-signoff-block-phone");
  await page.getByRole("link", { name: "Use WM WO as a Sign-Off" }).click();
  await page.waitForURL(/\/wo-sign-off/, { timeout: 15_000 });
  await readyPhone(page);

  check("one place at a time, the times first", await caption(page), "Current · 1 of 3");
  check(
    "it says WorkMarket's own times are painted over",
    await page.getByText("WorkMarket's own times are painted over").isVisible(),
    true,
  );
  check(
    "what goes there, read before anything is opened",
    (await page.getByText(`${date} 9:05 AM`, { exact: true }).count()) === 1 &&
      (await page.getByText(`${date} 1:40 PM`, { exact: true }).count()) === 1,
    true,
  );
  check("the page takes most of the screen", (await frameHeight(page)) >= 844 * 0.45, true);
  check("brought as close as the times go", await zoomShown(page), "300%");
  check("Back has nothing before the first place", await page.getByRole("button", { name: "Back", exact: true }).isDisabled(), true);
  check("Approve waits for the last place", await page.getByRole("button", { name: "Approve", exact: true }).count(), 0);
  await shot(page, "wo-phone-times");

  // Nothing on the page moves without Edit: a thumb panning the page used to
  // be a thumb dragging whichever box it landed on.
  const where = await boxAt(page, "times");
  await dragAcross(page, "times", 0, -40);
  check("a box does not move without Edit", await boxAt(page, "times"), where);

  await page.getByRole("button", { name: "Edit", exact: true }).click();
  check("Edit opens what is written: check-in with its date, on the site's clock", await page.locator("#wo-check-in").inputValue(), `${date} 9:05 AM`);
  check("check-out", await page.locator("#wo-check-out").inputValue(), `${date} 1:40 PM`);
  check(
    "WorkMarket's own times can be left unpainted",
    await page.getByLabel("Paint over WorkMarket’s own times").isChecked(),
    true,
  );
  await page.getByRole("button", { name: "Up a point" }).click();
  check("and with Edit the box moves", (await boxAt(page, "times")) !== where, true);
  await shot(page, "wo-phone-edit");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  check("Done puts the editing away", await page.locator("#wo-check-in").count(), 0);

  // Two taps on Next in quick succession: the second used to go straight
  // through the notes, unseen.
  await doubleTap(page, "Next");
  check("a double tap on Next moves on one place, not two", await caption(page), "Current · 2 of 3");
  check("Next moves on to the notes", await caption(page), "Current · 2 of 3");
  check("the page with it, the notes shown whole across", await zoomShown(page), "100%");
  check("and the times are applied", (await page.locator("ol[aria-label='The three places'] li").first().textContent())?.includes("applied"), true);
  check("Back is there now", await page.getByRole("button", { name: "Back", exact: true }).isDisabled(), false);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  check("the work performed", await page.locator("#wo-notes").inputValue(), NOTE);
  check("its line spacing can be set", await page.getByRole("button", { name: "Lines further apart" }).count(), 1);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await pressNext(page);
  check("then the signature row", await caption(page), "Current · 3 of 3");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  check("who signed", await page.locator("#wo-name").inputValue(), "Dana Reyes");
  check("the day they signed", await page.locator("#wo-date").inputValue(), date);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  // On the last place the second tap used to land on Approve and save.
  await doubleTap(page, "Next");
  await page.waitForTimeout(800);
  check("a double tap on the last Next does not save", page.url().includes("/wo-sign-off"), true);
  check(
    "nothing was saved by it",
    await db.attachment.count({ where: { jobDocumentId: closedJob.id, signedFromId: closedJob.workOrderId } }),
    0,
  );
  check("after the last place, Approve", await soon(page.getByRole("button", { name: "Approve", exact: true })), true);
  check("and only then", await caption(page), "All three checked");
  await shot(page, "wo-phone-approve");
  check("one pdf.js worker for the whole screen, however often it redraws", page.workers().length, 1);

  // The save request lost on the way: the screen used to give way to Next's
  // error page, and everything typed and applied with it.
  const isScreen = (url: URL) => url.pathname.endsWith("/wo-sign-off");
  const drop = (route: import("playwright").Route) =>
    route.request().method() === "POST" ? route.abort("internetdisconnected") : route.continue();
  await page.route(isScreen, drop);
  await approve(page);
  check(
    "a dropped connection while saving says so",
    await soon(page.getByRole("alert").filter({ hasText: "connection dropped" })),
    true,
  );
  check("and stays where it was, ready to approve again", await soon(page.getByRole("button", { name: "Approve", exact: true })), true);
  await page.unroute(isScreen, drop);

  // Approved: saved, and straight back to the job. The request is kept, to be
  // sent twice at once below.
  let captured: { url: string; headers: Record<string, string>; body: string } | null = null;
  const capture = async (route: import("playwright").Route) => {
    const request = route.request();
    if (request.method() === "POST" && !captured) {
      captured = { url: request.url(), headers: request.headers(), body: request.postData() ?? "" };
    }
    await route.continue();
  };
  await page.route(isScreen, capture);
  await approve(page);
  await page.waitForURL(new RegExp(`/jobs/${closedJob.id}\\?signed=`), { timeout: 30_000 });
  await page.unroute(isScreen, capture);
  check("back on the job, it says it was saved", await soon(page.getByText("Signed work order saved")), true);
  check("naming the copy", await page.getByText("2600000001-Signed.pdf, with the work orders.").isVisible(), true);
  await shot(page, "job-saved-phone");
  await page.waitForTimeout(500);
  check("leaving the screen lets its worker go", page.workers().length, 0);

  const copies = await db.attachment.findMany({
    where: { jobDocumentId: closedJob.id, signedFromId: closedJob.workOrderId },
    select: { id: true, originalName: true, jobDocumentKind: true, generated: true, storagePath: true },
  });
  check("one signed copy", copies.length, 1);
  check("named after theirs", copies[0]?.originalName, "2600000001-Signed.pdf");
  check("kept with the work orders", copies[0]?.jobDocumentKind, "CLIENT_WORK_ORDER");
  check("as one we made", copies[0]?.generated, true);
  check(
    "and the original stays",
    await db.attachment.count({ where: { id: closedJob.workOrderId! } }),
    1,
  );
  if (copies[0]) {
    const kept = await readFile(absolutePath(copies[0].storagePath));
    const scan = await scanOf(kept);
    near(
      "the saved file has the check-in a point higher, as nudged",
      itemsOn(scan, 0).find((item) => item.text === `${date} 9:05 AM`)?.y,
      636.3,
      0.3,
    );
    check("the signature on it", await imagesOn(kept, 2), 1);
    check(
      "and the name",
      itemsOn(scan, 2).some((item) => item.text === "Dana Reyes"),
      true,
    );
  }
  check(
    "the change is on the job's history",
    await db.auditEvent.count({
      where: { jobId: closedJob.id, detail: { path: ["field"], equals: "Signed work order" } },
    }),
    1,
  );

  if (copies[0]) {
    await page.goto(`${BASE}/jobs/${closedJob.id}?signed=${copies[0].id}&note=unsigned,notes-cut`, {
      waitUntil: "domcontentloaded",
    });
    check(
      "the notice says when it went without a signature",
      await soon(page.getByText("It went without a customer signature")),
      true,
    );
    check("and when the notes were cut", await page.getByText("The notes were cut short to fit").isVisible(), true);
  }
  for (const odd of ["note=a&note=b", "signed=x&signed=y", "note=toString,constructor,__proto__"]) {
    const response = await page.goto(`${BASE}/jobs/${closedJob.id}?${odd}`, { waitUntil: "domcontentloaded" });
    check(`an address with ${odd} still opens the job`, response?.status(), 200);
  }

  // Two saves at the same moment — a double tap, two phones — each used to
  // find no copy to replace and leave one of its own.
  const request = captured as Captured | null;
  if (request) {
    const answers = await resend(page, request, 2);
    // Answered, each of them, and each answer one of the two a person can be
    // given: saved, or told a save of the same work order was running.
    check(
      "two saves at the same moment are both answered",
      answers.every(
        (answer) =>
          answer.status === 200 &&
          (answer.text.includes('"ok":true') || answer.text.includes("being saved more than once")),
      ),
      true,
    );
    check(
      "and leave one signed copy",
      await db.attachment.count({ where: { jobDocumentId: closedJob.id, signedFromId: closedJob.workOrderId } }),
      1,
    );

    // What the server holds the page to, whatever the page sends.
    const [fewer] = await resend(page, request, 1, (body) => body.replace('"pageCount":10', '"pageCount":9'));
    check("a page count that differs from the file is refused as damaged", fewer.text.includes("damaged"), true);
    const [gap] = await resend(page, request, 1, (body) => body.replace('"pages":[0,1,2]', '"pages":[0,2]'));
    check("pages with a gap are refused", gap.text.includes("could not be read"), true);
    const [spread] = await resend(page, request, 1, (body) =>
      body.replace(
        '"covers":[',
        '"covers":[{"page":0,"x":36,"y":300,"width":300,"height":30},{"page":0,"x":36,"y":500,"width":300,"height":30},',
      ),
    );
    check("white patches spread over the page are refused", spread.text.includes("could not be read"), true);
    check(
      "and none of those saved anything",
      await db.attachment.count({ where: { jobDocumentId: closedJob.id, signedFromId: closedJob.workOrderId } }),
      1,
    );
  } else {
    check("the save was seen on its way", false, true);
  }

  // The preview's signature: the ink alone, to whoever may sign it off.
  const ink = await page.request.get(`${BASE}/api/jobs/${closedJob.id}/wo-signature`);
  check("the preview's signature comes as a picture", `${ink.status()} ${ink.headers()["content-type"]}`, "200 image/png");
  const none = await page.request.get(`${BASE}/api/jobs/${checkoutJob.id}/wo-signature`);
  check("and as nothing where none was captured", none.status(), 404);
  let duplicate: string | null = null;
  try {
    await db.attachment.create({
      data: {
        storagePath: "nowhere.pdf",
        originalName: "second.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1,
        uploadedById: tech.user.id,
        jobDocumentId: closedJob.id,
        jobDocumentKind: "CLIENT_WORK_ORDER",
        generated: true,
        signedFromId: closedJob.workOrderId,
      },
    });
  } catch (error) {
    duplicate = (error as { code?: string }).code ?? "error";
  }
  check("the database holds one signed copy per work order", duplicate, "P2002");

  // --- a signature that cannot be read ---------------------------------------
  const unreadable = await page.request.get(`${BASE}/api/jobs/${unreadableJob.id}/wo-signature`);
  check("a damaged signature file is said to be unreadable, not served", unreadable.status(), 422);
  await page.goto(`${BASE}/jobs/${unreadableJob.id}/wo-sign-off`, { waitUntil: "domcontentloaded" });
  await readyPhone(page);
  await pressNext(page);
  await pressNext(page);
  check(
    "the signature row says the one on the job could not be read",
    await page.getByText("The signature captured on this job could not be read").isVisible(),
    true,
  );
  check("and its summary says so too", await page.getByText("Could not be read", { exact: true }).isVisible(), true);

  // --- again: replaced, not added, and what was typed is remembered ----------
  await page.goto(`${BASE}/jobs/${closedJob.id}/wo-sign-off`, { waitUntil: "domcontentloaded" });
  await readyPhone(page);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.locator("#wo-check-in").fill(`${date} 9:06 AM`);
  check("Next waits for the page to be redrawn", await page.getByRole("button", { name: "Next", exact: true }).isDisabled(), true);
  check(
    "typed over, it offers the job's own back",
    await page.getByRole("button", { name: "Back to the job’s times" }).isVisible(),
    true,
  );
  await pressNext(page);
  await pressNext(page);
  await pressNext(page);
  check(
    "the last step says the copy on the job is replaced",
    await page.getByText("The signed copy already on the job is replaced.").isVisible(),
    true,
  );
  // Held for a moment on the way, so the screen can be looked at mid-save.
  const slow = async (route: import("playwright").Route) => {
    if (route.request().method() === "POST") await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
  };
  await page.route(isScreen, slow);
  await approve(page);
  check("nothing can be pressed while it saves", await page.getByRole("button", { name: "Back", exact: true }).isDisabled(), true);
  await page.waitForURL(/\?signed=/, { timeout: 30_000 });
  await page.unroute(isScreen, slow);
  check(
    "still one signed copy",
    await db.attachment.count({ where: { jobDocumentId: closedJob.id, signedFromId: closedJob.workOrderId } }),
    1,
  );
  await page.goto(`${BASE}/jobs/${closedJob.id}/wo-sign-off`, { waitUntil: "domcontentloaded" });
  await readyPhone(page);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  check("what was typed comes back", await page.locator("#wo-check-in").inputValue(), `${date} 9:06 AM`);
  check("what was not follows the job", await page.locator("#wo-check-out").inputValue(), `${date} 1:40 PM`);
  await page.getByRole("button", { name: "Done", exact: true }).click();

  // --- refused on saving once the job is open again ---------------------------
  await db.job.update({ where: { id: closedJob.id }, data: { lifecycle: "IN_PROGRESS" } });
  await pressNext(page);
  await pressNext(page);
  await pressNext(page);
  await approve(page);
  await page.getByRole("alert").filter({ hasText: "Not yet" }).waitFor({ timeout: 20_000 });
  check("the server refuses a job that is open again", true, true);
  await db.job.update({ where: { id: closedJob.id }, data: { lifecycle: "PENDING_REVIEW" } });

  // --- on the job page ------------------------------------------------------
  await page.goto(`${BASE}/jobs/${closedJob.id}`, { waitUntil: "domcontentloaded" });
  check(
    "the signed copy is with the work orders",
    await page.getByRole("link", { name: "2600000001-Signed.pdf" }).count() >= 1,
    true,
  );
  check("and the original beside it", await page.getByRole("link", { name: "2600000001.pdf", exact: true }).count(), 1);
  check("without the saved notice when nothing was just saved", await page.getByText("Signed work order saved").count(), 0);

  // --- 320 px ----------------------------------------------------------------
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto(`${BASE}/jobs/${closedJob.id}/wo-sign-off`, { waitUntil: "domcontentloaded" });
  await readyPhone(page);
  check(
    "fits a 320 px screen",
    await page.evaluate(() => document.documentElement.scrollWidth <= 320),
    true,
  );
  const tops = await Promise.all(
    ["Back", "Edit", "Next"].map(async (name) =>
      Math.round((await page.getByRole("button", { name, exact: true }).boundingBox())?.y ?? -1),
    ),
  );
  check("Back, Edit and Next side by side", new Set(tops).size === 1 && tops[0] >= 0, true);
  await shot(page, "wo-page-320");
  for (const [width, height] of [[320, 568], [390, 667]]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(400);
    const next = await page.getByRole("button", { name: "Next", exact: true }).boundingBox();
    const bar = await page.locator("nav.fixed").first().boundingBox();
    check(
      `on a ${width}×${height} phone Next stays above the tab bar`,
      Boolean(next && bar && next.y + next.height <= bar.y + 1 && next.y >= 0),
      true,
    );
  }

  // --- a computer: the page and the three beside it ---------------------------
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto(`${BASE}/jobs/${closedJob.id}/wo-sign-off`, { waitUntil: "domcontentloaded" });
  await readyDesktop(page);
  check(
    "at 1024 px the page and the three beside it fit, with no sideways scroll",
    await page.evaluate(() => document.documentElement.scrollWidth <= 1024),
    true,
  );
  await shot(page, "wo-page-1024");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE}/jobs/${closedJob.id}/wo-sign-off`, { waitUntil: "domcontentloaded" });
  await readyDesktop(page);
  check("on a computer the three are beside the page, each with Show", await page.getByRole("button", { name: "Show", exact: true }).count(), 3);
  check("and Apply", await page.getByRole("button", { name: "Apply", exact: true }).count(), 3);
  check("and no steps", await page.getByRole("button", { name: "Next", exact: true }).count(), 0);
  check(
    "it is not saved before each is applied",
    await page.getByRole("button", { name: "Replace the signed work order" }).isDisabled(),
    true,
  );
  const showTimes = page
    .locator('section[aria-label="Check-in and check-out"]')
    .getByRole("button", { name: "Show", exact: true });
  await showTimes.click();
  check("Show brings the times as close as they go", await zoomShown(page), "300%");
  // Pressed a second time with nothing else changed, it used to do nothing.
  await scrollFrameTo(page, 0, 0);
  await showTimes.click();
  await page.waitForTimeout(200);
  check("pressed again, it brings the box back into view", ((await frameScroll(page))?.left ?? 0) > 0, true);
  await page
    .locator('section[aria-label="Notes"]')
    .getByRole("button", { name: "Show", exact: true })
    .click();
  check("a box as wide as the notes is shown whole across", await zoomShown(page), "100%");
  await applyAll(page);
  check("applied, each says so", await page.getByRole("button", { name: "Applied — undo" }).count(), 3);
  await shot(page, "wo-page-desktop");
  await enabled(page, "Replace the signed work order", 30_000);
  await page.getByRole("button", { name: "Replace the signed work order" }).click();
  await page.waitForURL(/\?signed=/, { timeout: 30_000 });
  check("on a computer too it goes back to the job and says so", await soon(page.getByText("Signed work order saved")), true);
  if (process.env.WO_SHOTS) {
    await page.goto(`${BASE}/jobs/${closedJob.id}/wo-sign-off`, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      try {
        localStorage.setItem("quicktec-theme", "light");
      } catch {}
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await readyDesktop(page);
    await shot(page, "wo-page-desktop-light");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload({ waitUntil: "domcontentloaded" });
    await readyPhone(page);
    await shot(page, "wo-phone-light");
    await page.evaluate(() => {
      try {
        localStorage.removeItem("quicktec-theme");
      } catch {}
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });

  // --- an iPhone's browser ----------------------------------------------------
  // Every browser on an iPhone is WebKit, and WebKit cannot walk a
  // ReadableStream with `for await`, which is how pdf.js reads a page's text.
  // The screen worked on a desktop and on the owner's phone said "undefined is
  // not a function (near '...t of e...')". Only Chromium is installed here, so
  // the phone is played by Chromium with that one ability taken away.
  // Taken away inside pdf.js's worker as well, which an init script does not
  // reach: its script is rewritten on the way in, and the app's own service
  // worker is kept out so the rewrite is not served round from its cache.
  const iphone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    serviceWorkers: "block",
  });
  await iphone.addCookies([{ name: "authjs.session-token", value: tech.token, url: BASE }]);
  await iphone.addInitScript(() => {
    const stream = ReadableStream.prototype as unknown as Record<PropertyKey, unknown>;
    delete stream[Symbol.asyncIterator];
    delete stream.values;
  });
  let workerRewritten = false;
  await iphone.route(/pdf\.worker[^/]*\.m?js(\?.*)?$/, async (route) => {
    const response = await route.fetch();
    workerRewritten = true;
    await route.fulfill({
      response,
      body:
        "try{delete ReadableStream.prototype[Symbol.asyncIterator];delete ReadableStream.prototype.values;}catch(e){}\n" +
        (await response.text()),
    });
  });
  const onIphone = await iphone.newPage();
  await onIphone.goto(`${BASE}/jobs/${closedJob.id}/wo-sign-off`, { waitUntil: "domcontentloaded" });
  check(
    "reads the work order where streams cannot be walked, as on an iPhone",
    await soon(onIphone.getByText(/^Current · 1 of 3$/), 45_000),
    true,
  );
  check(
    "and does not say it could not",
    await onIphone.getByText("could not be read here").count(),
    0,
  );
  check("with the worker played as an iPhone's too", workerRewritten, true);
  await iphone.close();

  // --- offered at the last clock-out ------------------------------------------
  // Their blank on the job and empty: both are offered.
  await page.goto(`${BASE}/jobs/${checkoutBoth.id}`, { waitUntil: "domcontentloaded" });
  await clockOutThroughWizard(page);
  check(
    "with their blank empty, the card offers the sheet and the work order",
    (await page.getByRole("link", { name: "Fill in the sign-off sheet" }).count()) === 1 &&
      (await page.getByRole("link", { name: "Use WM WO as a Sign-Off" }).count()) >= 1,
    true,
  );
  check(
    "and says both",
    await page.getByText("their sign-off sheet, and their work order as well").isVisible(),
    true,
  );

  // A sign-off attached already: the work order, and not the blank again.
  await page.goto(`${BASE}/jobs/${checkoutSigned.id}`, { waitUntil: "domcontentloaded" });
  await clockOutThroughWizard(page);
  check(
    "with a sign-off on the job, it is the work order that is offered",
    await page.getByText("A sign-off is on the job already").isVisible(),
    true,
  );
  check(
    "and not their blank again",
    await page.getByRole("link", { name: "Fill in the sign-off sheet" }).count(),
    0,
  );

  await page.goto(`${BASE}/jobs/${checkoutJob.id}`, { waitUntil: "domcontentloaded" });
  await clockOutThroughWizard(page);
  check(
    "with no sheet of their own, the work order is offered",
    await page.getByRole("link", { name: "Use WM WO as a Sign-Off" }).first().isVisible(),
    true,
  );
  await shot(page, "after-checkout-phone");
  check(
    "the hours stay in view under it",
    await soon(page.getByText(/You have worked this job/i)),
    true,
  );
  await page.getByRole("link", { name: "Use WM WO as a Sign-Off" }).first().click();
  await page.waitForURL(/\/wo-sign-off/, { timeout: 15_000 });
  await readyPhone(page);
  check(
    "blank lines found on that one",
    await page.getByText("On the blank Arrival and Departure lines.").isVisible(),
    true,
  );
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  check(
    "and its time is the time alone",
    /^\d{1,2}:\d{2} [AP]M$/.test(await page.locator("#wo-check-in").inputValue()),
    true,
  );

  await context.close();
  await cleanup();
}

async function main() {
  await offline();
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
  });
  try {
    await online(browser);
  } finally {
    await browser.close();
  }
  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
  await db.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});

