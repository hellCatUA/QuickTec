import "dotenv/config";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { encode } from "next-auth/jwt";
import { PDFDocument } from "pdf-lib";
import { chromium, type Browser, type Page } from "playwright";
import sharp from "sharp";
import { db } from "@/lib/db";
import { usDateInZone, zonedParts, zonedWallTime } from "@/lib/datetime";
import {
  drawWorkOrder,
  fitNotes,
  LOCKED_WORK_ORDER,
  NOTES_CUT,
  openWorkOrder,
  type WoValues,
} from "@/lib/forms/wo-draw";
import {
  detectWoLayout,
  RULE_LIFT,
  TIMES_ASCENT,
  TIMES_DESCENT,
  type WoLayout,
  type WoScan,
} from "@/lib/forms/wo-layout";
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
 * Then in one, as the tech: refused before the job is closed, offered once
 * the last clock-out closes it, found, checked box by box, saved beside the
 * original as "<name>-Signed.pdf", and saved again in place rather than
 * twice. At 320 px too.
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
    "a filled work-order blank from the directory is not a signed work order",
    isSignedWorkOrder({ jobDocumentKind: "CLIENT_WORK_ORDER", generated: true, sourceTemplateId: "t1" }),
    false,
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

/** The screen once it has read the work order and drawn the page. */
async function ready(page: Page) {
  await page.waitForFunction(
    () => {
      const canvas = document.querySelector("canvas[aria-label^='Page']") as HTMLCanvasElement | null;
      return Boolean(canvas && canvas.width > 100);
    },
    undefined,
    { timeout: 45_000 },
  );
  await page.getByText("This is the page as it will be saved").waitFor({ timeout: 30_000 });
}

async function tickAll(page: Page) {
  for (let index = 0; index < 3; index++) {
    const button = page.getByRole("button", { name: "Looks right" }).first();
    if ((await button.count()) === 0) break;
    await button.click();
  }
}

