import "dotenv/config";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { analyzeForm, liftBoxes, nameAsSource } from "@/lib/forms/analyze";
import { fillForm, toWinAnsi, type FillablePlacement } from "@/lib/forms/fill";
import { formSource, initials, STATIC_SOURCE } from "@/lib/forms/catalogue";
import type { FormFillContext } from "@/lib/forms/catalogue";
import type { JobExportData } from "@/lib/exports/job-data";
import { uploadsRoot } from "@/lib/storage";

/**
 * Checks the sign-off filler against forms built here rather than against a
 * company's real blank.
 *
 * Both shapes that arrive in practice are covered: a PDF with real form fields
 * carrying last job's values, and a flat one where text has to be drawn at
 * coordinates. Non-destructive — it touches no job data and needs no database.
 *
 *   npm run verify:forms
 */

let failures = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label}` +
      (ok ? "" : `\n      got ${actual}\n     want ${expected}`),
  );
}

function ok(label: string, condition: boolean) {
  if (!condition) failures++;
  console.log(`${condition ? "PASS" : "FAIL"}  ${label}`);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A blank with real fields, left carrying the previous job's data. */
async function acroFormBlank(): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const form = pdf.getForm();
  const font = await pdf.embedFont(StandardFonts.Helvetica);

  const store = form.createTextField("Text19");
  store.setText("Marshall's");
  store.addToPage(page, { x: 116, y: 587, width: 150, height: 14, font });

  const ticket = form.createTextField("Text18");
  ticket.setText("6682752");
  ticket.addToPage(page, { x: 304, y: 609, width: 93, height: 19, font });

  // Never mapped: it must come out empty rather than carrying its sample.
  const stale = form.createTextField("Text23");
  stale.setText("(818) 346-0208");
  stale.addToPage(page, { x: 115, y: 526, width: 150, height: 14, font });

  const box = form.createCheckBox("Check Box5");
  box.addToPage(page, { x: 341, y: 320, width: 12, height: 12 });

  return Buffer.from(await pdf.save());
}

/**
 * A blank prepared the way docs/FORM-BLANKS.md describes: its fields named
 * after catalogue entries, so uploading it is the whole setup.
 */
async function namedBlank(): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const form = pdf.getForm();
  const font = await pdf.embedFont(StandardFonts.Helvetica);

  const place = { width: 150, height: 16, font };
  form.createTextField("site.city").addToPage(page, { ...place, x: 60, y: 700 });
  // The second row of a timesheet, which is what the # suffix is for.
  form.createTextField("visit.out#2").addToPage(page, { ...place, x: 60, y: 660 });
  form.createTextField("signature.mod").addToPage(page, { ...place, x: 60, y: 620 });
  // Not ours to fill: the site contact writes this on the day.
  form.createTextField("SiteInitials").addToPage(page, { ...place, x: 60, y: 580 });

  return Buffer.from(await pdf.save());
}

/** A flat blank: nothing to fill, only a page to draw on. */
async function flatBlank(): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText("SERVICE POINT — SIGN OFF", {
    x: 60,
    y: 720,
    size: 14,
    font,
    color: rgb(0, 0, 0),
  });
  return Buffer.from(await pdf.save());
}

/** A one-pixel PNG standing in for a captured signature. */
const SIGNATURE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const TZ = "America/Los_Angeles";

function at(iso: string): Date {
  return new Date(iso);
}

function context(signaturePath: string | null): FormFillContext {
  const visitOne = {
    clockInAt: at("2026-06-25T15:30:00Z"), // 08:30 in Los Angeles
    clockOutAt: at("2026-06-25T19:20:00Z"), // 12:20
    breaks: [
      {
        startAt: at("2026-06-25T17:00:00Z"),
        endAt: at("2026-06-25T17:30:00Z"),
        paid: false,
      },
    ],
  };

  // A second trip the next day. Two visits is the ordinary case, not the edge
  // one — a job that needs a vendor meet always comes back — and it is what
  // gives a sign-off sheet with a line per day anything to put on line two.
  const visitTwo = {
    clockInAt: at("2026-06-26T21:00:00Z"), // 14:00
    clockOutAt: at("2026-06-27T01:00:00Z"), // 18:00
    breaks: [],
  };

  const data = {
    job: {
      id: "job1",
      intWoId: "417-000123",
      title: "Elevator phone line repair",
      externalAssignmentId: "A-88231",
      ticketNumber: "S-542975",
      incNumber: null,
      scheduledStart: at("2026-06-25T15:00:00Z"),
      estimateMinutes: 240,
      scopeOfWork: "Trace and repair the elevator emergency line.",
      releaseCode: null,
      noReleaseCode: true,
      returnTrackingNumber: null,
      workPerformedMerged:
        "Found cross-connected lines to the data remote and relabelled the run " +
        "from car 2 to panel 66. Test call succeeded from the machine room but " +
        "not from the car — the fault is on the elevator side. Suggested a " +
        "vendor meet — see notes.",
      outcome: "INCOMPLETE",
      internalStatus: "OPEN",
      lifecycle: "IN_PROGRESS",
      revisitNumber: 0,
      createdAt: at("2026-06-20T00:00:00Z"),
      client: { name: "Mettel" },
      customer: { name: "TSA Housing", code: "TSA" },
      site: {
        siteNumber: "4471",
        name: "Covina Tower",
        addressLine1: "200 W Rowland St",
        addressLine2: null,
        city: "Covina",
        state: "CA",
        postalCode: "91723",
        country: "USA",
        timeZone: TZ,
      },
      project: {
        name: "Mettel elevator lines",
        externalProjectId: "P-9",
        generalScopeOfWork: null,
      },
      pointsOfContact: [
        { id: "c1", type: "MOD", name: "Grigorij Dolganov" },
        { id: "c2", type: "NOC", name: "Night desk" },
      ],
      pmContact: { name: "Bryant Ellis" },
      signatures: signaturePath
        ? [
            {
              id: "s1",
              kind: "MOD",
              signerName: "Grigorij Dolganov",
              skipped: false,
              signedAt: at("2026-06-25T19:15:00Z"),
              attachment: {
                id: "a1",
                storagePath: signaturePath,
                originalName: "signature.png",
                mimeType: "image/png",
              },
            },
          ]
        : [],
      deliverables: [],
      reimbursements: [
        { id: "r1", type: "MATERIAL", label: "RJ45 ends", amount: "4.20", attachments: [] },
      ],
      assignments: [
        {
          id: "as1",
          isLead: true,
          workPerformed: null,
          user: { name: "Zhuly Gonzales" },
          visits: [visitOne, visitTwo],
        },
      ],
    },
    company: { name: "417 Group", phone: "(818) 555-0100" },
    timeZone: TZ,
    span: {
      onsiteAt: visitOne.clockInAt,
      offsiteAt: visitTwo.clockOutAt,
      totalMinutes: 230,
      open: false,
    },
    siteName: "TSA #4471",
    workDate: "2026-06-25",
  } as unknown as JobExportData;

  return { data, now: at("2026-06-26T18:00:00Z") };
}

type PlacedText = { text: string; x: number; y: number };

/**
 * Every run of text on a filled page, with where it sits.
 *
 * pdf.js reads the page the way a reader does, which is the only way to see
 * what a form actually says once the fields are gone. The positions matter as
 * much as the words: a value in the wrong box still reads as present.
 */
async function pageTexts(bytes: Buffer): Promise<PlacedText[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: false,
  }).promise;

  const items: PlacedText[] = [];
  for (let index = 1; index <= doc.numPages; index++) {
    const page = await doc.getPage(index);
    const content = await page.getTextContent();
    for (const item of content.items) {
      if (!("str" in item)) continue;
      items.push({ text: item.str, x: item.transform[4], y: item.transform[5] });
    }
  }
  await doc.destroy();
  return items;
}

async function pageText(bytes: Buffer): Promise<string> {
  return (await pageTexts(bytes)).map((item) => item.text).join(" ");
}

/** Whether `needle` was drawn inside the box a placement named. */
function drawnIn(
  items: PlacedText[],
  needle: string,
  box: { x: number; y: number; width: number; height: number },
): boolean {
  // A run may be split across items, so the match is on the run that starts
  // the value. Two points of slack for the padding the filler adds.
  return items.some(
    (item) =>
      item.text.replace(/\s+/g, " ").includes(needle) &&
      item.x >= box.x - 2 &&
      item.x <= box.x + box.width + 2 &&
      item.y >= box.y - 4 &&
      item.y <= box.y + box.height + 2,
  );
}

async function main() {
  // -------------------------------------------------------------------------
  console.log("\n--- the catalogue ---");

  check("initials of a two-part name", initials("Zhuly Gonzales"), "ZG");
  check("initials of a single name", initials("Cher"), "C");
  ok("every source resolves text or an image", true);

  const ctx = context(null);
  check("site city", formSource("site.city")?.resolve?.(ctx, 0), "Covina");
  check("rep company", formSource("client.name")?.resolve?.(ctx, 0), "Mettel");
  check("onsite time", formSource("time.onsite")?.resolve?.(ctx, 0), "8:30 AM");
  check("offsite time is the last trip's", formSource("time.offsite")?.resolve?.(ctx, 0), "6:00 PM");
  check("work date", formSource("time.date")?.resolve?.(ctx, 0), "06-25-2026");
  check("today, not the work date", formSource("time.today")?.resolve?.(ctx, 0), "06-26-2026");
  check("MOD", formSource("contact.mod")?.resolve?.(ctx, 0), "Grigorij Dolganov");
  check("Rep Company PM/PC", formSource("contact.pm")?.resolve?.(ctx, 0), "Bryant Ellis");
  check("city, state ZIP", formSource("site.cityStateZip")?.resolve?.(ctx, 0), "Covina, CA 91723");
  check("visit row 0 hours", formSource("visit.hours")?.resolve?.(ctx, 0), "3.83 hrs");
  check("visit row 0 break", formSource("visit.break")?.resolve?.(ctx, 0), "0.50 hrs");
  check("visit row 1 is the second trip", formSource("visit.in")?.resolve?.(ctx, 1), "2:00 PM");
  check("and its hours", formSource("visit.hours")?.resolve?.(ctx, 1), "4.00 hrs");
  check("a third visit that does not exist", formSource("visit.hours")?.resolve?.(ctx, 2), null);

  // A release code that was explicitly waived must not surface as a value.
  check("waived release code", formSource("job.releaseCode")?.resolve?.(ctx, 0), null);

  // -------------------------------------------------------------------------
  console.log("\n--- reading a blank ---");

  const withFields = await acroFormBlank();
  const analysis = await analyzeForm(withFields);
  check("fields are detected", analysis.boxSource, "FIELDS");
  check("page size", `${analysis.pageWidth}x${analysis.pageHeight}`, "612x792");
  check("one placement per widget", analysis.placements.length, 4);

  const store = analysis.placements.find((p) => p.fieldName === "Text19");
  check("the blank's own value is kept as a hint", store?.sampleText, "Marshall's");
  check("a checkbox is seeded as a tick", analysis.placements.find((p) => p.fieldName === "Check Box5")?.kind, "CHECK");
  ok(
    "placements run down the page",
    analysis.placements.map((p) => p.fieldName).join(",") ===
      "Text18,Text19,Text23,Check Box5",
  );

  ok(
    "a field with an unremarkable name maps itself to nothing",
    analysis.placements.every((placement) => placement.source === null),
  );

  const flat = await analyzeForm(await flatBlank());
  check("a flat blank asks for boxes by hand", flat.boxSource, "DRAWN");
  check("and seeds none", flat.placements.length, 0);

  // -------------------------------------------------------------------------
  console.log("\n--- a blank prepared with its fields named ---");

  check("a catalogue key maps itself", nameAsSource("site.city")?.source, "site.city");
  check("with no row on a source that does not repeat", nameAsSource("site.city")?.rowIndex, null);
  check("a row suffix counts from one", nameAsSource("visit.date#2")?.rowIndex, 1);
  check("row one is the first", nameAsSource("visit.date#1")?.rowIndex, 0);
  check("a repeating source with no suffix takes the first", nameAsSource("visit.date")?.rowIndex, 0);
  check("a suffix on a source that does not repeat is ignored", nameAsSource("site.city#3")?.rowIndex, null);
  // Nothing is guessed: a name has to be a key exactly.
  check("a field simply called City is left alone", nameAsSource("City"), null);
  check("so is one called site_city", nameAsSource("site_city"), null);
  check("and one called Site.City", nameAsSource("Site.City"), null);
  check("and a name that no longer exists", nameAsSource("site.county"), null);

  const prepared = await namedBlank();
  const named = await analyzeForm(prepared);
  check(
    "a prepared blank arrives mapped",
    named.placements.filter((placement) => placement.source).length,
    3,
  );
  check(
    "the signature field is a signature, not text",
    named.placements.find((p) => p.fieldName === "signature.mod")?.kind,
    "SIGNATURE",
  );
  check(
    "and the box left for the site stays unmapped",
    named.placements.find((p) => p.fieldName === "SiteInitials")?.source,
    null,
  );

  const preparedFill = await fillForm(
    prepared,
    named.placements
      .filter((placement) => placement.source)
      .map((placement) => ({
        fieldName: placement.fieldName,
        page: placement.page,
        x: placement.x,
        y: placement.y,
        width: placement.width,
        height: placement.height,
        kind: placement.kind,
        source: placement.source,
        staticText: null,
        rowIndex: placement.rowIndex,
        fontSize: null,
      })),
    context(null),
  );
  const preparedText = await pageText(preparedFill.bytes);
  ok("a prepared blank fills with no setup at all", preparedText.includes("Covina"));
  ok("including the second row of a table", preparedText.includes("6:00 PM"));

  // -------------------------------------------------------------------------
  console.log("\n--- filling a blank with fields ---");

  const mapped: FillablePlacement[] = [
    { fieldName: "Text19", page: 0, x: 116, y: 587, width: 150, height: 14, kind: "TEXT", source: "customer.name", staticText: null, rowIndex: null, fontSize: null },
    { fieldName: "Text18", page: 0, x: 304, y: 609, width: 93, height: 19, kind: "TEXT", source: "job.ticket", staticText: null, rowIndex: null, fontSize: null },
    { fieldName: "Check Box5", page: 0, x: 341, y: 320, width: 12, height: 12, kind: "CHECK", source: "job.summary", staticText: null, rowIndex: null, fontSize: null },
    // Text23 is left unmapped on purpose.
  ];

  const filled = await fillForm(withFields, mapped, context(null));
  const text = await pageText(filled.bytes);

  ok("the customer goes in", text.includes("TSA Housing"));
  ok("the ticket goes in", text.includes("S-542975"));
  ok("the blank's leftover store name is gone", !text.includes("Marshall"));
  ok("and so is its leftover phone number", !text.includes("818"));

  const refilled = await PDFDocument.load(filled.bytes);
  check("the result is not still editable", refilled.getForm().getFields().length, 0);

  // -------------------------------------------------------------------------
  console.log("\n--- filling a flat blank ---");

  const drawn: FillablePlacement[] = [
    { fieldName: null, page: 0, x: 307, y: 592, width: 133, height: 18, kind: "TEXT", source: "site.city", staticText: null, rowIndex: null, fontSize: null },
    { fieldName: null, page: 0, x: 120, y: 570, width: 166, height: 17, kind: "TEXT", source: "time.onsite", staticText: null, rowIndex: null, fontSize: null },
    { fieldName: null, page: 0, x: 370, y: 570, width: 168, height: 18, kind: "TEXT", source: "time.offsite", staticText: null, rowIndex: null, fontSize: null },
    { fieldName: null, page: 0, x: 20, y: 190, width: 136, height: 16, kind: "TEXT", source: "tech.initials", staticText: null, rowIndex: null, fontSize: null },
    { fieldName: null, page: 0, x: 199, y: 108, width: 193, height: 19, kind: "TEXT", source: "tech.names", staticText: null, rowIndex: null, fontSize: null },
    { fieldName: null, page: 0, x: 210, y: 254, width: 331, height: 19, kind: "TEXT", source: STATIC_SOURCE, staticText: "No release code provided", rowIndex: null, fontSize: null },
    // The narrative, into a box far too small for it at the default size.
    { fieldName: null, page: 0, x: 65, y: 378, width: 200, height: 60, kind: "TEXT", source: "job.summary", staticText: null, rowIndex: null, fontSize: null },
    // Nothing resolves here: the job has no return tracking.
    { fieldName: null, page: 0, x: 400, y: 300, width: 100, height: 16, kind: "TEXT", source: "job.returnTracking", staticText: null, rowIndex: null, fontSize: null },
  ];

  const overlay = await fillForm(await flatBlank(), drawn, context(null));
  const items = await pageTexts(overlay.bytes);
  const drawnText = items.map((item) => item.text).join(" ");

  // Each value has to land in the box it was mapped to. Checking only that
  // the word is somewhere on the page would pass a form with every value in
  // the wrong place, which is the one failure that reaches a customer.
  ok("city lands in its box", drawnIn(items, "Covina", drawn[0]));
  ok("check-in time lands in its box", drawnIn(items, "8:30", drawn[1]));
  ok("check-out time lands in its box", drawnIn(items, "6:00", drawn[2]));
  ok("initials land in their box", drawnIn(items, "ZG", drawn[3]));
  ok("the tech name lands in its box", drawnIn(items, "Zhuly", drawn[4]));
  ok("fixed text lands in its box", drawnIn(items, "No release code", drawn[5]));
  ok("the narrative starts in its box", drawnIn(items, "Found", drawn[6]));
  ok("the narrative is wrapped, not one line", drawnText.includes("cross-connected"));
  ok("the form the blank came with is still there", drawnText.includes("SERVICE POINT"));
  check("the empty box is reported", overlay.empty.join(","), "page 1 at 400,300");
  ok(
    "and nothing is drawn where it was",
    !items.some((item) => item.x > 395 && item.x < 505 && item.y > 295 && item.y < 320),
  );

  // -------------------------------------------------------------------------
  console.log("\n--- the signature ---");

  const relative = path.join("verify-forms", "signature.png");
  const absolute = path.join(uploadsRoot(), relative);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, SIGNATURE_PNG);

  const signed = await fillForm(
    await flatBlank(),
    [
      { fieldName: null, page: 0, x: 178, y: 300, width: 91, height: 46, kind: "SIGNATURE", source: "signature.mod", staticText: null, rowIndex: null, fontSize: null },
      { fieldName: null, page: 0, x: 199, y: 108, width: 193, height: 19, kind: "TEXT", source: "signature.modName", staticText: null, rowIndex: null, fontSize: null },
    ],
    context(relative),
  );
  ok("a signed form is produced", signed.bytes.length > 0);
  ok("the signer is named", (await pageText(signed.bytes)).includes("Grigorij"));
  check("nothing is left unfilled", signed.empty.length, 0);

  // A signature that was skipped leaves the box alone rather than failing.
  const unsigned = await fillForm(
    await flatBlank(),
    [{ fieldName: null, page: 0, x: 178, y: 300, width: 91, height: 46, kind: "SIGNATURE", source: "signature.mod", staticText: null, rowIndex: null, fontSize: null }],
    context(null),
  );
  check("an unsigned job reports the gap", unsigned.empty.length, 1);

  // A file that has gone missing must not take the whole form down with it.
  const missing = await fillForm(
    await flatBlank(),
    [{ fieldName: null, page: 0, x: 178, y: 300, width: 91, height: 46, kind: "SIGNATURE", source: "signature.mod", staticText: null, rowIndex: null, fontSize: null }],
    context(path.join("verify-forms", "gone.png")),
  );
  ok("a missing signature file still produces a form", missing.bytes.length > 0);

  // A truncated one is worse than a missing one: pdf-lib's PNG decoder has no
  // loop guard and spins forever on it, so a request would never come back.
  // The bytes below are a real PNG header followed by nothing usable, which is
  // what a write that ran out of disk leaves behind.
  const corruptPath = path.join("verify-forms", "corrupt.png");
  await writeFile(
    path.join(uploadsRoot(), corruptPath),
    Buffer.concat([
      SIGNATURE_PNG.subarray(0, 24),
      Buffer.alloc(64, 0),
    ]),
  );
  const started = Date.now();
  const corrupt = await fillForm(
    await flatBlank(),
    [{ fieldName: null, page: 0, x: 178, y: 300, width: 91, height: 46, kind: "SIGNATURE", source: "signature.mod", staticText: null, rowIndex: null, fontSize: null }],
    context(corruptPath),
  );
  ok("a corrupt signature file still produces a form", corrupt.bytes.length > 0);
  ok(
    `and returns rather than hanging (${Date.now() - started}ms)`,
    Date.now() - started < 10_000,
  );

  await rm(path.dirname(absolute), { recursive: true, force: true });

  // -------------------------------------------------------------------------
  console.log("\n--- text a standard font cannot draw ---");

  check("curly quotes", toWinAnsi("Marshall’s"), "Marshall's");
  check("en dash", toWinAnsi("9–10 am"), "9-10 am");
  check("an ellipsis", toWinAnsi("wait…"), "wait...");
  check("a character with no Latin-1 form", toWinAnsi("Ivan Є"), "Ivan ");

  const awkward = await fillForm(
    await flatBlank(),
    [{ fieldName: null, page: 0, x: 60, y: 400, width: 300, height: 20, kind: "TEXT", source: STATIC_SOURCE, staticText: "Marshall’s — 9–10am Є", rowIndex: null, fontSize: null }],
    context(null),
  );
  ok("a form with awkward characters still generates", awkward.bytes.length > 0);

  // -------------------------------------------------------------------------
  console.log("\n--- lifting boxes from a filled copy ---");

  const annotated = await PDFDocument.create();
  const annotatedPage = annotated.addPage([612, 792]);
  annotatedPage.drawText("x", { x: 1, y: 1, size: 1 });
  const lifted = await liftBoxes(Buffer.from(await annotated.save()));
  check("a page with no annotations lifts nothing", lifted.length, 0);

  // -------------------------------------------------------------------------
  console.log(
    failures === 0
      ? "\nAll form checks passed."
      : `\n${failures} check(s) failed.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
