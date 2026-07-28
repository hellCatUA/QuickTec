import "dotenv/config";
import { encode } from "next-auth/jwt";
import { chromium } from "playwright";
import { db } from "@/lib/db";
import { weekRange } from "@/lib/payroll";

/**
 * Drives payroll in a real browser: build a week, approve it as the direct
 * supervisor, record a short payment, and check it lands as REDUCED at both
 * levels.
 *
 * The approval rule is the part worth exercising through the UI — who may
 * press the button is a business rule, not a permission flag, and it is easy
 * to get subtly wrong in a way no unit test would notice.
 *
 * Needs the app running on BASE_URL with the same AUTH_SECRET.
 */

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const TZ = "America/Los_Angeles";
let failures = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label}\n      got ${actual}${ok ? "" : `  want ${expected}`}`,
  );
}

async function tokenFor(email: string) {
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  return {
    user,
    token: await encode({
      token: { sub: user.nextcloudSub!, userId: user.id },
      secret: process.env.AUTH_SECRET!,
      salt: "authjs.session-token",
      maxAge: 3600,
    }),
  };
}

async function main() {
  const tech = await tokenFor("tech@417group.org");
  const sup = await tokenFor("sup@417group.org");

  // A week in the past, so "this week" in the UI cannot collide with it.
  const week = weekRange(new Date("2026-06-17T12:00:00Z"), TZ);
  const weekParam = "2026-06-15";

  await db.payrollPeriod.deleteMany({ where: { userId: tech.user.id } });
  // A failed run leaves its fixture behind and the next one then sees two jobs
  // in the week.
  await db.job.deleteMany({ where: { title: "Pay flow job" } });

  const client = await db.client.findFirstOrThrow();
  const customer = await db.customer.findFirstOrThrow();
  const site = await db.site.findFirstOrThrow();

  const job = await db.job.create({
    data: {
      intWoId: `2026-06-0000-${Math.floor(Math.random() * 9000 + 1000)}`,
      intWoSequence: 1,
      title: "Pay flow job",
      clientId: client.id,
      customerId: customer.id,
      siteId: site.id,
      createdById: sup.user.id,
    },
  });
  const assignment = await db.jobAssignment.create({
    data: {
      jobId: job.id,
      userId: tech.user.id,
      payType: "HOURLY",
      payRate: "45",
    },
  });
  await db.visit.create({
    data: {
      assignmentId: assignment.id,
      clockInAt: new Date("2026-06-17T15:00:00Z"),
      clockOutAt: new Date("2026-06-17T23:00:00Z"),
    },
  });

  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
  });

  async function sessionFor(token: string) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    await context.addCookies([
      { name: "authjs.session-token", value: token, url: BASE },
    ]);
    return context;
  }

  // --- the tech cannot build or approve their own week ---------------------
  const techContext = await sessionFor(tech.token);
  const techPage = await techContext.newPage();
  await techPage.goto(`${BASE}/pay?week=${weekParam}`, {
    waitUntil: "domcontentloaded",
  });

  check(
    "a tech sees their own pay page",
    await techPage.locator("text=Your pay").isVisible(),
    true,
  );
  check(
    "a tech is not offered the approve button",
    await techPage.getByRole("button", { name: /Approve week/ }).count(),
    0,
  );

  // --- the supervisor builds and approves ----------------------------------
  const supContext = await sessionFor(sup.token);
  const supPage = await supContext.newPage();
  await supPage.goto(`${BASE}/pay?user=${tech.user.id}&week=${weekParam}`, {
    waitUntil: "domcontentloaded",
  });

  await supPage.getByRole("button", { name: "Build this week" }).click();
  await supPage.waitForSelector("text=Week total", { timeout: 20_000 });

  const period = await db.payrollPeriod.findFirstOrThrow({
    where: { userId: tech.user.id, weekStart: week.start },
    include: { lines: true },
  });
  check("the week was built", period.lines.length, 1);
  // 8 hours at $45.
  check("expected total", period.expectedAmount.toString(), "360");
  check("status starts as draft", period.status, "DRAFT");

  await supPage.getByRole("button", { name: /Approve week/ }).click();
  await supPage.waitForSelector("text=APPROVED", { timeout: 20_000 });

  const approved = await db.payrollPeriod.findUniqueOrThrow({
    where: { id: period.id },
  });
  check("approved by the direct supervisor", approved.approvedById, sup.user.id);
  check("not flagged as a fallback", approved.approvedAsFallback, false);

  // --- a short payment lands as REDUCED ------------------------------------
  await supPage.getByRole("button", { name: "Record what arrived" }).click();
  await supPage.locator("#received-amount-week").fill("300.00");
  await supPage.locator("#received-note-week").fill("Client withheld travel");
  await supPage.getByRole("button", { name: "Save week payment" }).click();
  // Not "text=REDUCED": the form's own warning says that word before anything
  // is saved. The shortfall line only renders once the period has an amount.
  await supPage.waitForSelector("text=$60.00 short", { timeout: 20_000 });

  const reduced = await db.payrollPeriod.findUniqueOrThrow({
    where: { id: period.id },
  });
  check("short payment marks the week REDUCED", reduced.status, "REDUCED");
  check("received amount stored", reduced.receivedAmount?.toString(), "300");

  // Per-job received is recorded separately, which is what makes a short week
  // traceable to the job that caused it.
  await supPage.getByRole("button", { name: "Record for this job" }).first().click();
  await supPage.locator('[id^="received-amount-"]').first().fill("300.00");
  await supPage.getByRole("button", { name: "Save job payment" }).click();
  await supPage.waitForTimeout(2500);

  const line = await db.payrollLine.findFirstOrThrow({
    where: { payrollPeriodId: period.id },
  });
  check("the job line is REDUCED too", line.payStatus, "REDUCED");
  check("job-level received amount stored", line.receivedAmount?.toString(), "300");

  // --- the spreadsheet ------------------------------------------------------
  const download = await supPage.request.get(
    `${BASE}/api/pay/export?week=${weekParam}&user=${tech.user.id}`,
  );
  check("pay journal downloads", download.status(), 200);
  const body = await download.body();
  check("pay journal is an xlsx", body.subarray(0, 2).toString(), "PK");

  // A tech may pull their own journal but not someone else's.
  const ownJournal = await techPage.request.get(
    `${BASE}/api/pay/export?week=${weekParam}&user=${tech.user.id}`,
  );
  check("a tech can export their own journal", ownJournal.status(), 200);
  const othersJournal = await techPage.request.get(
    `${BASE}/api/pay/export?week=${weekParam}&user=${sup.user.id}`,
  );
  check("a tech cannot export someone else's", othersJournal.status(), 404);

  // --- statistics ----------------------------------------------------------
  await techPage.goto(`${BASE}/pay/stats?period=all`, {
    waitUntil: "domcontentloaded",
  });
  check(
    "stats render for a tech",
    await techPage.locator("text=Blended hourly").isVisible(),
    true,
  );

  await browser.close();
  await db.job.delete({ where: { id: job.id } });
  await db.$disconnect();

  console.log(
    `\n${failures === 0 ? "ALL PAY CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
