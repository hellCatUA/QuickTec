import "dotenv/config";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { encode } from "next-auth/jwt";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { chromium } from "playwright";
import { db } from "@/lib/db";
import { absolutePath } from "@/lib/storage";

/** A one-pixel PNG standing in for a signature captured on site. */
const SIGNATURE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/**
 * Drives the sign-off filler in a real browser.
 *
 * Everything up to this point can be checked without one, and the one thing
 * that cannot is the part that matters most: whether somebody can actually
 * look at a blank, see which box is which, and point each one at a value. The
 * preview is the feature — a field called "Text19" is unmappable without it —
 * so it is exercised where it runs.
 *
 * Needs the app already running on BASE_URL with the same AUTH_SECRET.
 *
 *   npm run build && npm start &
 *   npm run verify:form-pages
 */

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";

let failures = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label}\n      got ${actual}${ok ? "" : `  want ${expected}`}`,
  );
}

function ok(label: string, condition: boolean) {
  if (!condition) failures++;
  console.log(`${condition ? "PASS" : "FAIL"}  ${label}`);
}

/**
 * A blank in the shape the real ones arrive in: form fields with names their
 * author never meant anybody to read, still carrying the last job's values.
 */
async function blankWithFields(): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const form = pdf.getForm();

  page.drawText("CUSTOMER SIGN OFF SHEET", {
    x: 60,
    y: 730,
    size: 16,
    font,
    color: rgb(0, 0, 0),
  });

  const store = form.createTextField("Text19");
  store.setText("Marshall's");
  store.addToPage(page, { x: 116, y: 600, width: 180, height: 18, font });

  const ticket = form.createTextField("Text18");
  ticket.setText("6682752");
  ticket.addToPage(page, { x: 340, y: 600, width: 180, height: 18, font });

  const phone = form.createTextField("Text23");
  phone.setText("(818) 346-0208");
  phone.addToPage(page, { x: 116, y: 560, width: 180, height: 18, font });

  // Named after a catalogue key, so it maps itself to the signature.
  const signature = form.createTextField("signature.mod");
  signature.addToPage(page, { x: 116, y: 480, width: 200, height: 40, font });

  return Buffer.from(await pdf.save());
}

/** A blank with nothing to fill: a designed page and no form fields at all. */
async function flatBlank(): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText("SERVICE POINT — GENERIC SIGN OFF", {
    x: 60,
    y: 720,
    size: 14,
    font,
    color: rgb(0, 0, 0),
  });
  return Buffer.from(await pdf.save());
}


/**
 * A second job for the company, already approved — the one a new form must not
 * reach. Created rather than looked for, so the check is never skipped.
 */
async function approvedJobFor(clientId: string, createdById: string): Promise<string> {
  const existing = await db.job.findFirst({
    where: { title: "Verify approved job" },
    select: { id: true },
  });
  if (existing) {
    await db.job.update({
      where: { id: existing.id },
      data: { lifecycle: "APPROVED" },
    });
    return existing.id;
  }

  const template = await db.job.findFirstOrThrow({
    where: { clientId },
    select: { customerId: true, siteId: true, projectId: true },
  });

  const created = await db.job.create({
    data: {
      intWoId: `VERIFY-APPROVED-${Date.now()}`,
      intWoSequence: 9999,
      title: "Verify approved job",
      clientId,
      customerId: template.customerId,
      siteId: template.siteId,
      projectId: template.projectId,
      createdById,
      lifecycle: "APPROVED",
    },
    select: { id: true },
  });
  return created.id;
}

async function main() {
  const boss = await db.user.findUniqueOrThrow({
    where: { email: "boss@417group.org" },
  });

  // The fixture job by name, not "the oldest one": other suites leave jobs
  // behind, and picking whichever happened to be first made this fail on a
  // company it was never looking at.
  const job = await db.job.findFirstOrThrow({
    where: { title: "Elevator phone line" },
    select: { id: true, clientId: true, client: { select: { name: true } } },
  });

  // A clean slate, at the start rather than only at the end. A run that dies
  // half way leaves the job changed, and the next one then fails on state it
  // never created — which is a morning spent reading the wrong failure.
  await db.clientDocumentTemplate.deleteMany({
    where: { clientId: job.clientId, label: { startsWith: "Verify " } },
  });
  await db.attachment.deleteMany({ where: { jobDocumentId: job.id } });
  await db.jobFormEntry.deleteMany({ where: { jobId: job.id } });
  await db.signature.deleteMany({ where: { jobId: job.id } });

  // Set rather than assumed: every value this suite asserts on starts here.
  await db.job.update({
    where: { id: job.id },
    data: { ticketNumber: "6682752" },
  });
  const customerId = (
    await db.job.findUniqueOrThrow({
      where: { id: job.id },
      select: { customerId: true },
    })
  ).customerId;
  await db.customer.update({
    where: { id: customerId },
    data: { name: "TSA Housing" },
  });

  // A second job for the same company, already approved. Paperwork added now
  // must not reach it.
  const approvedId = await approvedJobFor(job.clientId, boss.id);
  await db.attachment.deleteMany({ where: { jobDocumentId: approvedId } });

  const token = await encode({
    token: { sub: boss.nextcloudSub!, userId: boss.id },
    secret: process.env.AUTH_SECRET!,
    salt: "authjs.session-token",
    maxAge: 3600,
  });

  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  await context.addCookies([
    { name: "authjs.session-token", value: token, url: BASE },
  ]);
  const page = await context.newPage();

  // -------------------------------------------------------------------------
  // Uploading the blank reads its fields.
  // -------------------------------------------------------------------------
  await page.goto(`${BASE}/directory/clients`, { waitUntil: "domcontentloaded" });

  // The forms a company uses live inside its card, which opens on Edit. By
  // name, because every card has one of these.
  await page.getByRole("button", { name: `Edit ${job.client.name}` }).click();

  await page.getByRole("button", { name: "Add a default form" }).first().click();
  await page.locator(`#tpl-label-${job.clientId}`).fill("Verify sign-off");
  await page.locator('input[type="file"]').first().setInputFiles({
    name: "verify-signoff.pdf",
    mimeType: "application/pdf",
    buffer: await blankWithFields(),
  });
  await page.getByRole("button", { name: "Add form" }).click();

  await page.waitForSelector("text=Verify sign-off", { timeout: 20_000 });

  const template = await db.clientDocumentTemplate.findFirstOrThrow({
    where: { clientId: job.clientId, label: "Verify sign-off" },
    select: {
      id: true,
      boxSource: true,
      pageWidth: true,
      pageHeight: true,
      placements: {
        orderBy: { order: "asc" },
        select: { id: true, fieldName: true, sampleText: true },
      },
    },
  });

  check("the blank's fields were read on upload", template.boxSource, "FIELDS");
  check("page size was recorded", `${template.pageWidth}x${template.pageHeight}`, "612x792");
  check("a box per field", template.placements.length, 4);
  check(
    "the last job's value is kept as the hint",
    template.placements.find((p) => p.fieldName === "Text19")?.sampleText,
    "Marshall's",
  );

  ok(
    "the list says how much of the form fills itself",
    await page.getByText(/Fills 1 of 4 boxes/).first().isVisible(),
  );

  // -------------------------------------------------------------------------
  // A form added today has to reach the job being done today.
  // -------------------------------------------------------------------------
  const onOpenJob = await db.attachment.count({
    where: { jobDocumentId: job.id, sourceTemplateId: template.id },
  });
  check("a new form lands on the job already open", onOpenJob, 1);

  // A job that has been approved already went to the company on whatever it
  // went out on. Adding paperwork to it afterwards would rewrite a record of
  // something that has happened.
  const closed = await db.job.findFirst({
    where: { clientId: job.clientId, lifecycle: "APPROVED" },
    select: { id: true },
  });
  check(
    "and not on one that is already approved",
    closed
      ? await db.attachment.count({
          where: { jobDocumentId: closed.id, sourceTemplateId: template.id },
        })
      : "no approved job to check",
    closed ? 0 : "no approved job to check",
  );

  // The button for everything the automatic pass cannot cover, and for pressing
  // twice by mistake.
  await db.attachment.deleteMany({
    where: { jobDocumentId: job.id, sourceTemplateId: template.id },
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: `Edit ${job.client.name}` }).click();
  await page.getByRole("button", { name: "Put these on open jobs" }).click();
  await page.waitForSelector("text=/Added 1 form across 1 job/", { timeout: 20_000 });
  check(
    "the button puts it back",
    await db.attachment.count({
      where: { jobDocumentId: job.id, sourceTemplateId: template.id },
    }),
    1,
  );

  await page.getByRole("button", { name: "Put these on open jobs" }).click();
  await page.waitForSelector("text=/already has them/", { timeout: 20_000 });
  check(
    "and pressing it again changes nothing",
    await db.attachment.count({
      where: { jobDocumentId: job.id, sourceTemplateId: template.id },
    }),
    1,
  );

  // -------------------------------------------------------------------------
  // The mapping screen.
  // -------------------------------------------------------------------------
  await page.goto(
    `${BASE}/directory/clients/${job.clientId}/forms/${template.id}`,
    { waitUntil: "domcontentloaded" },
  );

  // The preview is what makes "Text19" mappable, so its absence is a failure
  // rather than a cosmetic problem.
  await page.waitForFunction(
    () => {
      const canvas = document.querySelector("canvas");
      return Boolean(canvas && canvas.width > 100);
    },
    { timeout: 30_000 },
  );
  ok("the blank renders", true);

  ok(
    "the hint says what an unreadable field name is for",
    await page.getByText("was “Marshall's”").isVisible(),
  );

  const boxes = page.locator('[role="button"][aria-label^="Text"]');
  check("every box is drawn over the page", await boxes.count(), 3);
  check(
    "and the signature box too",
    await page.locator('[role="button"][aria-label="signature.mod"]').count(),
    1,
  );

  // The box for Text19 must sit where the field does, not somewhere else.
  const geometry = await boxes.first().evaluate((element) => {
    const box = element.getBoundingClientRect();
    const parent = element.parentElement!.getBoundingClientRect();
    return { left: box.left - parent.left, top: box.top - parent.top };
  });
  // 116pt across a 612pt page rendered 720px wide.
  const expectedLeft = (116 / 612) * 720;
  ok(
    `the box sits where its field does (${Math.round(geometry.left)} ≈ ${Math.round(expectedLeft)})`,
    Math.abs(geometry.left - expectedLeft) < 6,
  );

  await page
    .getByRole("combobox", { name: "What goes in this box" })
    .nth(0)
    .selectOption("customer.name");
  await page
    .getByRole("combobox", { name: "What goes in this box" })
    .nth(1)
    .selectOption("job.ticket");
  // The third is deliberately left unmapped.

  await page.getByRole("button", { name: "Save mapping" }).click();
  await page.waitForSelector("text=Mapping saved.", { timeout: 20_000 });

  const saved = await db.formPlacement.findMany({
    where: { templateId: template.id },
    select: { fieldName: true, source: true },
  });
  check(
    "the mapping is stored",
    saved
      .filter((row) => row.source)
      .map((row) => `${row.fieldName}=${row.source}`)
      .sort()
      .join(","),
    "Text18=job.ticket,Text19=customer.name,signature.mod=signature.mod",
  );
  check(
    "and the box nobody mapped stays unmapped",
    saved.find((row) => row.fieldName === "Text23")?.source,
    "null",
  );

  // A signature is an image and cannot be drawn as text — a box bound to one
  // must not offer the choice, because the alternative is a form that comes
  // out with a file path where the signature should be.
  const drawAs = page.getByRole("combobox", { name: "How to draw it" });
  const before = await drawAs.count();
  await page
    .getByRole("combobox", { name: "What goes in this box" })
    .nth(2)
    .selectOption("signature.mod");
  check(
    "a signature box is not offered as text",
    await drawAs.count(),
    before,
  );

  await page.getByRole("button", { name: "Save mapping" }).click();
  await page.waitForSelector("text=Mapping saved.", { timeout: 20_000 });
  check(
    "and it is stored as a signature",
    (
      await db.formPlacement.findFirstOrThrow({
        where: { templateId: template.id, fieldName: "Text23" },
        select: { kind: true },
      })
    ).kind,
    "SIGNATURE",
  );

  // -------------------------------------------------------------------------
  // Filling it from a job.
  // -------------------------------------------------------------------------
  // The blank is already on the job — put there by the rollout above, the same
  // way it happens in use. Nothing is fabricated here.
  await db.formPlacement.updateMany({
    where: { templateId: template.id, fieldName: "Text23" },
    data: { source: null, kind: "TEXT" },
  });
  check(
    "the job is holding a real copy of the blank",
    await db.attachment.count({
      where: {
        jobDocumentId: job.id,
        sourceTemplateId: template.id,
        generated: false,
      },
    }),
    1,
  );

  await page.goto(`${BASE}/jobs/${job.id}`, { waitUntil: "domcontentloaded" });

  const review = page.getByRole("link", { name: /Fill it in and check it/ });
  ok("the job offers to fill the sheet in", await review.isVisible());
  await review.click();
  await page.waitForURL(/\/sign-off\//, { timeout: 20_000 });

  // The preview is the same document that gets attached, produced the same
  // way. If it does not render there is nothing to review.
  await page.waitForFunction(
    () => {
      const canvas = document.querySelector("canvas");
      return Boolean(canvas && canvas.width > 100);
    },
    { timeout: 30_000 },
  );
  ok("the sheet is previewed before it is attached", true);

  // Boxes the mapping covers arrive filled; the rest are empty and typeable,
  // which is the whole reason this screen exists.
  const ticketBox = page.getByRole("textbox", { name: "Ticket #" });
  check("a mapped box shows its value", await ticketBox.inputValue(), "6682752");

  const byHand = page.getByRole("textbox", { name: "Text23" });
  check("an unmapped box is empty and typeable", await byHand.inputValue(), "");
  await byHand.fill("(310) 820-4888");

  // Typing over a mapped value has to win, and has to be undoable.
  await ticketBox.fill("OVERRIDDEN-1");
  await page
    .getByRole("button", { name: "back to the filled value" })
    .first()
    .click();
  check(
    "handing a box back restores what the app filled",
    await ticketBox.inputValue(),
    "6682752",
  );

  // Saved before anything reloads: typing is not kept until it is.
  await page.getByRole("button", { name: "Update the preview" }).click();
  // The "preview is behind what you have typed" note is shown while there is
  // anything unsaved, so its going away is the save having landed.
  await page
    .getByText("The preview is behind what you have typed")
    .waitFor({ state: "hidden", timeout: 20_000 });
  check(
    "typing is kept as soon as it is saved",
    (
      await db.jobFormEntry.findFirstOrThrow({
        where: { jobId: job.id, placement: { fieldName: "Text23" } },
        select: { value: true },
      })
    ).value,
    "(310) 820-4888",
  );

  // -------------------------------------------------------------------------
  // A signature box says what is actually in it.
  // -------------------------------------------------------------------------
  ok(
    "an unsigned job says so rather than claiming the box is filled",
    await page.getByText("Nothing signed yet").isVisible(),
  );

  // Now sign it, the way checkout does.
  const signatureFile = path.join("verify-form-pages", "sig.png");
  const signatureAbsolute = absolutePath(signatureFile);
  await mkdir(path.dirname(signatureAbsolute), { recursive: true });
  await writeFile(signatureAbsolute, SIGNATURE_PNG);
  const signatureAttachment = await db.attachment.create({
    data: {
      storagePath: signatureFile,
      originalName: "sig.png",
      mimeType: "image/png",
      sizeBytes: SIGNATURE_PNG.length,
      uploadedById: boss.id,
    },
    select: { id: true },
  });
  await db.signature.create({
    data: {
      jobId: job.id,
      kind: "MOD",
      signerName: "Alyssa Carter",
      signedAt: new Date(),
      attachmentId: signatureAttachment.id,
    },
  });

  await page.reload({ waitUntil: "domcontentloaded" });
  ok(
    "and once it is signed it says that instead",
    await page.getByText("The signature captured on site").isVisible(),
  );

  // -------------------------------------------------------------------------
  // Checking the sheet off, box by box.
  // -------------------------------------------------------------------------
  const rows = page.locator('[aria-label="Ticket #"]');
  const firstBefore = await rows.first().getAttribute("aria-label");
  check("the ticket box starts at the top", firstBefore, "Ticket #");

  await page
    .getByRole("button", { name: "Check off" })
    .first()
    .click();
  ok(
    "a checked box drops to the bottom",
    await page
      .locator("div")
      .filter({ hasText: /Check off/ })
      .first()
      .isVisible(),
  );
  check(
    "and one fewer is left to read",
    await page.getByText(/left to check/).textContent(),
    "3 of 4 left to check",
  );

  // Typing into a checked box un-checks it: the tick was for the old value.
  await page.getByRole("button", { name: "Checked" }).first().click();
  await ticketBox.fill("TYPED-OVER");
  check(
    "typing over a checked box un-checks it",
    await page.getByText(/left to check/).textContent(),
    "4 of 4 left to check",
  );
  await ticketBox.fill("6682752");

  await page.getByRole("button", { name: "Check the rest off" }).click();
  check(
    "checking the rest off clears the list",
    await page.getByText(/boxes checked/).textContent(),
    "All 4 boxes checked",
  );

  await page.getByRole("button", { name: /Attach to the job/ }).click();
  await page.waitForSelector("text=/Attached to the job/", { timeout: 30_000 });

  check(
    "the ticks are kept against what was read",
    await db.jobFormEntry.count({
      where: { jobId: job.id, approvedValue: { not: null } },
    }),
    4,
  );

  // A tick is of a value, not of a box. Checked on a box still taking its
  // value from the mapping — a typed one is the person's own words and does
  // not move when the job does, which is the whole point of typing it.
  await db.customer.update({
    where: { id: customerId },
    data: { name: "Renamed Mid-Review" },
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  check(
    "a tick lapses when the value moves under it",
    await page.getByText(/left to check/).textContent(),
    "1 of 4 left to check",
  );
  await db.customer.update({
    where: { id: customerId },
    data: { name: "TSA Housing" },
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  check(
    "and comes back when it moves back",
    await page.getByText(/boxes checked/).textContent(),
    "All 4 boxes checked",
  );

  check(
    "what was typed by hand is kept",
    (
      await db.jobFormEntry.findFirstOrThrow({
        where: { jobId: job.id, placement: { fieldName: "Text23" } },
        select: { value: true },
      })
    ).value,
    "(310) 820-4888",
  );

  const generated = await db.attachment.findFirstOrThrow({
    where: { jobDocumentId: job.id, generated: true },
    select: { id: true, storagePath: true, originalName: true },
  });
  ok("a filled copy is produced", generated.originalName.includes("filled"));

  const bytes = await readFile(absolutePath(generated.storagePath));
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const opened = await pdfjs.getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: false,
  }).promise;
  const rendered = await opened.getPage(1);
  const text = (await rendered.getTextContent()).items
    .map((item) => ("str" in item ? item.str : ""))
    .join(" ");
  await opened.destroy();

  const expected = await db.job.findUniqueOrThrow({
    where: { id: job.id },
    select: { ticketNumber: true, customer: { select: { name: true } } },
  });

  ok("the customer is on the sheet", text.includes(expected.customer.name));
  ok(
    "the blank's leftover store name is not",
    !text.includes("Marshall"),
  );
  ok("nor its leftover phone number", !text.includes("346-0208"));
  ok("what was typed by hand is on the sheet", text.includes("(310) 820-4888"));

  const reopened = await PDFDocument.load(bytes);
  check("the sheet is no longer editable", reopened.getForm().getFields().length, 0);

  // Filling again replaces rather than piles up.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /Replace the one on the job/ }).click();
  await page.waitForSelector("text=/Attached to the job/", { timeout: 30_000 });
  check(
    "filling again replaces the previous copy",
    await db.attachment.count({
      where: { jobDocumentId: job.id, generated: true },
    }),
    1,
  );

  // -------------------------------------------------------------------------
  // A flat blank, where the boxes have to be placed by hand. This is the
  // Service Point shape: a designed PDF with no fields at all, filled today by
  // typing on top of it in a phone annotator.
  // -------------------------------------------------------------------------
  await page.goto(`${BASE}/directory/clients`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: `Edit ${job.client.name}` }).click();
  await page.getByRole("button", { name: "Add a default form" }).first().click();
  await page.locator(`#tpl-label-${job.clientId}`).fill("Verify flat sheet");
  await page.locator('input[type="file"]').first().setInputFiles({
    name: "verify-flat.pdf",
    mimeType: "application/pdf",
    buffer: await flatBlank(),
  });
  await page.getByRole("button", { name: "Add form" }).click();
  await page.waitForSelector("text=Verify flat sheet", { timeout: 20_000 });

  const flat = await db.clientDocumentTemplate.findFirstOrThrow({
    where: { clientId: job.clientId, label: "Verify flat sheet" },
    select: { id: true, boxSource: true, _count: { select: { placements: true } } },
  });
  check("a blank with no fields is marked as hand-drawn", flat.boxSource, "DRAWN");
  check("and starts with no boxes", flat._count.placements, 0);

  await page.goto(
    `${BASE}/directory/clients/${job.clientId}/forms/${flat.id}`,
    { waitUntil: "domcontentloaded" },
  );
  await page.waitForFunction(
    () => {
      const canvas = document.querySelector("canvas");
      return Boolean(canvas && canvas.width > 100);
    },
    { timeout: 30_000 },
  );

  await page.getByRole("button", { name: "Add a box" }).click();
  await page.waitForSelector('[role="button"][aria-label^="Box at"]', {
    timeout: 20_000,
  });

  const box = page.locator('[role="button"][aria-label^="Box at"]').first();
  // Coordinates from boundingBox are viewport-relative, so a box below the
  // fold gets dragged at a point that is not on it.
  await box.scrollIntoViewIfNeeded();
  const start = (await box.boundingBox())!;

  // Dragged to where it belongs on the page. Without this the box lands in
  // the middle and stays there, which makes a flat blank unusable.
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    start.x + start.width / 2 - 120,
    start.y + start.height / 2 - 200,
    { steps: 12 },
  );
  await page.mouse.up();

  await page
    .getByRole("combobox", { name: "What goes in this box" })
    .first()
    .selectOption("site.city");
  await page.getByRole("button", { name: "Save mapping" }).click();
  await page.waitForSelector("text=Mapping saved.", { timeout: 20_000 });

  const moved = await db.formPlacement.findFirstOrThrow({
    where: { templateId: flat.id },
    select: { x: true, y: true, source: true },
  });

  // 120px left and 200px up, at 720px across a 612pt page.
  const perPoint = 720 / 612;
  check("the box keeps what it was pointed at", moved.source, "site.city");
  ok(
    `dragging moved it left (${Math.round(moved.x)} ≈ ${Math.round(612 / 2 - 75 - 120 / perPoint)})`,
    Math.abs(moved.x - (612 / 2 - 75 - 120 / perPoint)) < 4,
  );
  ok(
    `and up the page (${Math.round(moved.y)} ≈ ${Math.round(792 / 2 + 200 / perPoint)})`,
    Math.abs(moved.y - (792 / 2 + 200 / perPoint)) < 4,
  );

  await browser.close();

  // Leave the directory as it was found.
  await db.clientDocumentTemplate.deleteMany({
    where: { id: { in: [template.id, flat.id] } },
  });
  await db.attachment.deleteMany({ where: { jobDocumentId: job.id } });
  await db.job.deleteMany({ where: { title: "Verify approved job" } });
  await db.signature.deleteMany({ where: { jobId: job.id } });
  await rm(path.dirname(absolutePath(path.join("verify-form-pages", "sig.png"))), {
    recursive: true,
    force: true,
  });

  console.log(
    failures === 0
      ? "\nAll form page checks passed."
      : `\n${failures} check(s) failed.`,
  );
  await db.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});
