import "dotenv/config";

/**
 * The unfinished new-job form.
 *
 * Half of this suite is a regression test with a date on it: a refused submit
 * used to come back with Assignment ID, Ticket #, INC # and the whole scope of
 * work blank, because React resets a form once its action has run and those
 * four were the only fields not held in React state. The other half is the
 * draft itself — written while you type, offered rather than applied when you
 * come back, and never thrown away without being asked.
 *
 * Needs the app running on BASE_URL with the same AUTH_SECRET.
 */
import { encode } from "next-auth/jwt";
import { chromium } from "playwright";
import { db } from "@/lib/db";

const BASE = "http://127.0.0.1:3000";
let failures = 0;
function check(what: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}\n      got ${JSON.stringify(got)}`);
}

async function main() {
  const boss = await db.user.findUniqueOrThrow({ where: { email: "boss@417group.org" } });
  await db.jobDraft.deleteMany({ where: { userId: boss.id } });

  const token = await encode({
    token: { sub: boss.nextcloudSub!, userId: boss.id },
    secret: process.env.AUTH_SECRET!, salt: "authjs.session-token", maxAge: 3600,
  });

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addCookies([{ name: "authjs.session-token", value: token, url: BASE }]);
  const page = await ctx.newPage();

  await page.goto(`${BASE}/jobs/new`, { waitUntil: "load" });
  await page.waitForTimeout(1200);

  // The form rests with everything optional folded away, so anything below the
  // two required fields has to be opened first — which is the point of it.
  const closed = await page.locator("details:not([open]) > summary").count();
  check("the form rests with its optional parts closed", closed > 0, true);
  const tall = await page.evaluate(() => document.body.scrollHeight);
  console.log(`      page is ${tall}px at 390 wide (${(tall / 844).toFixed(1)} screens)`);

  async function open(title: string) {
    const row = page.locator("summary", { hasText: title }).first();
    if ((await row.locator("xpath=..").getAttribute("open")) === null) {
      await row.click();
      await page.waitForTimeout(250);
    }
  }
  await open("Numbers");
  await open("Scope of work");

  await page.fill("#externalAssignmentId", "A-12345");
  await page.fill("#ticketNumber", "TK-99887");
  await page.fill("#incNumber", "INC0042");
  await page.fill('textarea[name="scopeOfWork"]', "Swap the failed switch at rack 3");
  await page.fill("#title", "Repro job");

  // --- the bug: a refused submit must keep everything -----------------------
  await page.getByRole("button", { name: /create job/i }).first().click();
  await page.waitForTimeout(2500);

  check("a section left open stays open", await page.locator("details[open] summary", { hasText: "Numbers" }).count(), 1);
  check("assignment id survives a refused submit", await page.inputValue("#externalAssignmentId"), "A-12345");
  check("ticket number survives", await page.inputValue("#ticketNumber"), "TK-99887");
  check("inc number survives", await page.inputValue("#incNumber"), "INC0042");
  check("scope of work survives", await page.inputValue('textarea[name="scopeOfWork"]'), "Swap the failed switch at rack 3");
  check("and so does the title", await page.inputValue("#title"), "Repro job");

  // --- autosave ------------------------------------------------------------
  await page.waitForTimeout(1800);
  const saved = await db.jobDraft.findUnique({ where: { userId: boss.id } });
  check("a draft was written", Boolean(saved), true);
  const payload = (saved?.payload ?? {}) as Record<string, unknown>;
  check("with the fields in it", payload.externalAssignmentId, "A-12345");
  check("and the scope", payload.scopeOfWork, "Swap the failed switch at rack 3");
  check("the footer says so", /Draft saved|Saving/.test(await page.locator("form").innerText()), true);

  // --- coming back ---------------------------------------------------------
  const page2 = await ctx.newPage();
  await page2.goto(`${BASE}/jobs/new`, { waitUntil: "load" });
  await page2.waitForTimeout(1200);
  check("the banner is offered", await page2.getByText("You have an unfinished job").isVisible(), true);

  await page2.getByRole("button", { name: "Continue" }).click();
  await page2.waitForTimeout(600);
  await page2.locator("summary", { hasText: "Numbers" }).first().click();
  await page2.locator("summary", { hasText: "Scope of work" }).first().click();
  await page2.waitForTimeout(300);
  check("Continue puts it back", await page2.inputValue("#externalAssignmentId"), "A-12345");
  check("all of it", await page2.inputValue('textarea[name="scopeOfWork"]'), "Swap the failed switch at rack 3");

  // --- start fresh keeps the old one ---------------------------------------
  const page3 = await ctx.newPage();
  await page3.goto(`${BASE}/jobs/new`, { waitUntil: "load" });
  await page3.waitForTimeout(1200);
  await page3.getByRole("button", { name: "Start fresh" }).click();
  await page3.waitForTimeout(500);
  check("Start fresh leaves the form empty", await page3.inputValue("#title"), "");
  const still = await db.jobDraft.findUnique({ where: { userId: boss.id } });
  check("and does not delete the old draft", Boolean(still), true);

  await browser.close();
  await db.jobDraft.deleteMany({ where: { userId: boss.id } });
  await db.$disconnect();
  console.log(failures === 0 ? "\nALL DRAFT CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}
main();
