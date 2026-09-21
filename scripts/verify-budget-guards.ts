import "dotenv/config";
import { encode } from "@auth/core/jwt";
import { chromium } from "playwright";
import { db } from "@/lib/db";

/**
 * The doors round a total tech budget.
 *
 * Every one of these is a path the audit found open: a way to change what
 * somebody is paid on a job whose money is a total shared between the crew,
 * without the total moving with it — or after a cheque had already been
 * written against it.
 *
 * Driven through the browser rather than called directly, because the guards
 * live in server actions and a guard nobody can reach from the interface is
 * not a guard.
 */

const BASE = process.env.VERIFY_BASE ?? "http://127.0.0.1:3000";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label}\n      got ${actual}${ok ? "" : `  want ${expected}`}`,
  );
}

/** The job page's blocks are collapsible, so a hidden control is not a gone one. */
async function openSection(
  page: import("playwright").Page,
  title: string | RegExp,
) {
  const summary = page.locator("summary", {
    hasText: typeof title === "string" ? new RegExp(`^${title}`) : title,
  });
  await summary.first().waitFor({ state: "visible", timeout: 15_000 });
  const details = summary.first().locator("xpath=..");
  if ((await details.getAttribute("open")) === null) {
    await summary.first().click();
    await page.waitForTimeout(200);
  }
}

async function tokenFor(email: string) {
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  return encode({
    token: { sub: user.nextcloudSub!, userId: user.id },
    secret: process.env.AUTH_SECRET!,
    salt: "authjs.session-token",
    maxAge: 3600,
  });
}

async function main() {
  const job = await db.job.findFirstOrThrow({
    where: { title: "Elevator phone line" },
    select: {
      id: true,
      assignments: {
        orderBy: { createdAt: "asc" },
        select: { id: true, userId: true, user: { select: { name: true } } },
      },
    },
  });
  const lead = job.assignments[0];

  // A budget, so there is something for the doors to protect.
  await db.job.update({
    where: { id: job.id },
    data: {
      budgetType: "FLAT",
      budgetFlat: "400.00",
      budgetFlatHours: null,
      budgetHourly: null,
      budgetSplit: "EVEN",
    },
  });
  await db.jobAssignment.updateMany({
    where: { jobId: job.id },
    data: { shareBasisPoints: null },
  });
  const { resplitJob } = await import("@/lib/budget-split");
  await resplitJob(job.id);

  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH,
  });
  const context = await browser.newContext({
    viewport: { width: 1100, height: 900 },
  });
  await context.addCookies([
    { name: "authjs.session-token", value: await tokenFor("boss@417group.org"), url: BASE },
  ]);
  const page = await context.newPage();

  // --- the budget owns the crew's lines, so a per-tech rate has no door ----
  await page.goto(`${BASE}/jobs/${job.id}`, { waitUntil: "load" });
  await page.waitForTimeout(900);
  await openSection(page, /Crew/);
  check(
    "the crew block is open, so a missing control is missing rather than folded",
    await page.getByRole("button", { name: "Add a tech", exact: true }).count(),
    1,
  );
  check(
    "no per-tech rate button while the job is on a budget",
    await page.getByRole("button", { name: /^Set pay for/ }).count(),
    0,
  );

  // --- and the old whole-job rate form is not offered either ---------------
  await page.goto(`${BASE}/jobs/${job.id}/manage/schedule`, { waitUntil: "load" });
  await page.waitForTimeout(900);
  check(
    "the older one-rate-for-everybody card is put away",
    await page.getByRole("heading", { name: "Pay, the old way" }).count(),
    0,
  );
  check(
    "and the budget editor is what is offered instead",
    await page.getByRole("heading", { name: "Total tech budget" }).isVisible(),
    true,
  );

  // --- a week that has been approved stops a crew change ------------------
  // A week of its own, far from anything the fixtures use, and cleared first
  // so a run that died half way through does not block the next one.
  const weekStart = new Date("2027-03-01T08:00:00Z");
  await db.payrollPeriod.deleteMany({
    where: { userId: lead.userId, weekStart },
  });

  const period = await db.payrollPeriod.create({
    data: {
      userId: lead.userId,
      weekStart,
      weekEnd: new Date("2027-03-08T08:00:00Z"),
      status: "APPROVED",
      expectedAmount: "200.00",
      lines: {
        create: {
          assignmentId: lead.id,
          payType: "FLAT",
          payRate: "200.00",
          paidMinutes: 480,
          laborAmount: "200.00",
          totalExpected: "200.00",
        },
      },
    },
    select: { id: true },
  });

  const before = await db.jobAssignment.findMany({
    where: { jobId: job.id },
    select: { id: true, payRate: true },
    orderBy: { createdAt: "asc" },
  });

  const spare = await db.user.findFirstOrThrow({
    where: {
      active: true,
      id: { notIn: job.assignments.map((one) => one.userId) },
      baseRole: { in: ["TECH", "SUPERVISOR"] },
    },
    select: { id: true, name: true },
  });

  await page.goto(`${BASE}/jobs/${job.id}`, { waitUntil: "load" });
  await page.waitForTimeout(900);
  await openSection(page, /Crew/);
  await page.getByRole("button", { name: "Add a tech", exact: true }).click();
  await page.waitForTimeout(400);
  // The picker is a combobox: a button that opens a search field.
  await page.locator("#crew-add").click();
  await page.waitForTimeout(300);
  await page.getByRole("combobox").fill(spare.name);
  await page.waitForTimeout(500);
  await page.getByRole("option", { name: spare.name }).first().click();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "Add to crew", exact: true }).click();
  await page.waitForTimeout(1800);

  check(
    "adding a tech to a paid budget is refused",
    await page
      .getByText(/a week on it has already been approved/i)
      .isVisible()
      .catch(() => false),
    true,
  );
  check(
    "and nobody was added",
    await db.jobAssignment.count({ where: { jobId: job.id } }),
    before.length,
  );

  const after = await db.jobAssignment.findMany({
    where: { jobId: job.id },
    select: { id: true, payRate: true },
    orderBy: { createdAt: "asc" },
  });
  check(
    "so the approved line still matches what the crew is on",
    after.map((one) => one.payRate.toString()).join("/"),
    before.map((one) => one.payRate.toString()).join("/"),
  );

  // --- put it all back ----------------------------------------------------
  await db.payrollPeriod.delete({ where: { id: period.id } });
  await db.job.update({
    where: { id: job.id },
    data: {
      budgetType: null,
      budgetFlat: null,
      budgetFlatHours: null,
      budgetHourly: null,
      budgetSplit: "EVEN",
    },
  });
  await db.jobAssignment.updateMany({
    where: { jobId: job.id },
    data: { shareBasisPoints: null, payFlat: null, payFlatHours: null },
  });

  await context.close();
  await browser.close();
  console.log(
    `\n${failures === 0 ? "ALL BUDGET GUARD CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`,
  );
  await db.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