/** The zoom the page is shown at, as the screen says it. */
async function zoomShown(page: Page): Promise<string> {
  return (await page.getByText(/^\d+%$/).first().textContent())?.trim() ?? "";
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
      signed?: boolean;
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
      const stored = await storeFile(created.id, await signaturePng(), "image/png");
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

  // --- a closed job ---------------------------------------------------------
  await page.goto(`${BASE}/jobs/${closedJob.id}`, { waitUntil: "domcontentloaded" });
  await jobTab(page, "Deliverables");
  await shot(page, "job-signoff-block-phone");
  await page.getByRole("link", { name: "Use WM WO as a Sign-Off" }).click();
  await page.waitForURL(/\/wo-sign-off/, { timeout: 15_000 });
  await ready(page);

  check(
    "it says WorkMarket's own times are painted over",
    await page.getByText("WorkMarket printed its own check-in").isVisible(),
    true,
  );
  check("check-in with its date, on the site's clock", await page.locator("#wo-check-in").inputValue(), `${date} 9:05 AM`);
  check("check-out", await page.locator("#wo-check-out").inputValue(), `${date} 1:40 PM`);
  check("the work performed", await page.locator("#wo-notes").inputValue(), NOTE);
  check("who signed", await page.locator("#wo-name").inputValue(), "Dana Reyes");
  check("the day they signed", await page.locator("#wo-date").inputValue(), date);
  await shot(page, "wo-page-phone");
  check(
    "at 100% the page fits its frame, with no sideways scroll",
    ((await frameScroll(page))?.sideways ?? 1) <= 0,
    true,
  );
  check(
    "it is not saved before each part is checked",
    await page.getByRole("button", { name: "Save the signed work order" }).isDisabled(),
    true,
  );

  // A nudge un-ticks what it moved: what was read is not there any more.
  await page.getByRole("button", { name: "Looks right" }).first().click();
  check("ticked", await page.getByRole("button", { name: "Checked — undo" }).count(), 1);
  const showTimes = page
    .locator('section[aria-label="Check-in and check-out"]')
    .getByRole("button", { name: "Show me" });
  await showTimes.click();
  check("Show me brings the times as close as they go", await zoomShown(page), "300%");
  await page.getByRole("button", { name: "Up a point" }).click();
  check("moved, it needs looking at again", await page.getByRole("button", { name: "Checked — undo" }).count(), 0);
  // Pressed a second time with nothing else changed, it used to do nothing.
  await scrollFrameTo(page, 0, 0);
  await showTimes.click();
  await page.waitForTimeout(200);
  check("pressed again, it brings the box back into view", ((await frameScroll(page))?.left ?? 0) > 0, true);
  await page
    .locator('section[aria-label="Notes"]')
    .getByRole("button", { name: "Show me" })
    .click();
  check("a box as wide as the notes is shown whole across", await zoomShown(page), "100%");

  await tickAll(page);
  const save = page.getByRole("button", { name: "Save the signed work order" });
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll("button")].some(
        (button) => button.textContent?.includes("Save the signed work order") && !button.disabled,
      ),
    undefined,
    { timeout: 20_000 },
  );
  check("one pdf.js worker for the whole screen, however often it redraws", page.workers().length, 1);

  // The save request lost on the way: the screen used to give way to Next's
  // error page, and everything typed and ticked with it.
  const isScreen = (url: URL) => url.pathname.endsWith("/wo-sign-off");
  const drop = (route: import("playwright").Route) =>
    route.request().method() === "POST" ? route.abort("internetdisconnected") : route.continue();
  await page.route(isScreen, drop);
  await save.click();
  check(
    "a dropped connection while saving says so",
    await soon(page.getByRole("alert").filter({ hasText: "connection dropped" })),
    true,
  );
  check("and keeps what was on the screen", await page.locator("#wo-check-in").inputValue(), `${date} 9:05 AM`);
  check("ticks and all", await page.getByRole("button", { name: "Checked — undo" }).count(), 3);
  await page.unroute(isScreen, drop);

  await save.click();
  await page.getByText("Saved: 2600000001-Signed.pdf").waitFor({ timeout: 30_000 });
  await shot(page, "wo-page-saved-phone");

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

  // --- again: replaced, not added, and what was typed is remembered ----------
  await page.goto(`${BASE}/jobs/${closedJob.id}/wo-sign-off`, { waitUntil: "domcontentloaded" });
  await ready(page);
  check(
    "a second time it replaces the copy",
    await page.getByRole("button", { name: "Replace the signed work order" }).count(),
    1,
  );
  await page.locator("#wo-check-in").fill(`${date} 9:06 AM`);
  check(
    "a tick waits for the page to be redrawn",
    await page
      .locator('section[aria-label="Check-in and check-out"]')
      .getByRole("button", { name: "Looks right" })
      .isDisabled(),
    true,
  );
  check(
    "typed over, it offers the job's own back",
    await page.getByRole("button", { name: "Back to the job’s times" }).isVisible(),
    true,
  );
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll("button")].some(
        (button) => button.textContent?.includes("Looks right") && !button.disabled,
      ),
    undefined,
    { timeout: 20_000 },
  );
  await tickAll(page);
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll("button")].some(
        (button) => button.textContent?.includes("Replace the signed work order") && !button.disabled,
      ),
    undefined,
    { timeout: 20_000 },
  );
  // Held for a moment on the way, so the screen can be looked at mid-save.
  const slow = async (route: import("playwright").Route) => {
    if (route.request().method() === "POST") await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
  };
  await page.route(isScreen, slow);
  await page.getByRole("button", { name: "Replace the signed work order" }).click();
  check("nothing can be typed while it saves", await page.locator("#wo-notes").isDisabled(), true);
  await page.getByText("Saved: 2600000001-Signed.pdf").waitFor({ timeout: 30_000 });
  await page.unroute(isScreen, slow);
  check(
    "still one signed copy",
    await db.attachment.count({ where: { jobDocumentId: closedJob.id, signedFromId: closedJob.workOrderId } }),
    1,
  );
  // Back to the job's own values after saving is a change to save: it used
  // to leave "Saved" up and no button.
  await page.getByRole("button", { name: "Back to the job’s times" }).click();
  check(
    "going back to the job's times after saving offers saving again",
    await soon(page.getByRole("button", { name: "Replace the signed work order" })),
    true,
  );
  // Left by the screen's own link, the worker goes with it.
  await page.getByRole("link", { name: "Back" }).first().click();
  await page.waitForURL(new RegExp(`/jobs/${closedJob.id}$`), { timeout: 15_000 });
  await page.waitForTimeout(500);
  check("leaving the screen lets its worker go", page.workers().length, 0);
  await page.goto(`${BASE}/jobs/${closedJob.id}/wo-sign-off`, { waitUntil: "domcontentloaded" });
  await ready(page);
  check("what was typed comes back", await page.locator("#wo-check-in").inputValue(), `${date} 9:06 AM`);
  check("what was not follows the job", await page.locator("#wo-check-out").inputValue(), `${date} 1:40 PM`);

  // --- refused on saving once the job is open again ---------------------------
  await db.job.update({ where: { id: closedJob.id }, data: { lifecycle: "IN_PROGRESS" } });
  await tickAll(page);
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll("button")].some(
        (button) => button.textContent?.includes("Replace the signed work order") && !button.disabled,
      ),
    undefined,
    { timeout: 20_000 },
  );
  await page.getByRole("button", { name: "Replace the signed work order" }).click();
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

  // --- 320 px ----------------------------------------------------------------
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto(`${BASE}/jobs/${closedJob.id}/wo-sign-off`, { waitUntil: "domcontentloaded" });
  await ready(page);
  check(
    "fits a 320 px screen",
    await page.evaluate(() => document.documentElement.scrollWidth <= 320),
    true,
  );
  await shot(page, "wo-page-320");
  if (process.env.WO_SHOTS) {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.reload({ waitUntil: "domcontentloaded" });
    await ready(page);
    await shot(page, "wo-page-desktop");
    await page.evaluate(() => {
      try {
        localStorage.setItem("quicktec-theme", "light");
      } catch {}
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await ready(page);
    await shot(page, "wo-page-desktop-light");
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
    await soon(onIphone.getByText("This is the page as it will be saved"), 45_000),
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
  await ready(page);
  check(
    "blank lines found on that one",
    await page.getByText("Written on the blank Arrival time and Departure time lines.").isVisible(),
    true,
  );
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

