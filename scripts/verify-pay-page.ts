import "dotenv/config";
import { encode } from "next-auth/jwt";
import { chromium, type BrowserContext, type Page } from "playwright";
import { startOfWeekMonday, isoDateInZone } from "@/lib/datetime";
import { db } from "@/lib/db";
import { weekRange } from "@/lib/payroll";

/**
 * Pay and Payroll, in a real browser.
 *
 * Two screens for two people, so the suite is organised the same way. Pay is
 * what one person earned and never changes anything; Payroll is what the
 * company owes and is where every decision is made. The checks that matter
 * most are the ones about who sees which — the old split was wrong in a way no
 * unit test would notice, because it was a question of what is on screen.
 *
 * Also checks the navigation, which nothing ever did: a destination nobody can
 * reach is the same as one that does not exist, and Payroll is new.
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
  const boss = await tokenFor("boss@417group.org");
  const admin = await tokenFor("admin@417group.org");

  // A week well in the past, so "this week" in the UI can never collide with it.
  const week = weekRange(new Date("2026-06-17T12:00:00Z"), TZ);
  const weekParam = isoDateInZone(week.start, TZ);
  const monthParam = weekParam.slice(0, 7);

  await db.payrollPeriod.deleteMany({
    where: { userId: { in: [tech.user.id, boss.user.id] } },
  });
  // A failed run leaves its fixture behind and the next one then sees two jobs
  // in the week.
  await db.job.deleteMany({ where: { title: { startsWith: "Pay flow" } } });

  const client = await db.client.findFirstOrThrow();
  const customer = await db.customer.findFirstOrThrow();
  const site = await db.site.findFirstOrThrow();

  /** One worked day inside the test week. */
  async function workedJob(input: {
    title: string;
    userId: string;
    payRate: string | null;
    dayOffset: number;
    hours: number;
  }) {
    const job = await db.job.create({
      data: {
        intWoId: `2026-06-0000-${Math.floor(Math.random() * 9000 + 1000)}`,
        intWoSequence: 1,
        title: input.title,
        clientId: client.id,
        customerId: customer.id,
        siteId: site.id,
        createdById: boss.user.id,
      },
    });
    const assignment = await db.jobAssignment.create({
      data: {
        jobId: job.id,
        userId: input.userId,
        payType: input.payRate ? "HOURLY" : "NON_BILLABLE",
        payRate: input.payRate ?? "0",
      },
    });
    const start = new Date(
      week.start.getTime() + input.dayOffset * 86_400_000 + 15 * 3_600_000,
    );
    await db.visit.create({
      data: {
        assignmentId: assignment.id,
        clockInAt: start,
        clockOutAt: new Date(start.getTime() + input.hours * 3_600_000),
      },
    });
    return job;
  }

  // Eight hours at $45 on the Monday, and a second day so the week has shape.
  const jobOne = await workedJob({
    title: "Pay flow job",
    userId: tech.user.id,
    payRate: "45",
    dayOffset: 0,
    hours: 8,
  });
  const jobTwo = await workedJob({
    title: "Pay flow second day",
    userId: tech.user.id,
    payRate: "45",
    dayOffset: 2,
    hours: 4,
  });
  // Somebody with no rate at all, which payroll has to call out rather than
  // total quietly to zero.
  const jobNoRate = await workedJob({
    title: "Pay flow unrated",
    userId: boss.user.id,
    payRate: null,
    dayOffset: 1,
    hours: 5,
  });

  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
  });

  async function sessionFor(token: string): Promise<BrowserContext> {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    await context.addCookies([
      { name: "authjs.session-token", value: token, url: BASE },
    ]);
    return context;
  }

  async function open(context: BrowserContext, path: string): Promise<Page> {
    const page = await context.newPage();
    await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
    return page;
  }

  // --- navigation ----------------------------------------------------------
  // Never checked before, and Payroll is a new destination: whether a link is
  // in the bar is the whole of whether somebody can get there.
  async function navLabels(context: BrowserContext): Promise<string[]> {
    const page = await open(context, "/more");
    const labels = await page.locator("nav a, main a").allInnerTexts();
    await page.close();
    return labels.map((label) => label.trim());
  }

  const techContext = await sessionFor(tech.token);
  const supContext = await sessionFor(sup.token);
  const bossContext = await sessionFor(boss.token);
  const adminContext = await sessionFor(admin.token);

  const techNav = await navLabels(techContext);
  check("a tech is offered Pay", techNav.includes("Pay"), true);
  check("and not Payroll", techNav.includes("Payroll"), false);

  const supNav = await navLabels(supContext);
  check("a supervisor is offered Pay", supNav.includes("Pay"), true);
  check(
    "and not Payroll either — their pay reach is their own",
    supNav.includes("Payroll"),
    false,
  );

  const bossNav = await navLabels(bossContext);
  check("a manager is offered Pay", bossNav.includes("Pay"), true);
  check("and Payroll", bossNav.includes("Payroll"), true);

  const adminNav = await navLabels(adminContext);
  check("an administrator is offered Payroll", adminNav.includes("Payroll"), true);

  // --- Pay is own money, and nobody else's ---------------------------------
  const techWeeks = await open(techContext, "/pay");
  check(
    "Pay opens on the weeks behind you",
    await techWeeks.getByText("Weekly", { exact: true }).isVisible(),
    true,
  );
  check(
    "with a Monthly scale beside it",
    await techWeeks.getByText("Monthly", { exact: true }).isVisible(),
    true,
  );
  // The switcher is gone: whose money this is is no longer a question the page
  // asks. Checked by name so a future "You" badge cannot pass by accident.
  check(
    "and no switcher to somebody else's money",
    await techWeeks.getByText(sup.user.name).count(),
    0,
  );
  // Lowercase in the DOM; the capitals on screen are CSS.
  check(
    "the week blocks carry a week number",
    await techWeeks.getByText("week", { exact: true }).first().isVisible(),
    true,
  );

  const techWeek = await open(techContext, `/pay?week=${weekParam}`);
  check(
    "a week shows what was earned",
    await techWeek.getByText("$540.00").first().isVisible(),
    true,
  );
  check(
    "and the hours behind it",
    await techWeek.getByText("12.00").first().isVisible(),
    true,
  );
  check(
    "the day breakdown is on the same screen",
    await techWeek.getByText("Day by day").isVisible(),
    true,
  );
  // Twice on the page on purpose: once in the day it landed on, once in the
  // list of the week's jobs.
  check(
    "and so are the jobs",
    await techWeek.getByText("Pay flow job").count(),
    2,
  );
  check(
    "a week nobody has built says so rather than looking settled",
    await techWeek.getByText(/come straight from your time records/).isVisible(),
    true,
  );
  check(
    "a tech is offered no approve button on their own pay",
    await techWeek.getByRole("button", { name: /Approve/ }).count(),
    0,
  );
  check(
    "nor a build button",
    await techWeek.getByRole("button", { name: /Build/ }).count(),
    0,
  );

  const techMonth = await open(techContext, `/pay?month=${monthParam}`);
  check(
    "the month rolls the same money up",
    await techMonth.getByText("$540.00").first().isVisible(),
    true,
  );
  check(
    "and lists the weeks inside it",
    await techMonth.getByText(/Weeks in/).isVisible(),
    true,
  );
  // Arriving at a week from a month has to land on the same screen as arriving
  // from the list, which is the whole point of there being one week screen.
  await techMonth.getByText("Day by day").count();
  await techMonth
    .locator(`a[href*="week=${weekParam}"]`)
    .first()
    .click();
  await techMonth.waitForSelector("text=Day by day", { timeout: 20_000 });
  check(
    "a week reached from a month is the same screen",
    await techMonth.getByText("Day by day").isVisible(),
    true,
  );

  // --- Payroll is for whoever pays -----------------------------------------
  const techPayroll = await open(techContext, "/payroll");
  check(
    "a tech sent to Payroll lands on their own Pay instead",
    new URL(techPayroll.url()).pathname,
    "/pay",
  );

  const supPayroll = await open(supContext, "/payroll");
  check(
    "and so does a supervisor",
    new URL(supPayroll.url()).pathname,
    "/pay",
  );

  const bossPayroll = await open(bossContext, `/payroll?week=${weekParam}`);
  check(
    "a manager opens on the week across everybody",
    await bossPayroll.getByText("Who is in this week").isVisible(),
    true,
  );
  check(
    "the tech is in it",
    await bossPayroll.getByText(tech.user.name).isVisible(),
    true,
  );
  check(
    "somebody with no rate is called out rather than shown as $0.00",
    await bossPayroll.getByText("Needs a rate").first().isVisible(),
    true,
  );

  // One button for the whole week, rather than one per person.
  await bossPayroll
    .getByRole("button", { name: /Build the whole week/ })
    .click();
  await bossPayroll.waitForSelector("text=In review", { timeout: 20_000 });

  const period = await db.payrollPeriod.findFirstOrThrow({
    where: { userId: tech.user.id, weekStart: week.start },
    include: { lines: true },
  });
  check("the week was built for the tech", period.lines.length, 2);
  // 12 hours at $45.
  check("expected total", period.expectedAmount.toString(), "540");
  check("status starts as draft", period.status, "DRAFT");

  const alsoBuilt = await db.payrollPeriod.count({
    where: { weekStart: week.start },
  });
  check("and for everybody else in the week too", alsoBuilt >= 2, true);

  // --- approving -----------------------------------------------------------
  const bossPerson = await open(
    bossContext,
    `/payroll/${tech.user.id}?week=${weekParam}`,
  );
  check(
    "the person's week opens on what is owed",
    await bossPerson.getByText("Expected").first().isVisible(),
    true,
  );

  await bossPerson.getByRole("button", { name: /Approve the week/ }).click();
  await bossPerson.waitForSelector("text=APPROVED", { timeout: 20_000 });

  const approved = await db.payrollPeriod.findUniqueOrThrow({
    where: { id: period.id },
  });
  check("approved by the direct supervisor", approved.approvedById, boss.user.id);
  check("not flagged as a fallback", approved.approvedAsFallback, false);

  // What the tech is told changes with it, which is the point of showing
  // payroll's stage next to money read off the clock.
  const techAfter = await open(techContext, `/pay?week=${weekParam}`);
  check(
    "the tech's own week now reads as approved",
    await techAfter.getByText("Approved").first().isVisible(),
    true,
  );

  // --- a short payment lands as REDUCED ------------------------------------
  await bossPerson.getByRole("button", { name: "Record the week" }).click();
  await bossPerson.locator("#received-amount-week").fill("480.00");
  await bossPerson.locator("#received-note-week").fill("Client withheld travel");
  await bossPerson.getByRole("button", { name: "Save week payment" }).click();
  // Not "text=REDUCED": the form's own warning says that word before anything
  // is saved. The shortfall line only renders once the period has an amount.
  await bossPerson.waitForSelector("text=$60.00 short", { timeout: 20_000 });

  const reduced = await db.payrollPeriod.findUniqueOrThrow({
    where: { id: period.id },
  });
  check("short payment marks the week REDUCED", reduced.status, "REDUCED");
  check("received amount stored", reduced.receivedAmount?.toString(), "480");

  // Per-job received is recorded separately, which is what makes a short week
  // traceable to the job that caused it.
  await bossPerson
    .getByRole("button", { name: "Record for this job" })
    .last()
    .click();
  await bossPerson.locator('[id^="received-amount-"]').last().fill("100.00");
  await bossPerson.getByRole("button", { name: "Save job payment" }).click();
  await bossPerson.waitForTimeout(2500);

  const shortLine = await db.payrollLine.findFirst({
    where: { payrollPeriodId: period.id, payStatus: "REDUCED" },
  });
  check("a job line can be REDUCED on its own", Boolean(shortLine), true);

  // --- an administrator runs the money too ---------------------------------
  // The role used to be able to read payroll and nothing else, so a week routed
  // to an administrator could never be approved by anybody. Checked on its own
  // untouched week, because a week already built offers nothing to build.
  const adminWeek = weekRange(new Date("2026-06-24T12:00:00Z"), TZ);
  const adminWeekParam = isoDateInZone(adminWeek.start, TZ);
  const techTwo = await db.user.findUniqueOrThrow({
    where: { email: "tech2@417group.org" },
  });
  await db.payrollPeriod.deleteMany({ where: { weekStart: adminWeek.start } });

  const jobAdmin = await db.job.create({
    data: {
      intWoId: `2026-06-0000-${Math.floor(Math.random() * 9000 + 1000)}`,
      intWoSequence: 1,
      title: "Pay flow admin week",
      clientId: client.id,
      customerId: customer.id,
      siteId: site.id,
      createdById: boss.user.id,
    },
  });
  const adminAssignment = await db.jobAssignment.create({
    data: {
      jobId: jobAdmin.id,
      userId: techTwo.id,
      payType: "HOURLY",
      payRate: "52",
    },
  });
  await db.visit.create({
    data: {
      assignmentId: adminAssignment.id,
      clockInAt: new Date(adminWeek.start.getTime() + 15 * 3_600_000),
      clockOutAt: new Date(adminWeek.start.getTime() + 23 * 3_600_000),
    },
  });

  const adminPayroll = await open(
    adminContext,
    `/payroll?week=${adminWeekParam}`,
  );
  check(
    "an administrator reaches Payroll",
    await adminPayroll.getByText("Who is in this week").isVisible(),
    true,
  );
  check(
    "and sees the person who reports to them",
    await adminPayroll.getByText(techTwo.name).isVisible(),
    true,
  );

  await adminPayroll
    .getByRole("button", { name: /Build the whole week/ })
    .click();
  await adminPayroll.waitForSelector("text=In review", { timeout: 20_000 });

  const adminPerson = await open(
    adminContext,
    `/payroll/${techTwo.id}?week=${adminWeekParam}`,
  );
  await adminPerson.getByRole("button", { name: /Approve the week/ }).click();
  await adminPerson.waitForSelector("text=APPROVED", { timeout: 20_000 });

  const adminApproved = await db.payrollPeriod.findFirstOrThrow({
    where: { userId: techTwo.id, weekStart: adminWeek.start },
  });
  check(
    "an administrator can build and approve a week",
    adminApproved.approvedById,
    admin.user.id,
  );
  check(
    "as the direct supervisor, not as a fallback",
    adminApproved.approvedAsFallback,
    false,
  );

  // --- the spreadsheet ------------------------------------------------------
  const download = await bossPerson.request.get(
    `${BASE}/api/pay/export?week=${weekParam}&user=${tech.user.id}`,
  );
  check("pay journal downloads", download.status(), 200);
  const body = await download.body();
  check("pay journal is an xlsx", body.subarray(0, 2).toString(), "PK");

  // A tech may pull their own journal but not someone else's.
  const ownJournal = await techWeek.request.get(
    `${BASE}/api/pay/export?week=${weekParam}&user=${tech.user.id}`,
  );
  check("a tech can export their own journal", ownJournal.status(), 200);
  const othersJournal = await techWeek.request.get(
    `${BASE}/api/pay/export?week=${weekParam}&user=${boss.user.id}`,
  );
  check("a tech cannot export someone else's", othersJournal.status(), 404);

  // --- statistics ----------------------------------------------------------
  const techStats = await open(techContext, "/pay/stats?period=all");
  check(
    "stats render for a tech",
    await techStats.getByText("Blended hourly").isVisible(),
    true,
  );
  check(
    "and are their own, with nobody else to pick",
    await techStats.getByText("Your figures", { exact: false }).isVisible(),
    true,
  );

  await browser.close();
  await db.job.deleteMany({
    where: { id: { in: [jobOne.id, jobTwo.id, jobNoRate.id, jobAdmin.id] } },
  });
  await db.payrollPeriod.deleteMany({
    where: { weekStart: { in: [week.start, adminWeek.start] } },
  });
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
