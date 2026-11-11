import "dotenv/config";
import { chromium, type Page } from "playwright";
import { encode } from "next-auth/jwt";
import { mkdir } from "node:fs/promises";
import { db } from "@/lib/db";

/**
 * A tech's day on one job, in a real browser on a phone: open it, clock in,
 * take a break, write notes, file photos, add a contact and a receipt, and
 * check out. A screenshot at every state somebody would actually be looking at.
 */

// Signs people in and presses buttons, so it is kept to the audit database:
// pointed at a real one it would clock somebody in.
if (!/quicktec_audit/.test(process.env.DATABASE_URL ?? "")) {
  console.error(
    "Refusing to run: DATABASE_URL is not the audit database. Source scripts/ui-audit/env.sh first.",
  );
  process.exit(1);
}

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const OUT = process.argv[2] ?? ".audit/shots/walk-tech";
// Run from the repository root, as every script here is.
const PHOTOS = `${process.cwd()}/scripts/ui-audit/photos`;

let step = 0;
const log: string[] = [];

async function shot(page: Page, name: string, full = false) {
  step += 1;
  const file = `${OUT}/${String(step).padStart(2, "0")}-${name}.png`;
  await page.waitForTimeout(350);
  await page.screenshot({ path: file, fullPage: full });
  console.log(`shot ${file}`);
}

async function attempt(label: string, work: () => Promise<void>) {
  try {
    await work();
    log.push(`ok    ${label}`);
  } catch (error) {
    const message = (error as Error).message.split("\n")[0].slice(0, 220);
    log.push(`FAIL  ${label}: ${message}`);
    console.log(`FAIL  ${label}: ${message}`);
  }
}

