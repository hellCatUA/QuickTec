import "dotenv/config";
import { readFile } from "node:fs/promises";
import { encode } from "next-auth/jwt";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { chromium } from "playwright";
import { db } from "@/lib/db";
import { absolutePath } from "@/lib/storage";

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

  return Buffer.from(await pdf.save());
}

async function main() {
  const boss = await db.user.findUniqueOrThrow({
    where: { email: "boss@417group.org" },
  });

  const job = await db.job.findFirstOrThrow({
    select: { id: true, clientId: true, client: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });

  // A clean slate: leftovers from an earlier run change which branch renders.
  await db.clientDocumentTemplate.deleteMany({
    where: { clientId: job.clientId, label: "Verify sign-off" },
  });
  await db.attachment.deleteMany({ where: { jobDocumentId: job.id } });

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

  // The forms a company uses live inside its card, which opens on Edit.
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();

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
  check("a box per field", template.placements.length, 3);
  check(
    "the last job's value is kept as the hint",
    template.placements.find((p) => p.fieldName === "Text19")?.sampleText,
    "Marshall's",
  );

  ok(
    "the list offers to set autofill up",
    await page.getByText("Set up autofill").first().isVisible(),
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

  const boxes = page.locator('button[aria-label^="Text"]');
  check("every box is drawn over the page", await boxes.count(), 3);

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
    "Text18=job.ticket,Text19=customer.name",
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
  await db.attachment.deleteMany({ where: { jobDocumentId: job.id } });
  await db.formPlacement.updateMany({
    where: { templateId: template.id, fieldName: "Text23" },
    data: { source: null, kind: "TEXT" },
  });

  const blank = await db.attachment.create({
    data: {
      storagePath: "",
      originalName: "verify-signoff.pdf",
      mimeType: "application/pdf",
      sizeBytes: 0,
      uploadedById: boss.id,
      jobDocumentId: job.id,
      jobDocumentKind: "SIGN_OFF",
      sourceTemplateId: template.id,
    },
    select: { id: true },
  });

  // Give it real bytes, the way copyTemplateToJob would.
  const source = await db.clientDocumentTemplate.findUniqueOrThrow({
    where: { id: template.id },
    select: { attachment: { select: { storagePath: true, sizeBytes: true } } },
  });
  await db.attachment.update({
    where: { id: blank.id },
    data: {
      storagePath: source.attachment.storagePath,
      sizeBytes: source.attachment.sizeBytes,
    },
  });

  await page.goto(`${BASE}/jobs/${job.id}`, { waitUntil: "domcontentloaded" });

  const fill = page.getByRole("button", { name: "Fill it in from this job" });
  ok("the job offers to fill the sheet in", await fill.isVisible());
  await fill.click();
  await page.waitForSelector("text=/Filled\\./", { timeout: 30_000 });

  const generated = await db.attachment.findFirstOrThrow({
    where: { jobDocumentId: job.id, generated: true },
    select: { id: true, storagePath: true, originalName: true },
  });
  ok("a filled copy is produced", generated.originalName.includes("filled"));

  const bytes = await readFile(absolutePath(generated.storagePath));
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const document = await pdfjs.getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: false,
  }).promise;
  const rendered = await document.getPage(1);
  const text = (await rendered.getTextContent()).items
    .map((item) => ("str" in item ? item.str : ""))
    .join(" ");
  await document.destroy();

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
  ok("nor its leftover ticket number", !text.includes("6682752"));

  const reopened = await PDFDocument.load(bytes);
  check("the sheet is no longer editable", reopened.getForm().getFields().length, 0);

  // Filling again replaces rather than piles up.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Fill it in from this job" }).click();
  await page.waitForSelector("text=/Filled\\./", { timeout: 30_000 });
  check(
    "filling again replaces the previous copy",
    await db.attachment.count({
      where: { jobDocumentId: job.id, generated: true },
    }),
    1,
  );

  await browser.close();

  // Leave the directory as it was found.
  await db.clientDocumentTemplate.deleteMany({ where: { id: template.id } });
  await db.attachment.deleteMany({ where: { jobDocumentId: job.id } });

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
