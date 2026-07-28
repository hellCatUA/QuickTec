import "dotenv/config";
import { chromium } from "playwright";
import { encode } from "next-auth/jwt";
import { db } from "@/lib/db";

/**
 * Drives the job page in a real browser: clock in, take a break, end it, clock
 * out, and check what the database ends up holding.
 *
 * The clock is the one part of this app nobody can eyeball for correctness —
 * it decides what a tech gets paid — so it is exercised end to end rather than
 * through the actions alone.
 *
 * Needs the app already running on BASE_URL with the same AUTH_SECRET.
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

async function main() {
  const tech = await db.user.findUniqueOrThrow({
    where: { email: "tech@417group.org" },
  });

  const assignment = await db.jobAssignment.findFirstOrThrow({
    where: { userId: tech.id },
    select: { id: true, jobId: true },
  });

  // Start from a clean slate so repeated runs are comparable.
  await db.visit.deleteMany({ where: { assignmentId: assignment.id } });
  await db.job.update({
    where: { id: assignment.jobId },
    data: { lifecycle: "SCHEDULED", breakPaid: false },
  });

  const token = await encode({
    token: { sub: tech.nextcloudSub!, userId: tech.id },
    secret: process.env.AUTH_SECRET!,
    salt: "authjs.session-token",
    maxAge: 3600,
  });

  // PLAYWRIGHT_BROWSERS_PATH points at a pre-installed Chromium; let
  // Playwright resolve it rather than hard-coding a versioned path.
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, // iPhone-sized, where this is used
  });
  // url form rather than domain/path: an IP host is not a valid cookie
  // domain and Playwright silently drops it.
  await context.addCookies([
    { name: "authjs.session-token", value: token, url: BASE },
  ]);

  const page = await context.newPage();
  const url = `${BASE}/jobs/${assignment.jobId}`;
  await page.goto(url, { waitUntil: "domcontentloaded" });

  check(
    "job page renders for the assigned tech",
    await page.getByText("Not clocked in yet.").isVisible(),
    true,
  );

  await page.getByRole("button", { name: "Clock in", exact: true }).click();
  await page.waitForSelector("text=On site since", { timeout: 15_000 });

  const visit = await db.visit.findFirstOrThrow({
    where: { assignmentId: assignment.id },
  });
  check("clock-in snapped to 5 minutes", visit.clockInAt.getUTCMinutes() % 5, 0);
  check("raw press time is kept for audit", visit.clockInRawAt !== null, true);
  check(
    "job moved to in progress",
    (await db.job.findUniqueOrThrow({ where: { id: assignment.jobId } }))
      .lifecycle,
    "IN_PROGRESS",
  );

  // The elapsed counter has to actually move.
  const first = await page.locator("text=/^\\d+:\\d{2}:\\d{2}$/").first().innerText();
  await page.waitForTimeout(2200);
  const second = await page.locator("text=/^\\d+:\\d{2}:\\d{2}$/").first().innerText();
  check("elapsed counter ticks", first !== second, true);

  await page.getByRole("button", { name: "Break", exact: true }).click();
  await page.waitForSelector("text=On break", { timeout: 15_000 });
  check(
    "break recorded as unpaid, per the job setting",
    (await db.breakPeriod.findFirstOrThrow({ where: { visitId: visit.id } })).paid,
    false,
  );

  await page.getByRole("button", { name: "End break" }).click();
  // Wait for the button to flip back rather than for "Clock out", which is on
  // screen throughout and would match before the server had replied.
  await page
    .getByRole("button", { name: "Break", exact: true })
    .waitFor({ timeout: 15_000 });
  check(
    "break closed",
    (await db.breakPeriod.findFirstOrThrow({ where: { visitId: visit.id } }))
      .endAt !== null,
    true,
  );

  // The adjustment row should offer snapped times either side of now.
  await page.getByRole("button", { name: "Clock out early or later" }).click();
  await page.waitForSelector("text=Or enter a time", { timeout: 15_000 });
  const offsets = await page.locator("button:has-text('now')").count();
  check("the picker offers a 'now' option", offsets >= 1, true);

  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Clock out", exact: true }).click();
  await page
    .getByRole("button", { name: "Clock in", exact: true })
    .waitFor({ timeout: 15_000 });

  const closed = await db.visit.findUniqueOrThrow({ where: { id: visit.id } });
  check("clock-out stored", closed.clockOutAt !== null, true);
  check(
    "clock-out snapped to 5 minutes",
    closed.clockOutAt!.getUTCMinutes() % 5,
    0,
  );
  check(
    "job moved to pending review",
    (await db.job.findUniqueOrThrow({ where: { id: assignment.jobId } }))
      .lifecycle,
    "PENDING_REVIEW",
  );

  const events = await db.auditEvent.findMany({
    where: { jobId: assignment.jobId },
    select: { action: true },
  });
  const actions = new Set(events.map((event) => event.action));
  for (const action of ["clock_in", "break_start", "break_end", "clock_out"]) {
    check(`timeline records ${action}`, actions.has(action), true);
  }

  await browser.close();
  await db.$disconnect();

  console.log(
    `\n${failures === 0 ? "ALL BROWSER CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