async function tab(page: Page, name: string) {
  await page.getByRole("tab", { name: new RegExp(`^${name}`) }).click();
  await page.waitForTimeout(200);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const tech = await db.user.findUniqueOrThrow({ where: { email: "tech@417group.org" } });
  const job = await db.job.findFirstOrThrow({
    where: {
      lifecycle: "SCHEDULED",
      title: { startsWith: "Elevator emergency line" },
      revisitNumber: null,
      assignments: { some: { userId: tech.id } },
    },
    select: { id: true, intWoId: true },
  });
  console.log(`job ${job.intWoId} ${job.id}`);

  const token = await encode({
    token: { sub: tech.nextcloudSub!, userId: tech.id },
    secret: process.env.AUTH_SECRET!,
    salt: "authjs.session-token",
    maxAge: 3600,
  });

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    hasTouch: true,
    isMobile: true,
    timezoneId: "America/Los_Angeles",
    locale: "en-US",
  });
  await context.addCookies([{ name: "authjs.session-token", value: token, url: BASE }]);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text().slice(0, 300));
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message.slice(0, 300)}`));
  page.on("response", (response) => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url().replace(BASE, "")}`);
  });

  await page.goto(`${BASE}/jobs/${job.id}`, { waitUntil: "networkidle" });
  await shot(page, "job-scheduled");

  await attempt("open the job menu", async () => {
    await page.getByRole("button", { name: "Job settings" }).click();
    await shot(page, "job-menu");
    await page.getByRole("button", { name: "Close job settings" }).click();
  });

  await attempt("clock in", async () => {
    await page.getByRole("button", { name: "Clock in", exact: true }).click();
    await shot(page, "clock-picker");
    await page.locator("button:has-text('now')").first().click();
    await page.waitForSelector("text=On site since", { timeout: 15_000 });
    await shot(page, "clocked-in");
  });

  await attempt("break", async () => {
    await page.getByRole("button", { name: "Break", exact: true }).click();
    await page.getByRole("button", { name: "End break" }).waitFor({ timeout: 10_000 });
    await shot(page, "on-break");
    await page.getByRole("button", { name: "End break" }).click();
    await page.getByRole("button", { name: "Break", exact: true }).waitFor({ timeout: 10_000 });
  });

  await attempt("scope checkbox", async () => {
    const box = page.getByRole("checkbox").first();
    if (await box.count()) {
      await box.check();
      await shot(page, "scope-checked");
    }
  });

  await attempt("add a MOD", async () => {
    await page.getByRole("button", { name: "Add" }).first().click();
    await shot(page, "contact-form");
    await page.locator("#mod-name, input[name='name']").first().fill("Dana Reyes");
    await shot(page, "contact-form-filled");
    await page.getByRole("button", { name: /^Save|^Add contact|^Add$/ }).last().click();
    await page.waitForTimeout(800);
    await shot(page, "contact-saved");
  });

  await attempt("notes tab", async () => {
    await tab(page, "Notes");
    await shot(page, "notes-tab", true);
    const area = page.locator("textarea").first();
    await area.fill("Traced the line from the MPOE to the elevator machine room. Bad splice at the 66 block; re-punched and tested dial tone to the car.");
    await page.waitForTimeout(1500);
    await shot(page, "notes-typed", true);
  });

  await attempt("reimbursement", async () => {
    await page.getByRole("button", { name: "Add claim" }).click();
    await shot(page, "claim-form", true);
    await page.locator("#reimb-quantity").fill("2");
    await page.locator("#reimb-each").fill("4");
    await page.locator("#reimb-label").fill("Cat6 Keystone");
    await shot(page, "claim-form-filled");
    await page.getByRole("button", { name: "Save claim" }).click();
    await page.waitForTimeout(1000);
    await shot(page, "claim-saved", true);
  });

  await attempt("deliverables tab", async () => {
    await tab(page, "Deliverables");
    await shot(page, "deliverables-tab", true);
  });

  for (const [section, files] of [
    ["Pre-Install", ["photo1.jpg", "photo3.jpg"]],
    ["Post Install", ["photo2.jpg", "photo4.jpg"]],
  ] as const) {
    await attempt(`photos into ${section}`, async () => {
      await page.getByRole("button", { name: `Add to ${section}` }).click();
      await page.waitForTimeout(300);
      await shot(page, `add-to-${section.toLowerCase().replace(/\s+/g, "-")}`);
      await page
        .locator('input[type="file"]:not([id^="doc-"])')
        .first()
        .setInputFiles(files.map((file) => `${PHOTOS}/${file}`));
      await page.waitForTimeout(1200);
      await shot(page, `photos-picked-${section.toLowerCase().replace(/\s+/g, "-")}`, true);
      await page.getByRole("button", { name: "Save", exact: true }).first().click();
      await page.waitForTimeout(2500);
      await shot(page, `photos-saved-${section.toLowerCase().replace(/\s+/g, "-")}`, true);
    });
  }

  await attempt("open a photo", async () => {
    await page.locator("img[src*='/api/files/']").first().click();
    await page.waitForTimeout(800);
    await shot(page, "photo-viewer");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  });

  await attempt("clock out: the checkout", async () => {
    await page.getByRole("button", { name: "Clock out", exact: true }).click();
    await page.waitForTimeout(500);
    await shot(page, "checkout-1");
    for (let index = 2; index <= 9; index++) {
      const completed = page.getByRole("button", { name: "Completed", exact: true });
      if (await completed.count()) await completed.click().catch(() => {});
      const release = page.locator("#release-code");
      if (await release.count()) await release.fill("RLS-4417").catch(() => {});
      const picker = page.locator("#mod-picker");
      if (await picker.count()) await picker.selectOption({ index: 0 }).catch(() => {});
      const modName = page.locator("#mod-name");
      if ((await modName.count()) && !(await modName.inputValue())) await modName.fill("Dana Reyes").catch(() => {});

      const next = page.getByRole("button", { name: "Continue" });
      if (!(await next.count())) break;
      if (await next.isDisabled()) {
        // Signatures: draw one where a pad is waiting, or skip it.
        const canvas = page.locator("canvas").first();
        if (await canvas.count()) {
          const box = await canvas.boundingBox();
          if (box) {
            await page.mouse.move(box.x + 30, box.y + box.height / 2);
            await page.mouse.down();
            await page.mouse.move(box.x + 120, box.y + 20, { steps: 6 });
            await page.mouse.move(box.x + 220, box.y + box.height - 20, { steps: 6 });
            await page.mouse.up();
          }
        }
      }
      await shot(page, `checkout-${index}-before-continue`);
      if (await next.isDisabled()) break;
      await next.click();
      await page.waitForTimeout(500);
      await shot(page, `checkout-${index}`);
    }
  });

  await attempt("finish", async () => {
    const out = page.getByRole("button", { name: "Clock out now" });
    if (await out.count()) {
      await out.click();
      await page.waitForTimeout(2500);
    }
    await shot(page, "after-checkout", true);
  });

  console.log("\n--- steps ---\n" + log.join("\n"));
  console.log("\n--- console/network errors ---\n" + (errors.length ? [...new Set(errors)].join("\n") : "none"));
  await browser.close();
  await db.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});
