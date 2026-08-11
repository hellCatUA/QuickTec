import "dotenv/config";
import { encode } from "next-auth/jwt";
import { chromium } from "playwright";
import { db } from "@/lib/db";
import { resolvePayRate } from "@/lib/pay-rates";
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
  // A search, not a wheel: forty names do not fit in a native select.
  await supPage.locator("#crew-add").click();
  await supPage.locator("#crew-add").fill(tech.user.name);
  await supPage.getByRole("option", { name: tech.user.name }).click();
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
    .getByRole("button", { name: `Mark read: ${assignedNote.title}` })
    .click();

  // Poll rather than sleep: a cold server takes longer than any fixed wait,
  // and a fixed wait that is long enough for that is dead time on every run.
  let acknowledged = false;
  for (let attempt = 0; attempt < 20 && !acknowledged; attempt++) {
    await techSitePage.waitForTimeout(500);
    acknowledged =
      (
        await db.notification.findUniqueOrThrow({
          where: { id: assignedNote.id },
        })
      ).acknowledgedAt !== null;
  }
  check("acknowledging records that they saw it", acknowledged, true);

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

  // --- your own requests, and what became of them ---------------------------
  // A tech cannot approve their own suggestion but is the person most likely
  // to be wondering where it got to, so it is theirs by authorship.
  await techSitePage.goto(`${BASE}/approvals?tab=outgoing`, {
    waitUntil: "domcontentloaded",
  });

  check(
    "a tech can see what they have asked for",
    await techSitePage.getByText("Swap registers 3 and 4").isVisible(),
    true,
  );
  check(
    "and it reads as pending until somebody answers it",
    await techSitePage.getByText("Pending").first().isVisible(),
    true,
  );
  check(
    "with no answer time yet",
    await techSitePage.getByText("Not answered yet").first().isVisible(),
    true,
  );

  // Answer it, and both timestamps become the record.
  const answered = await db.changeRequest.findFirstOrThrow({
    where: { jobId: visited.id, status: "PENDING" },
  });
  await db.changeRequest.update({
    where: { id: answered.id },
    data: {
      status: "APPROVED",
      reviewedById: sup.user.id,
      reviewedAt: new Date(),
    },
  });

  await techSitePage.reload({ waitUntil: "domcontentloaded" });
  check(
    "once answered it says so",
    await techSitePage.getByText("Approved", { exact: true }).first().isVisible(),
    true,
  );
  check(
    "naming who did it",
    await techSitePage.getByText(`by ${sup.user.name}`).first().isVisible(),
    true,
  );

  // The archive is the approver's view of the same event.
  await supPage.goto(`${BASE}/approvals?tab=archive`, {
    waitUntil: "domcontentloaded",
  });
  check(
    "the approver finds it in the archive",
    await supPage.getByText("Swap registers 3 and 4").isVisible(),
    true,
  );
  check(
    "with when it was raised",
    (await supPage.getByText(/^Raised /).count()) > 0,
    true,
  );
  check(
    "and when it was answered",
    (await supPage.getByText(/^Approved .* by /).count()) > 0,
    true,
  );
  check(
    "and it is no longer waiting on them",
    await supPage
      .getByRole("link", { name: /^Waiting on you/ })
      .isVisible(),
    true,
  );

  // --- project manager handover ---------------------------------------------
  // Being handed a project is exactly the kind of thing to find out about now
  // rather than by noticing the project moved.
  const project = await db.project.upsert({
    where: { id: "verify-pm-project" },
    update: { managerId: null, pmContactId: null, name: "PM handover project" },
    create: {
      id: "verify-pm-project",
      name: "PM handover project",
      clientId: client.id,
      managerId: null,
    },
  });
  await db.notification.deleteMany({ where: { projectId: project.id } });
  await db.auditEvent.deleteMany({ where: { projectId: project.id } });

  const bossPage = await pageFor(boss.token);
  await bossPage.goto(`${BASE}/projects/${project.id}/settings`, {
    waitUntil: "domcontentloaded",
  });
  await bossPage
    .locator(`select[name="managerId"]`)
    .selectOption(sup.user.id);
  await bossPage.getByRole("button", { name: "Save project" }).click();
  await bossPage.waitForTimeout(2500);

  check(
    "the project manager was recorded",
    (await db.project.findUniqueOrThrow({ where: { id: project.id } })).managerId,
    sup.user.id,
  );

  const pmNote = await db.notification.findFirst({
    where: { userId: sup.user.id, projectId: project.id },
  });
  check(
    "and they were told they own it",
    pmNote?.title,
    "You are the project manager on PM handover project",
  );
  check("by the person who did it", pmNote?.actorId, boss.user.id);
  check("waiting to be acknowledged", pmNote?.acknowledgedAt ?? null, null);

  check(
    "the handover is on the project's timeline",
    (
      await db.auditEvent.findFirst({
        where: { projectId: project.id, action: "project_pm_assigned" },
      })
    ) !== null,
    true,
  );

  // Handing it to somebody else tells both of them.
  await bossPage.reload({ waitUntil: "domcontentloaded" });
  await bossPage
    .locator(`select[name="managerId"]`)
    .selectOption(boss.user.id);
  await bossPage.getByRole("button", { name: "Save project" }).click();
  await bossPage.waitForTimeout(2500);

  const handedOver = await db.notification.findFirst({
    where: {
      userId: sup.user.id,
      projectId: project.id,
      title: { contains: "no longer" },
    },
  });
  check(
    "the previous manager is told they no longer own it",
    handedOver?.title,
    "You are no longer the project manager on PM handover project",
  );
  check(
    "a replacement reads as a change rather than a fresh assignment",
    (
      await db.auditEvent.findFirst({
        where: { projectId: project.id, action: "project_pm_changed" },
      })
    ) !== null,
    true,
  );

  // Re-saving without touching the manager must not nag anybody again.
  const before = await db.notification.count({ where: { projectId: project.id } });
  await bossPage.reload({ waitUntil: "domcontentloaded" });
  await bossPage.getByRole("button", { name: "Save project" }).click();
  await bossPage.waitForTimeout(2500);
  check(
    "saving without changing the manager notifies nobody",
    await db.notification.count({ where: { projectId: project.id } }),
    before,
  );

  // --- the representing company's PM/PC -------------------------------------
  // The person a tech rings when the door is locked. Ours is the project
  // manager above; this one works for the other company and has no account.
  await bossPage.goto(`${BASE}/projects/${project.id}/settings`, {
    waitUntil: "load",
  });
  await bossPage.waitForTimeout(1000);

  await bossPage.locator("#pmContactId").click();
  await bossPage.locator("#pmContactId").fill("Dana Whitfield");
  await bossPage.getByText("Add Dana Whitfield").click();
  await bossPage.locator("#pm-title").fill("Project coordinator");
  await bossPage.locator("#pm-phone").fill("206-555-0114");
  await bossPage.getByRole("button", { name: "Save contact" }).click();
  await bossPage.waitForTimeout(1500);

  check(
    "their contact details come with them once picked",
    // Dashes are for reading; a tel: link dials digits.
    await bossPage.locator('a[href="tel:2065550114"]').isVisible(),
    true,
  );

  await bossPage.getByRole("button", { name: "Save project" }).click();
  await bossPage.waitForTimeout(2500);

  const withPm = await db.project.findUniqueOrThrow({
    where: { id: project.id },
    select: { pmContactId: true, pmContact: { select: { name: true, phone: true } } },
  });
  check("the rep company PM/PC is recorded", withPm.pmContact?.name, "Dana Whitfield");
  check("with their number", withPm.pmContact?.phone, "206-555-0114");

  check(
    "the handover is kept, not just the current value",
    await db.projectPmChange.count({
      where: { projectId: project.id, contactId: withPm.pmContactId },
    }),
    1,
  );
  check(
    "and it reads as a first assignment on the timeline",
    (
      await db.auditEvent.findFirst({
        where: { projectId: project.id, action: "project_pm_contact_assigned" },
      })
    ) !== null,
    true,
  );

  // A job raised now carries them; a handover later must not rewrite it.
  const underPm = await db.job.create({
    data: {
      ...base,
      projectId: project.id,
      intWoId: `2026-07-0000-${stamp + 3}`,
      intWoSequence: stamp + 3,
      title: "Job under the coordinator",
      createdById: boss.user.id,
      pmContactId: withPm.pmContactId,
    },
  });

  await db.job.create({
    data: {
      ...base,
      projectId: project.id,
      intWoId: `2026-04-0000-${stamp + 4}`,
      intWoSequence: stamp + 4,
      title: "Finished last month",
      createdById: boss.user.id,
      lifecycle: "APPROVED",
      outcome: "COMPLETED",
    },
  });

  const replacement = await db.externalContact.create({
    data: { name: "Sam Oduya", clientId: client.id },
  });
  await db.project.update({
    where: { id: project.id },
    data: { pmContactId: replacement.id },
  });

  check(
    "a job already raised stays with whoever ran it",
    (
      await db.job.findUniqueOrThrow({
        where: { id: underPm.id },
        select: { pmContact: { select: { name: true } } },
      })
    ).pmContact?.name,
    "Dana Whitfield",
  );

  // --- the project page is a page about the project -------------------------
  // Its settings used to sit on top of the work, so the list of jobs — the
  // reason anybody opens it — was below four forms.
  await bossPage.goto(`${BASE}/projects/${project.id}`, { waitUntil: "load" });
  await bossPage.waitForTimeout(1000);

  check(
    "the overview does not carry the settings forms",
    await bossPage.locator('select[name="managerId"]').count(),
    0,
  );
  check(
    "they are behind a settings button",
    await bossPage.getByRole("link", { name: "Settings" }).isVisible(),
    true,
  );
  check(
    "the rep company PM/PC is on the overview",
    await bossPage
      .getByRole("heading", { name: "Rep Company PM/PC" })
      .isVisible(),
    true,
  );
  check(
    "the jobs are searchable",
    await bossPage
      .getByPlaceholder("Search by WO, title, site, city or who is on it…")
      .isVisible(),
    true,
  );
  check(
    "the list can be narrowed to what is still coming",
    await bossPage.getByRole("button", { name: /^Scheduled/ }).isVisible(),
    true,
  );
  await bossPage.getByRole("button", { name: /^Completed/ }).click();
  await bossPage.waitForTimeout(300);
  check(
    "and to what is behind us",
    await bossPage.getByText("Finished last month").isVisible(),
    true,
  );
  check(
    "which leaves the unfinished one out",
    await bossPage.getByText("Job under the coordinator").count(),
    0,
  );
  await bossPage.getByRole("button", { name: /^All/ }).click();
  await bossPage.waitForTimeout(300);

  await bossPage
    .getByPlaceholder("Search by WO, title, site, city or who is on it…")
    .fill("under the coordinator");
  await bossPage.waitForTimeout(300);
  check(
    "and searching narrows the list",
    await bossPage.getByText("Job under the coordinator").isVisible(),
    true,
  );

  // --- job settings, kept apart from the project's own details --------------
  await bossPage.goto(`${BASE}/projects/${project.id}/settings`, {
    waitUntil: "load",
  });
  await bossPage.waitForTimeout(1000);

  check(
    "there is a block for how its jobs are filled in",
    await bossPage
      .getByRole("heading", { name: "In Project Jobs Settings" })
      .isVisible(),
    true,
  );
  check(
    "deliverables read as requirements there",
    await bossPage.getByText("Deliverables Requirements").isVisible(),
    true,
  );
  check(
    "breaks are called Paid Breaks",
    await bossPage.getByText("Paid Breaks").isVisible(),
    true,
  );

  await bossPage.locator("#defaultJobTitle").fill("Register swap");
  await bossPage.locator("#defaultPayType").selectOption("HOURLY");
  await bossPage.locator("#defaultPayRate").fill("52.50");
  await bossPage.getByRole("button", { name: "Save job settings" }).click();
  await bossPage.waitForTimeout(2500);

  const prefill = await db.project.findUniqueOrThrow({
    where: { id: project.id },
    select: {
      defaultJobTitle: true,
      defaultPayType: true,
      defaultPayRate: true,
      pmContactId: true,
    },
  });
  check("the job title prefill is stored", prefill.defaultJobTitle, "Register swap");
  check("with the pay type", prefill.defaultPayType, "HOURLY");
  check("and the rate", prefill.defaultPayRate?.toString(), "52.5");
  // Two forms, two actions: saving one must not blank a field owned by the
  // other, which is exactly what one shared action would have done.
  check(
    "saving job settings leaves the PM/PC alone",
    prefill.pmContactId,
    replacement.id,
  );

  const rate = await resolvePayRate(tech.user.id, project.id, client.id);
  check(
    "and somebody with no rate of their own is paid the project's",
    `${rate.payType} ${rate.rate}`,
    "HOURLY 52.5",
  );

  await db.job.deleteMany({ where: { projectId: project.id } });
  await db.externalContact.deleteMany({
    where: { id: { in: [withPm.pmContactId!, replacement.id] } },
  });

  await browser.close();
  await db.job.deleteMany({ where: { siteId: site.id } });
  await db.payrollPeriod.deleteMany({ where: { userId: tech.user.id } });
  await db.notification.deleteMany({ where: { projectId: "verify-pm-project" } });
  await db.project.deleteMany({ where: { id: "verify-pm-project" } });
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
