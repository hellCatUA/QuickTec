import "dotenv/config";
import { encode } from "next-auth/jwt";
import { chromium } from "playwright";
import { db } from "@/lib/db";
import { weekRange } from "@/lib/payroll";

/**
 * Drives the two "what has happened / what is waiting" pages in a real
 * browser: the approvals inbox and a site's history.
 *
 * Both are pure scope questions — the same URL has to show a supervisor a full
 * queue and a tech an empty one — so they are worth exercising through the UI,
 * where the session and the filters actually meet.
 *
 * Needs the app running on BASE_URL with the same AUTH_SECRET, and rewrites
 * unrelated jobs that are mid-flow so the inbox count is deterministic — a
 * development database only.
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
  const boss = await tokenFor("boss@417group.org");
  const sup = await tokenFor("sup@417group.org");
  const tech = await tokenFor("tech@417group.org");

  const client = await db.client.findFirstOrThrow();
  const customer = await db.customer.findFirstOrThrow();

  // A site of its own, so an earlier suite's fixtures cannot pad the history.
  const site = await db.site.upsert({
    where: {
      customerId_siteNumber: { customerId: customer.id, siteNumber: "90210" },
    },
    update: {},
    create: {
      customerId: customer.id,
      siteNumber: "90210",
      addressLine1: "500 Wilshire Blvd",
      city: "Beverly Hills",
      state: "CA",
      postalCode: "90210",
    },
  });

  // A failed run leaves its fixtures behind and the next one then counts two
  // of everything.
  await db.job.deleteMany({ where: { siteId: site.id } });
  await db.payrollPeriod.deleteMany({ where: { userId: tech.user.id } });
  await db.notification.deleteMany({ where: { userId: tech.user.id } });

  // Another suite's job left mid-flow lands in the same inbox and makes the
  // headline count meaningless, so everything outside this site is parked
  // first. Destructive, like the rest of these suites — dev database only.
  await db.changeRequest.updateMany({
    where: { status: "PENDING", job: { siteId: { not: site.id } } },
    data: { status: "REJECTED" },
  });
  await db.job.updateMany({
    where: {
      siteId: { not: site.id },
      lifecycle: { in: ["PENDING_REVIEW", "PENDING_APPROVAL"] },
    },
    data: { lifecycle: "SCHEDULED" },
  });

  const stamp = Math.floor(Math.random() * 9000 + 1000);
  const base = {
    clientId: client.id,
    customerId: customer.id,
    siteId: site.id,
  };

  // 1. A finished job waiting on a read-through, with a change request on it.
  const visited = await db.job.create({
    data: {
      ...base,
      intWoId: `2026-05-0000-${stamp}`,
      intWoSequence: stamp,
      title: "Site history job",
      createdById: sup.user.id,
      scheduledStart: new Date("2026-05-12T16:00:00Z"),
      lifecycle: "PENDING_REVIEW",
      outcome: "COMPLETED",
    },
  });
  const visitedAssignment = await db.jobAssignment.create({
    data: {
      jobId: visited.id,
      userId: tech.user.id,
      payType: "HOURLY",
      payRate: "45",
      isLead: true,
    },
  });
  await db.visit.create({
    data: {
      assignmentId: visitedAssignment.id,
      clockInAt: new Date("2026-05-12T16:05:00Z"),
      clockOutAt: new Date("2026-05-12T23:35:00Z"),
    },
  });
  await db.changeRequest.create({
    data: {
      jobId: visited.id,
      requestedById: tech.user.id,
      fieldPath: "scopeOfWork",
      oldValue: "Swap register 3",
      newValue: "Swap registers 3 and 4",
      reason: "Second register was down too",
      status: "PENDING",
    },
  });

  // 2. A revisit of it, so the history can say a second trip was needed.
  await db.job.create({
    data: {
      ...base,
      intWoId: `2026-06-0000-${stamp}-R1`,
      intWoSequence: stamp,
      title: "Site history job",
      createdById: sup.user.id,
      parentJobId: visited.id,
      revisitNumber: 1,
      scheduledStart: new Date("2026-06-02T16:00:00Z"),
    },
  });

  // 3. An ad-hoc job the tech raised themselves.
  await db.job.create({
    data: {
      ...base,
      intWoId: `2026-05-0000-${stamp + 1}`,
      intWoSequence: stamp + 1,
      title: "Ad-hoc call out",
      createdById: tech.user.id,
      lifecycle: "PENDING_APPROVAL",
    },
  });

  // 4. A job at the same site that the tech has nothing to do with.
  const othersJob = await db.job.create({
    data: {
      ...base,
      intWoId: `2026-05-0000-${stamp + 2}`,
      intWoSequence: stamp + 2,
      title: "Somebody else's job",
      createdById: boss.user.id,
      scheduledStart: new Date("2026-05-20T16:00:00Z"),
    },
  });
  await db.jobAssignment.create({
    data: { jobId: othersJob.id, userId: boss.user.id, payType: "HOURLY" },
  });

  // 5. A draft payroll week for the tech, which is their supervisor's to pay.
  const week = weekRange(new Date("2026-05-13T12:00:00Z"), TZ);
  await db.payrollPeriod.create({
    data: {
      userId: tech.user.id,
      supervisorId: sup.user.id,
      weekStart: week.start,
      weekEnd: week.end,
      status: "DRAFT",
      expectedAmount: "337.50",
    },
  });

  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
  });

  async function pageFor(token: string) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    await context.addCookies([
      { name: "authjs.session-token", value: token, url: BASE },
    ]);
    return context.newPage();
  }

  // --- the inbox is empty for a tech ---------------------------------------
  const techPage = await pageFor(tech.token);
  await techPage.goto(`${BASE}/approvals`, { waitUntil: "domcontentloaded" });

  check(
    "a tech is told nothing is waiting on them",
    await techPage.locator("text=Nothing is waiting on you.").isVisible(),
    true,
  );
  check(
    "a tech is not shown a payroll week to approve",
    await techPage.locator("text=$337.50").count(),
    0,
  );
  check(
    "a tech is not shown other people's change requests",
    await techPage.locator("text=Swap registers 3 and 4").count(),
    0,
  );
  // It is in everyone's navigation now: an approver finds their queue there, a
  // tech finds out they were put on a job.
  check(
    "a tech can still reach the page",
    await techPage.getByRole("link", { name: "Approvals" }).count() > 0,
    true,
  );

  // --- and full for their supervisor ---------------------------------------
  const supPage = await pageFor(sup.token);
  await supPage.goto(`${BASE}/approvals`, { waitUntil: "domcontentloaded" });

  check(
    "the supervisor sees the change request",
    await supPage.locator("text=Swap registers 3 and 4").isVisible(),
    true,
  );
  check(
    "the supervisor sees the ad-hoc job",
    await supPage.locator("text=Ad-hoc call out").isVisible(),
    true,
  );
  check(
    "the supervisor sees the report waiting on review",
    await supPage.locator("text=Reports to review").isVisible(),
    true,
  );
  check(
    "the supervisor sees their report's payroll week",
    await supPage.locator("text=Payroll weeks").isVisible(),
    true,
  );
  check(
    "the count adds up",
    await supPage.locator("text=4 items waiting on you.").isVisible(),
    true,
  );

  // The link has to resolve to the same week it was built for: a date parsed
  // as UTC midnight is the afternoon before in Los Angeles, and the week
  // silently comes out one early.
  await supPage
    .getByRole("link", { name: new RegExp(tech.user.name ?? "Tech") })
    .last()
    .click();
  await supPage.waitForURL(/\/pay\?/, { timeout: 20_000 });
  check(
    "the payroll link opens the week it was filed under",
    new URL(supPage.url()).searchParams.get("week"),
    "2026-05-11",
  );
  check(
    "and lands on the right person",
    new URL(supPage.url()).searchParams.get("user"),
    tech.user.id,
  );

  // --- site history ---------------------------------------------------------
  await supPage.goto(`${BASE}/sites/${site.id}`, {
    waitUntil: "domcontentloaded",
  });

  check(
    "the site is titled the way it is everywhere else",
    await supPage.locator(`text=${customer.code} #90210`).first().isVisible(),
    true,
  );
  // A supervisor's reach is their reports and their projects, so a manager's
  // own job at the same site is not theirs to read.
  check(
    "a supervisor does not see a job outside their reach",
    await supPage.locator("text=Somebody else's job").count(),
    0,
  );
  check(
    "the revisit is counted",
    await supPage.locator("text=1 revisit").first().isVisible(),
    true,
  );
  check(
    "who was there is on the record",
    await supPage.locator(`text=${tech.user.name}`).first().isVisible(),
    true,
  );
  check(
    "and when they were there",
    await supPage.locator("text=9:05 AM").first().isVisible(),
    true,
  );

  const techSitePage = await pageFor(tech.token);
  await techSitePage.goto(`${BASE}/sites/${site.id}`, {
    waitUntil: "domcontentloaded",
  });
  check(
    "a tech sees their own visit to the site",
    await techSitePage.locator("text=Site history job").first().isVisible(),
    true,
  );
  check(
    "but not a job they were never on",
    await techSitePage.locator("text=Somebody else's job").count(),
    0,
  );

  // The job page links to the history, which is how anyone finds it.
  await techSitePage.goto(`${BASE}/jobs/${visited.id}`, {
    waitUntil: "domcontentloaded",
  });
  check(
    "the job page links to the site's history",
    await techSitePage
      .locator(`a[href="/sites/${site.id}"]`)
      .first()
      .isVisible(),
    true,
  );

  // --- crew ----------------------------------------------------------------
  // A revisit is created with nobody on it, so this is the only way it ever
  // gets a crew.
  const revisit = await db.job.findFirstOrThrow({
    where: { siteId: site.id, revisitNumber: 1 },
  });

  check(
    "a tech cannot change the crew",
    await techSitePage.getByRole("button", { name: "Add a tech" }).count(),
    0,
  );

  await supPage.goto(`${BASE}/jobs/${revisit.id}`, {
    waitUntil: "domcontentloaded",
  });
  check(
    "a revisit starts with nobody on it",
    await supPage.locator("text=Nobody assigned yet.").isVisible(),
    true,
  );

  await supPage.getByRole("button", { name: "Add a tech" }).click();
  await supPage.locator("#crew-add").selectOption(tech.user.id);
  await supPage.getByRole("button", { name: "Add to crew" }).click();
  await supPage.waitForSelector("text=Lead", { timeout: 20_000 });

  const added = await db.jobAssignment.findUniqueOrThrow({
    where: { jobId_userId: { jobId: revisit.id, userId: tech.user.id } },
  });
  check("the tech is on the revisit", added.userId, tech.user.id);
  check("the first person on is the lead", added.isLead, true);
  check(
    "their approver is their direct supervisor",
    added.supervisorId,
    sup.user.id,
  );
  check(
    "the assignment is on the timeline",
    await db.auditEvent.count({
      where: { jobId: revisit.id, action: "tech_assigned" },
    }),
    1,
  );

  // --- notifications --------------------------------------------------------
  // Being put on a job is not an approval, but it is not something to discover
  // by noticing your schedule changed either.
  const assignedNote = await db.notification.findFirstOrThrow({
    where: { userId: tech.user.id, kind: "job_assigned", jobId: revisit.id },
  });
  check("the tech was told they are on it", assignedNote.actorId, sup.user.id);
  check("and it is waiting to be acknowledged", assignedNote.acknowledgedAt, null);

  await techSitePage.goto(`${BASE}/approvals`, { waitUntil: "domcontentloaded" });
  check(
    "it shows up for them, separately from any decisions",
    await techSitePage.getByText("For your information").isVisible(),
    true,
  );

  await techSitePage
    .getByRole("button", { name: /^Mark read:/ })
    .first()
    .click();
  await techSitePage.waitForTimeout(2500);

  check(
    "acknowledging records that they saw it",
    (await db.notification.findUniqueOrThrow({ where: { id: assignedNote.id } }))
      .acknowledgedAt !== null,
    true,
  );

  // Taking somebody off carries the reason into both the record and the message.
  await supPage.goto(`${BASE}/jobs/${revisit.id}`, {
    waitUntil: "domcontentloaded",
  });
  await supPage
    .getByRole("button", { name: `Take ${tech.user.name} off this job` })
    .click();
  await supPage.locator("#crew-remove-reason").fill("Sent to a closer job");
  await supPage.getByRole("button", { name: "Take them off" }).click();
  await supPage.waitForSelector("text=Nobody assigned yet.", { timeout: 20_000 });

  const removalNote = await db.notification.findFirstOrThrow({
    where: { userId: tech.user.id, kind: "job_unassigned", jobId: revisit.id },
  });
  check(
    "the reason reaches the person it is about",
    removalNote.body,
    "Sent to a closer job",
  );
  const removalAudit = await db.auditEvent.findFirstOrThrow({
    where: { jobId: revisit.id, action: "tech_unassigned" },
  });
  check(
    "and the timeline",
    (removalAudit.detail as { reason?: string } | null)?.reason,
    "Sent to a closer job",
  );
  check(
    "unassigning removes them",
    await db.jobAssignment.count({ where: { jobId: revisit.id } }),
    0,
  );

  // But not once their hours are on the record.
  await supPage.goto(`${BASE}/jobs/${visited.id}`, {
    waitUntil: "domcontentloaded",
  });
  check(
    "somebody who has clocked in is not offered for removal",
    await supPage
      .getByRole("button", { name: `Take ${tech.user.name} off this job` })
      .count(),
    0,
  );

  await browser.close();
  await db.job.deleteMany({ where: { siteId: site.id } });
  await db.payrollPeriod.deleteMany({ where: { userId: tech.user.id } });
  await db.$disconnect();

  console.log(
    `\n${failures === 0 ? "ALL APPROVALS CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
