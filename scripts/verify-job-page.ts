import "dotenv/config";
import { chromium } from "playwright";
import { encode } from "next-auth/jwt";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { db } from "@/lib/db";
import { loadJobForExport } from "@/lib/exports/job-data";
import { buildTextReport } from "@/lib/exports/text-report";
import { absolutePath } from "@/lib/storage";

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

/** A saved job, as opposed to /jobs/new — cuids all start with a c and are long. */
const JOB_URL = /\/jobs\/c[a-z0-9]{10,}$/;

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

  // The fixture job by name, not "whichever assignment comes back first": the
  // destructive domain suite leaves jobs behind with this tech on them, and an
  // unordered findFirst picks a different one from run to run — which then
  // fails on the first step, about state this suite never created.
  const assignment = await db.jobAssignment.findFirstOrThrow({
    where: { userId: tech.id, job: { title: "Elevator phone line" } },
    select: { id: true, jobId: true },
  });

  // Start from a clean slate so repeated runs are comparable. Contacts and
  // signatures matter as much as visits here: a MOD left over from a previous
  // run changes which branch of the wizard renders.
  await db.jobAssignment.deleteMany({
    where: { jobId: assignment.jobId, id: { not: assignment.id } },
  });
  await db.jobAssignment.update({
    where: { id: assignment.id },
    data: { payOverridden: false },
  });
  await db.job.update({
    where: { id: assignment.jobId },
    data: { payType: null, payRate: null, travelReimbursement: null },
  });
  await db.visit.deleteMany({ where: { assignmentId: assignment.id } });
  await db.signature.deleteMany({ where: { jobId: assignment.jobId } });
  await db.pointOfContact.deleteMany({ where: { jobId: assignment.jobId } });
  await db.deliverableItem.deleteMany({ where: { jobId: assignment.jobId } });
  await db.reimbursement.deleteMany({ where: { jobId: assignment.jobId } });
  await db.attachment.deleteMany({ where: { jobDocumentId: assignment.jobId } });
  await db.auditEvent.deleteMany({ where: { jobId: assignment.jobId } });
  // The sections block later on switches Old Serials on and makes it required.
  // Job rules outrank the project's, so leaving them behind means the next run
  // starts with a requirement nothing satisfies and checkout refuses — a
  // failure about the run before it, not about the code.
  await db.deliverableRequirement.deleteMany({
    where: { jobId: assignment.jobId },
  });
  await db.job.update({
    where: { id: assignment.jobId },
    data: {
      lifecycle: "SCHEDULED",
      breakPaid: false,
      outcome: null,
      releaseCode: null,
      noReleaseCode: false,
    },
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

  // Clocking in asks when, rather than assuming now and hiding "actually I
  // started at half past" behind a second, quieter button.
  await page.getByRole("button", { name: "Clock in", exact: true }).click();
  await page.locator("button:has-text('now')").first().click();
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

  // Snapping rounds up, so a fresh clock-in can be a couple of minutes in the
  // future and the card says so rather than showing a frozen zero. Back the
  // visit up so the running counter can be observed without waiting for it.
  await db.visit.update({
    where: { id: (await db.visit.findFirstOrThrow({ where: { assignmentId: assignment.id } })).id },
    data: { clockInAt: new Date(Date.now() - 90 * 60_000) },
  });
  await page.reload({ waitUntil: "domcontentloaded" });

  const counter = page.locator("text=/^\\d+:\\d{2}:\\d{2}$/").first();
  await counter.waitFor({ timeout: 10_000 });
  const first = await counter.innerText();
  await page.waitForTimeout(2500);
  const second = await counter.innerText();
  check(`elapsed counter ticks (${first} -> ${second})`, first !== second, true);

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

  // --- checkout is refused while required deliverables are missing --------
  await page.getByRole("button", { name: "Clock out", exact: true }).click();
  await page.waitForSelector("text=Step 1 of 6", { timeout: 15_000 });

  const reviewText = await page.locator("text=Still missing").isVisible();
  check("review step flags missing deliverables", reviewText, true);
  check(
    "the missing list names Pre-Install",
    await page.locator("li", { hasText: "Pre-Install" }).first().isVisible(),
    true,
  );

  await page.getByRole("button", { name: "Cancel" }).click();
  await page
    .getByRole("button", { name: "Clock out", exact: true })
    .waitFor({ timeout: 15_000 });

  // --- deliverables -------------------------------------------------------
  const sharpLib = (await import("sharp")).default;
  const photo = await sharpLib({
    create: { width: 1600, height: 1200, channels: 3, background: "#2a4d69" },
  })
    .jpeg()
    .toBuffer();

  async function upload(section: string) {
    await page.getByRole("button", { name: `Add to ${section}` }).click();

    // Not just the first file input on the page any more: the company's
    // paperwork block sits above the deliverables.
    await page
      .locator('input[type="file"]:not([id^="doc-"])')
      .first()
      .setInputFiles({
        name: "IMG_0001.jpg",
        mimeType: "image/jpeg",
        buffer: photo,
      });

    await page.getByRole("button", { name: "Save", exact: true }).first().click();
    await page.waitForSelector(`text=${section}`, { timeout: 60_000 });
    await page.waitForTimeout(2000);
  }

  await upload("Pre-Install");
  await upload("Post Install");

  const item = await db.deliverableItem.findFirst({
    where: { jobId: assignment.jobId, category: "PRE_INSTALL" },
    include: { attachments: true, assignment: true },
  });
  check("deliverable stored", Boolean(item), true);
  check("photo attached", item?.attachments.length, 1);
  check("photo converted to JPEG", item?.attachments[0].mimeType, "image/jpeg");
  check("photo stamped", item?.attachments[0].watermarked, true);
  check(
    "photo attributed to the tech who uploaded it",
    item?.assignment?.userId,
    tech.id,
  );

  // The file has to come back through the authenticated route, not the volume.
  const fileResponse = await page.request.get(
    `${BASE}/api/files/${item!.attachments[0].id}`,
  );
  check("file serves to a permitted user", fileResponse.status(), 200);
  check(
    "thumbnails are re-encoded as JPEG",
    (
      await page.request.get(`${BASE}/api/files/${item!.attachments[0].id}?w=200`)
    ).headers()["content-type"],
    "image/jpeg",
  );

  const anonymous = await browser.newContext();
  const anonResponse = await anonymous.request
    .get(`${BASE}/api/files/${item!.attachments[0].id}`)
    .catch(() => null);
  check("file is refused without a session", anonResponse?.status(), 401);
  await anonymous.close();

  // --- guided checkout ----------------------------------------------------
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Clock out", exact: true }).click();
  await page.waitForSelector("text=Step 1 of 6", { timeout: 15_000 });
  check(
    "review step is clear once deliverables are in",
    await page.locator("text=Everything required is in place.").isVisible(),
    true,
  );

  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Completed" }).click();

  // Separate from the outcome on purpose: a job can be Completed and still
  // need somebody back for the part that did not turn up. The tech is the only
  // person who knows, and by the time a planner looks it is a memory.
  await page.getByRole("checkbox", { name: /Revisit required/ }).check();
  await page.getByRole("button", { name: "Continue" }).click();

  // Scoped by id: the page also carries a "Release code" field of its own.
  await page.locator("#release-code").fill("RLS-4417");
  await page.getByRole("button", { name: "Continue" }).click();

  const modNameField = page.locator("#mod-name");
  if (await modNameField.count()) {
    await modNameField.fill("Dana Reyes");
  } else {
    await page.locator("#mod-picker").selectOption({ index: 0 });
  }
  await drawSignature(page);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForSelector("text=Signing as", { timeout: 30_000 });

  await drawSignature(page);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForSelector("text=Clock out now", { timeout: 30_000 });

  check(
    "the picker offers a 'now' option",
    (await page.locator("button:has-text('now')").count()) >= 1,
    true,
  );

  await page.getByRole("button", { name: "Clock out now" }).click();
  await page
    .getByRole("button", { name: "Clock in", exact: true })
    .waitFor({ timeout: 30_000 });

  // One job, one tech, one arrival. Clocking in used to be refused only while
  // a visit was open, so this opened a second one — never because there were
  // two trips, always a mis-tap or somebody trying to fix a wrong clock-out.
  await page.getByRole("button", { name: "Clock in", exact: true }).click();
  await page.locator("button:has-text('now')").first().click();
  await page.waitForTimeout(2500);
  check(
    "clocking in a second time is refused",
    await db.visit.count({ where: { assignmentId: assignment.id } }),
    1,
  );
  check(
    "and says where to go instead",
    await page.getByText(/already worked this job/i).isVisible(),
    true,
  );

  const closed = await db.visit.findFirstOrThrow({
    where: { assignmentId: assignment.id },
    orderBy: { clockInAt: "asc" },
  });
  check("clock-out stored", closed.clockOutAt !== null, true);
  check(
    "clock-out snapped to 5 minutes",
    closed.clockOutAt!.getUTCMinutes() % 5,
    0,
  );

  const finished = await db.job.findUniqueOrThrow({
    where: { id: assignment.jobId },
  });
  check("outcome stored", finished.outcome, "COMPLETED");
  check("release code stored", finished.releaseCode, "RLS-4417");
  check("job is pending review", finished.lifecycle, "PENDING_REVIEW");

  const signatures = await db.signature.findMany({
    where: { jobId: assignment.jobId },
    include: { attachment: true },
  });
  check("two signatures captured", signatures.length, 2);
  check(
    "MOD signature has an image",
    signatures.find((s) => s.kind === "MOD")?.attachment !== null,
    true,
  );
  check(
    "signature file is named for the export",
    signatures.find((s) => s.kind === "MOD")?.attachment?.originalName,
    "MOD-Dana Reyes-Signature.png",
  );
  check(
    "tech signature captured",
    signatures.find((s) => s.kind === "TECH")?.attachment !== null,
    true,
  );

  const mod = await db.pointOfContact.findFirst({
    where: { jobId: assignment.jobId, type: "MOD" },
  });
  check("MOD recorded as a point of contact", mod?.name, "Dana Reyes");

  const events = await db.auditEvent.findMany({
    where: { jobId: assignment.jobId },
    select: { action: true },
  });
  const actions = new Set(events.map((event) => event.action));
  for (const action of [
    "clock_in",
    "break_start",
    "break_end",
    "clock_out",
    "deliverable_added",
    "signature_captured",
    "checkout_completed",
  ]) {
    check(`timeline records ${action}`, actions.has(action), true);
  }

  // --- revisit required -----------------------------------------------------
  // Raised at checkout by the tech who found out, acted on days later by
  // somebody else. It is internal: the client is told the job was Completed,
  // because it was, and never that we are coming back.
  check(
    "the revisit flag is on the job",
    (
      await db.job.findUniqueOrThrow({
        where: { id: assignment.jobId },
        select: { internalStatus: true },
      })
    ).internalStatus,
    "REVISIT_REQUIRED",
  );
  check("and it is on the timeline", actions.has("revisit_required"), true);

  await page.goto(`${BASE}/jobs?filter=revisit`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(800);
  check(
    "the planner can filter for it rather than scanning badges",
    await page.getByText("Revisit required").first().isVisible(),
    true,
  );

  await page.goto(url, { waitUntil: "domcontentloaded" });

  // --- exports ------------------------------------------------------------
  await page.reload({ waitUntil: "domcontentloaded" });

  check(
    "the report is on the page ready to copy",
    await page.locator("#text-report").isVisible(),
    true,
  );

  const reportText = await page.locator("#text-report").inputValue();
  check(
    "the on-page report carries the release code just captured",
    reportText.includes("Release code: RLS-4417"),
    true,
  );
  check(
    "the on-page report names the MOD who signed",
    reportText.includes("MOD name: Dana Reyes"),
    true,
  );
  check(
    "and says nothing about a revisit, which is ours to know",
    /revisit/i.test(reportText),
    false,
  );

  const textDownload = await page.request.get(
    `${BASE}/api/jobs/${assignment.jobId}/export/text`,
  );
  check("text export downloads", textDownload.status(), 200);
  check(
    "text export is offered as a file",
    textDownload.headers()["content-disposition"]?.includes("-Report.txt"),
    true,
  );

  const zipDownload = await page.request.get(
    `${BASE}/api/jobs/${assignment.jobId}/export/zip`,
  );
  check("zip export downloads", zipDownload.status(), 200);
  const zipBody = await zipDownload.body();
  check("zip export is a real archive", zipBody.subarray(0, 2).toString(), "PK");
  check("zip export is not empty", zipBody.byteLength > 1000, true);

  // The internal work order is a supervisor-and-above document; a tech asking
  // for it should be told the route does not exist, not that it is forbidden.
  const pdfAsTech = await page.request.get(
    `${BASE}/api/jobs/${assignment.jobId}/export/pdf`,
  );
  check("a tech cannot pull the internal work order", pdfAsTech.status(), 404);

  const boss = await db.user.findUniqueOrThrow({
    where: { email: "boss@417group.org" },
  });
  const bossToken = await encode({
    token: { sub: boss.nextcloudSub!, userId: boss.id },
    secret: process.env.AUTH_SECRET!,
    salt: "authjs.session-token",
    maxAge: 3600,
  });
  const bossContext = await browser.newContext();
  await bossContext.addCookies([
    { name: "authjs.session-token", value: bossToken, url: BASE },
  ]);

  const pdfAsManager = await bossContext.request.get(
    `${BASE}/api/jobs/${assignment.jobId}/export/pdf`,
  );
  check("a manager can pull the internal work order", pdfAsManager.status(), 200);
  const pdfBody = await pdfAsManager.body();
  check("work order is a PDF", pdfBody.subarray(0, 5).toString(), "%PDF-");
  await bossContext.close();

  // --- the shell ------------------------------------------------------------
  // A name of its own, because the header collapses "QuickTec | QuickTec" to
  // one on a fresh install. Restored at the end so the suite leaves no trace.
  const settings = await db.companySettings.findUniqueOrThrow({
    where: { id: "singleton" },
    select: { name: true },
  });
  await db.companySettings.update({
    where: { id: "singleton" },
    data: { name: "417 Group" },
  });
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });

  check(
    "the header names the company and the app",
    await page.locator("header").getByText("417 Group | QuickTec").isVisible(),
    true,
  );
  check(
    "the theme control is not taking up header space",
    await page.locator("header").getByRole("radiogroup", { name: "Theme" }).count(),
    0,
  );

  // It moved to the account page, which is also where signing out lives.
  await page.goto(`${BASE}/account`, { waitUntil: "domcontentloaded" });
  check(
    "the theme control is on the account page",
    await page.getByRole("radiogroup", { name: "Theme" }).isVisible(),
    true,
  );
  check(
    "which also shows who you are signed in as",
    await page.getByText("tech@417group.org").isVisible(),
    true,
  );
  check(
    "and offers a sign-out of its own, not only the header icon",
    await page
      .getByRole("main")
      .getByRole("button", { name: "Sign out" })
      .isVisible(),
    true,
  );

  // --- the new-job form -----------------------------------------------------
  // Every picker here was a native select: fine for four options, miserable
  // for forty, and unsearchable at either size.
  await bossPage(browser, bossToken, async (planner) => {
    await planner.goto(`${BASE}/jobs/new`, { waitUntil: "load" });
    await planner.waitForTimeout(1500);

    check(
      "nothing is preselected — a company nobody checked is a company nobody checked",
      await planner.locator('input[name="clientId"]').inputValue(),
      "",
    );

    // The project comes first and answers the two fields under it, which is
    // the whole reason it moved: they used to be filled in one at a time and
    // could disagree with each other at every step.
    await planner.locator("#projectId").click();
    await planner.locator("#projectId-list").getByRole("option").first().click();
    await planner.waitForTimeout(300);
    check(
      "picking the project fills in the representing company",
      (await planner.locator('input[name="clientId"]').inputValue()).length > 0,
      true,
    );

    // Representing company: type, filter, pick. Clearing the project too,
    // since choosing a company by hand is choosing to leave the project.
    await planner.locator("#clientId").click();
    await planner.locator("#clientId").fill("netcom");
    await planner.getByRole("option", { name: /NetCom/ }).click();

    // A job routinely answers to more than one ticket. The first is the
    // primary; the plus adds the ones after it.
    await planner.locator("#ticketNumber").fill("S-1000");
    await planner.getByRole("button", { name: "Another ticket" }).click();
    await planner.locator("#extraTicket-0").fill("S-1001");
    await planner.getByRole("button", { name: "Another ticket" }).click();
    await planner.locator("#extraTicket-1").fill("S-1002");
    check(
      "the second one is labelled Secondary",
      await planner.getByText("Secondary", { exact: true }).isVisible(),
      true,
    );
    // Pressing the plus and changing your mind leaves nothing behind.
    await planner.getByRole("button", { name: "Another ticket" }).click();
    check(
      "the company can be found by typing",
      (await planner.locator('input[name="clientId"]').inputValue()).length > 0,
      true,
    );

    // The customer is its own field now — it used to be reachable only by
    // knowing a site number, which is the thing least likely to be to hand.
    check(
      "a site cannot be picked before the customer",
      await planner.getByText("Pick the customer first").isVisible(),
      true,
    );
    await planner.locator("#customerId").click();
    await planner.locator("#customerId-list").getByRole("option").first().click();
    await planner.waitForTimeout(300);

    const pickedCustomerId = await planner
      .locator('input[name="customerId"]')
      .inputValue();
    check("the customer can be chosen on its own", pickedCustomerId.length > 0, true);

    // And the site list is that customer's sites, not everybody's.
    await planner.locator("#siteId").click();
    const offered = await planner
      .locator("#siteId-list")
      .getByRole("option")
      .allInnerTexts();
    await planner.keyboard.press("Escape");
    const theirs = await db.site.findMany({
      where: { customerId: pickedCustomerId, active: true },
      select: { id: true },
    });
    check(
      "only that customer's sites are offered",
      offered.length <= theirs.length,
      true,
    );

    // Site: search for a number that does not exist yet and add it.
    const newNumber = String(Math.floor(Math.random() * 90000 + 10000));
    await planner.locator("#siteId").click();
    await planner.locator("#siteId").fill(newNumber);
    check(
      "an unknown site number offers to be added",
      await planner.getByText(`Add site #${newNumber}`).isVisible(),
      true,
    );
    await planner.getByText(`Add site #${newNumber}`).click();

    await planner.locator("#qs-address").fill("1 Test Way");
    await planner.locator("#qs-city").fill("Tacoma");
    await planner.locator("#qs-state").fill("WA");
    await planner.getByRole("button", { name: "Add site" }).click();
    await planner.waitForTimeout(2500);

    const created = await db.site.findFirst({ where: { siteNumber: newNumber } });
    check("the site is created from the job form", Boolean(created), true);
    check("with the address that was to hand", created?.city, "Tacoma");
    check(
      "and it is selected, so the form can carry on",
      await planner.locator('input[name="siteId"]').inputValue(),
      created?.id,
    );

    // Estimate in hours, not minutes.
    await planner.getByRole("button", { name: "4h" }).click();
    check(
      "four hours is stored as minutes",
      await planner.locator('input[name="estimateMinutes"]').inputValue(),
      "240",
    );

    // Techs required by thumb.
    await planner.getByRole("button", { name: "3", exact: true }).click();
    check(
      "the crew size preset applies",
      await planner.locator('input[name="techsRequired"]').inputValue(),
      "3",
    );
    await planner.getByRole("button", { name: "One fewer" }).click();
    check(
      "and the arrows adjust it",
      await planner.locator('input[name="techsRequired"]').inputValue(),
      "2",
    );

    // Techs by search rather than a wall of checkboxes.
    await planner.locator("#assignee-search").click();
    await planner.locator("#assignee-search").fill("terry");
    await planner.getByRole("option", { name: /Terry/ }).click();
    check(
      "a tech added by search is on the job",
      await planner.locator('input[name="assigneeIds"]').count(),
      1,
    );

    // Paid Breaks lives in its own block now rather than tacked to the end of
    // Scope of work, where it read as part of the scope.
    check(
      "paid breaks are under Miscellaneous",
      await planner.getByText("Miscellaneous").isVisible(),
      true,
    );
    check(
      "and named Paid Breaks",
      await planner.getByText("Paid Breaks").isVisible(),
      true,
    );

    // Dispatch numbers for this job, which had nowhere to go on the form at
    // all and so in practice were never recorded.
    await planner
      .getByRole("button", { name: "Add a dispatch contact" })
      .click();
    await planner.locator("#dispatch-label-0").fill("Bridge line");
    await planner.locator("#dispatch-phone-0").fill("206-555-0177");
    await planner.locator("#dispatch-note-0").fill("Ask for the duty manager");

    // The company's usual numbers are one press away rather than retyped.
    // Offered, not added on their own: a stale NOC line that appeared unasked
    // is one the tech rings at two in the morning for nothing.
    check(
      "the company's own numbers are offered",
      await planner.getByRole("button", { name: /NOC/ }).isVisible(),
      true,
    );
    await planner.getByRole("button", { name: /NOC/ }).click();
    check(
      "and pressing one fills a row in",
      await planner.locator("#dispatch-label-1").inputValue(),
      "NOC",
    );
    // Pressing it twice does not put it on twice.
    await planner.getByRole("button", { name: /NOC/ }).click();
    check(
      "pressing it again changes nothing",
      await planner.locator('input[name="dispatchLabel"]').count(),
      2,
    );

    // What this job pays, which likewise could only be reached by changing the
    // tech's standing rate and leaking it into every other job they touch.
    await planner.locator("#payType").selectOption("FLAT");
    await planner.locator("#payRate").fill("600");
    await planner.locator("#travelReimbursement").fill("75");

    // The work order usually arrives by email the evening before, so whoever
    // raises the job is holding it. Making them come back to the job page to
    // attach it is how it ends up attached by nobody.
    await planner.locator("#workOrderFiles").setInputFiles({
      name: "NetCom-WO-991100.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\n% raised with the job\n"),
    });
    check(
      "the chosen file is named back",
      await planner.getByText("NetCom-WO-991100.pdf").isVisible(),
      true,
    );

    await planner.locator("#title").fill("Built from the reworked form");
    await planner.getByRole("button", { name: "Create job" }).click();
    // Not /jobs\/[a-z0-9]+$/: that also matches /jobs/new, so a form that never
    // submitted looked like a form that had.
    await planner.waitForURL(JOB_URL, { timeout: 20_000 }).catch(() => undefined);

    const made = await db.job.findFirst({
      where: { title: "Built from the reworked form" },
      include: { assignments: true },
    });
    check("the job is created", Boolean(made), true);
    check("with the estimate in minutes", made?.estimateMinutes, 240);
    check("the crew size", made?.techsRequired, 2);
    check("and the tech on it", made?.assignments.length, 1);

    const paperwork = await db.attachment.findMany({
      where: { jobDocumentId: made!.id },
      select: { originalName: true, jobDocumentKind: true },
    });
    check(
      "the work order came with the job",
      paperwork.find((doc) => doc.jobDocumentKind === "CLIENT_WORK_ORDER")
        ?.originalName,
      "NetCom-WO-991100.pdf",
    );

    check("the primary ticket is the job's own field", made?.ticketNumber, "S-1000");
    const extras = await db.jobTicket.findMany({
      where: { jobId: made!.id },
      orderBy: { order: "asc" },
      select: { number: true },
    });
    check(
      "the ones after it are kept in order",
      extras.map((ticket) => ticket.number).join(","),
      "S-1001,S-1002",
    );
    // The row somebody added and left empty is not a ticket.
    check("and an empty row is not one of them", extras.length, 2);

    const numbers = await db.dispatchContact.findMany({
      where: { jobId: made!.id },
      select: { label: true, phone: true, note: true },
    });
    check("both dispatch numbers are on the job", numbers.length, 2);
    check(
      "the company's usual one came across",
      numbers.find((row) => row.label === "NOC")?.phone,
      "800-555-0100",
    );
    const typed = numbers.find((row) => row.label !== "NOC");
    check("with who to ask for", typed?.note, "Ask for the duty manager");
    check("and the number itself", typed?.phone, "206-555-0177");

    // Set on the job, so it applies to everybody on it rather than following
    // whatever rate each of them happens to carry.
    check("the job's own pay type is used", made?.assignments[0]?.payType, "FLAT");
    check("with its rate", made?.assignments[0]?.payRate.toString(), "600");
    check(
      "and its travel money",
      made?.assignments[0]?.travelReimbursement?.toString(),
      "75",
    );
    check(
      "recorded as a decision about this job",
      made?.assignments[0]?.payRateNote,
      "Set on this job",
    );

    // A job raised with no INC number has no incident behind it, which is a
    // fact rather than a gap. Warning on every one of those is how people
    // learn to scroll past the warnings that mean something.
    await planner.goto(`${BASE}/jobs/${made!.id}`, {
      waitUntil: "domcontentloaded",
    });
    check(
      "an empty INC # reads as Not provided",
      await planner.getByText("Not provided").first().isVisible(),
      true,
    );
    check(
      "and the ticket after the primary is shown with it",
      await planner.getByText("S-1001", { exact: true }).isVisible(),
      true,
    );
    check(
      "labelled for what it is",
      await planner.getByText("Secondary", { exact: true }).isVisible(),
      true,
    );
    // What the customer is quoted: one field, comma separated.
    check(
      "and the report carries all three",
      (await planner.locator("#text-report").inputValue())
        .split("\n")
        .find((line) => line.startsWith("Ticket #:")),
      "Ticket #: S-1000, S-1001, S-1002",
    );

    if (made) await db.job.delete({ where: { id: made.id } });
    if (created) {
      // Anything else this run put on the site goes first. A run that died
      // half way leaves a job here, and the site delete then fails on a
      // foreign key rather than on anything this suite is testing.
      await db.job.deleteMany({ where: { siteId: created.id } });
      await db.site.delete({ where: { id: created.id } });
    }
  });

  // --- creating a job -------------------------------------------------------
  // The Lead radio only exists in the DOM once somebody is assigned, so a job
  // planned with no crew submitted no leadId at all and the whole form was
  // rejected — presenting as a Create button that did nothing.
  await bossPage(browser, bossToken, async (planner) => {
    await planner.goto(`${BASE}/jobs/new`, { waitUntil: "load" });
    await planner.waitForTimeout(1500);

    await planner.locator("#title").fill("Planned with no crew");
    // Nothing is preselected any more, so the company and the customer are
    // both part of filling it in — and the site list only exists once the
    // customer is known.
    await planner.locator("#clientId").click();
    await planner.locator("#clientId-list").getByRole("option").first().click();
    await planner.locator("#customerId").click();
    await planner.locator("#customerId-list").getByRole("option").first().click();
    await planner.waitForTimeout(300);
    await planner.locator("#siteId").click();
    await planner.locator("#siteId-list").getByRole("option").first().click();
    await planner.getByRole("button", { name: "Create job" }).click();

    await planner.waitForURL(JOB_URL, { timeout: 20_000 }).catch(() => undefined);

    check(
      "a job with no crew can be created",
      JOB_URL.test(new URL(planner.url()).pathname),
      true,
    );
  });

  const planned = await db.job.findFirst({
    where: { title: "Planned with no crew" },
    include: { assignments: true },
  });
  check("and it really exists", Boolean(planned), true);
  check("with nobody on it yet", planned?.assignments.length, 0);
  if (planned) await db.job.delete({ where: { id: planned.id } });

  // --- the representing company's paperwork ---------------------------------
  // It used to live in somebody's inbox, which meant the tech at the door
  // could not read the document the job answers to.
  await bossPage(browser, bossToken, async (planner) => {
    await planner.goto(url, { waitUntil: "load" });
    await planner.waitForTimeout(1000);

    check(
      "the WO has somewhere to go",
      await planner.getByText("No WO for this job.").first().isVisible(),
      true,
    );
    check(
      "and so does their sign-off blank",
      await planner.getByText("Sign-off sheet").first().isVisible(),
      true,
    );

    await planner
      .locator("#doc-CLIENT_WORK_ORDER")
      .setInputFiles({
        name: "NetCom-WO-887766.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from(
          "%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
        ),
      });
    await planner.waitForTimeout(2500);

    const stored = await db.attachment.findFirst({
      where: { jobDocumentId: assignment.jobId },
      select: { id: true, originalName: true, watermarked: true },
    });
    check("the work order is filed against the job", Boolean(stored), true);
    check(
      "under the name it arrived with",
      stored?.originalName,
      "NetCom-WO-887766.pdf",
    );
    // Their document, not ours — stamping it would misrepresent it.
    check("and unstamped", stored?.watermarked, false);
    check(
      "and it is offered to open",
      await planner.getByRole("link", { name: "NetCom-WO-887766.pdf" }).isVisible(),
      true,
    );

    // Anyone on the job may open it; the permission check has to resolve the
    // attachment back to the job through its new parent.
    const asTech = await browser.newContext();
    await asTech.addCookies([
      { name: "authjs.session-token", value: token, url: BASE },
    ]);
    const fetched = await asTech.request.get(`${BASE}/api/files/${stored!.id}`);
    check("the tech on the job can open it", fetched.status(), 200);
    await asTech.close();

    await planner
      .getByRole("button", { name: "Remove NetCom-WO-887766.pdf" })
      .click();
    await planner.waitForTimeout(2000);
    check(
      "and a wrong one can be taken back off",
      await db.attachment.count({ where: { jobDocumentId: assignment.jobId } }),
      0,
    );

    // Nothing attached says so, and there is no button asking anybody to
    // declare it — the great majority of jobs simply never get one, and the
    // ones that do get theirs by somebody attaching it.
    check(
      "an empty slot says there is no work order",
      await planner.getByText("No WO for this job.").isVisible(),
      true,
    );
    check(
      "and nobody is asked to declare it",
      await planner
        .getByRole("button", { name: "No WO for this job" })
        .count(),
      0,
    );
  });

  // Raised as "no work order", which is still asked at creation. One turning
  // up afterwards answers it.
  await db.job.update({
    where: { id: assignment.jobId },
    data: { noWorkOrder: true },
  });

  // The PDF often lands in the tech's inbox at eight in the morning, long
  // after whoever planned the job has moved on.
  check(
    "the tech on the job can attach the sign-off blank themselves",
    await (async () => {
      await page.goto(url, { waitUntil: "load" });
      await page.waitForTimeout(1000);
      await page.locator("#doc-SIGN_OFF").setInputFiles({
        name: "SignOff.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from("%PDF-1.4\ntrailer<<>>\n%%EOF\n"),
      });
      await page.waitForTimeout(2500);
      return db.attachment.count({
        where: { jobDocumentId: assignment.jobId, jobDocumentKind: "SIGN_OFF" },
      });
    })(),
    1,
  );

  // Attaching a WO answers the flag rather than leaving the page saying both.
  await page.locator("#doc-CLIENT_WORK_ORDER").setInputFiles({
    name: "LateWO.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\ntrailer<<>>\n%%EOF\n"),
  });
  await page.waitForTimeout(2500);
  check(
    "and a WO that turns up after all clears the no-WO mark",
    (
      await db.job.findUniqueOrThrow({
        where: { id: assignment.jobId },
        select: { noWorkOrder: true },
      })
    ).noWorkOrder,
    false,
  );
  await db.attachment.deleteMany({ where: { jobDocumentId: assignment.jobId } });

  // --- breaks, when the project got it wrong --------------------------------
  await bossPage(browser, bossToken, async (planner) => {
    const before = await db.job.findUniqueOrThrow({
      where: { id: assignment.jobId },
      select: { breakPaid: true },
    });

    await planner.goto(url, { waitUntil: "load" });
    await planner.waitForTimeout(1000);

    await planner
      .getByRole("radio", {
        name: before.breakPaid ? "Unpaid" : "Paid",
        exact: true,
      })
      .click();
    await planner.waitForTimeout(2000);

    const after = await db.job.findUniqueOrThrow({
      where: { id: assignment.jobId },
      select: { breakPaid: true },
    });
    check(
      "the inherited break setting can be overridden on the job",
      after.breakPaid,
      !before.breakPaid,
    );

    // A break logged unpaid and now paid has to reach payroll as paid.
    const breaks = await db.breakPeriod.findMany({
      where: { visit: { assignment: { jobId: assignment.jobId } } },
      select: { paid: true },
    });
    check(
      "and the breaks already logged move with it",
      breaks.length > 0 && breaks.every((entry) => entry.paid === after.breakPaid),
      true,
    );
  });

  // --- a job raised with no site number -------------------------------------
  // Dispatch reads out a customer and a city often enough that demanding the
  // number up front means a made-up one, and a made-up one is worse than none.
  await bossPage(browser, bossToken, async (planner) => {
    await planner.goto(`${BASE}/jobs/new`, { waitUntil: "load" });
    await planner.waitForTimeout(1500);

    await planner.locator("#clientId").click();
    await planner.locator("#clientId-list").getByRole("option").first().click();
    await planner.locator("#customerId").click();
    await planner.locator("#customerId-list").getByRole("option").first().click();
    await planner.waitForTimeout(300);

    await planner.getByRole("button", { name: "No SiteID" }).click();
    await planner.locator("#qs-city").fill("Bellingham");
    await planner.getByRole("button", { name: "Add it without a number" }).click();
    await planner.waitForTimeout(2500);

    await planner.locator("#title").fill("Raised without a site number");
    await planner.getByRole("button", { name: "Create job" }).click();
    await planner.waitForURL(JOB_URL, { timeout: 20_000 }).catch(() => undefined);

    const raised = await db.job.findFirst({
      where: { title: "Raised without a site number" },
      select: { id: true, site: { select: { id: true, numberPending: true, city: true } } },
    });
    check("the job exists without a site number", Boolean(raised), true);
    check("and its site is marked pending", raised?.site.numberPending, true);
    check("with whatever was known at the time", raised?.site.city, "Bellingham");

    check(
      "the job page asks for the number rather than showing a placeholder",
      await planner.getByText("Not known when this job was raised.").isVisible(),
      true,
    );

    await planner.getByLabel("Site number").fill("77123");
    await planner.getByRole("button", { name: "Save", exact: true }).first().click();
    await planner.waitForTimeout(2500);

    const filled = await db.job.findUniqueOrThrow({
      where: { id: raised!.id },
      select: { site: { select: { siteNumber: true, numberPending: true } } },
    });
    check("the number can be filled in from the job", filled.site.siteNumber, "77123");
    check("and it stops being pending", filled.site.numberPending, false);

    await db.job.delete({ where: { id: raised!.id } });
    await db.site.delete({ where: { id: raised!.site.id } }).catch(() => undefined);
  });

  // --- the scheduled time, saved without being changed ----------------------
  // The input is rendered in the site's zone. Saving it read the value back in
  // the server's, so opening a job and pressing Save moved it by the site's
  // offset — and again on the next save.
  await bossPage(browser, bossToken, async (planner) => {
    const planted = new Date("2026-07-28T16:30:00.000Z");
    await db.job.update({
      where: { id: assignment.jobId },
      data: { scheduledStart: planted },
    });

    await planner.goto(url, { waitUntil: "load" });
    await planner.waitForTimeout(1000);

    // A pencil beside each of fifteen fields is most of what made this page
    // heavy on a phone, so they wait behind the one in the block's corner.
    // Which is the card's corner, beside the title — it used to sit inside the
    // content, floating above the first field with nothing to relate it to.
    const titleBox = await planner
      .getByRole("heading", { name: "Assignment details" })
      .boundingBox();
    const pencilBox = await planner
      .getByRole("button", { name: "Edit assignment details" })
      .boundingBox();
    check(
      "the block's pencil sits in the corner, on the title's line",
      Boolean(
        titleBox &&
          pencilBox &&
          pencilBox.x > titleBox.x + titleBox.width &&
          Math.abs(
            pencilBox.y + pencilBox.height / 2 - (titleBox.y + titleBox.height / 2),
          ) < 24,
      ),
      true,
    );

    await planner
      .getByRole("button", { name: "Edit assignment details" })
      .click();
    await planner.getByRole("button", { name: "Edit Scheduled start" }).click();
    check(
      "the scheduled time is shown in the site's zone",
      await planner.locator('input[type="datetime-local"]').inputValue(),
      "2026-07-28T09:30",
    );

    await planner.getByRole("button", { name: "Save", exact: true }).click();
    await planner.waitForTimeout(2000);

    const saved = await db.job.findUniqueOrThrow({
      where: { id: assignment.jobId },
      select: { scheduledStart: true },
    });
    check(
      "saving it untouched leaves the job where it was",
      saved.scheduledStart?.toISOString(),
      planted.toISOString(),
    );
  });

  // --- dispatch numbers and pay, after the fact -----------------------------
  await bossPage(browser, bossToken, async (planner) => {
    await db.dispatchContact.deleteMany({ where: { jobId: assignment.jobId } });

    await planner.goto(url, { waitUntil: "load" });
    await planner.waitForTimeout(1000);

    await planner.getByRole("button", { name: "Add a number" }).click();
    await planner.locator("#dispatch-add-label").fill("Site security");
    await planner.locator("#dispatch-add-phone").fill("206-555-0199");
    await planner.getByRole("button", { name: "Add contact" }).click();
    await planner.waitForTimeout(2000);

    const added = await db.dispatchContact.findFirst({
      where: { jobId: assignment.jobId },
      select: { id: true, label: true, phone: true },
    });
    check("a number can be added to a job already running", added?.label, "Site security");

    await planner
      .getByRole("button", { name: "Remove Site security" })
      .click();
    await planner.waitForTimeout(2000);
    check(
      "and taken back off",
      await db.dispatchContact.count({ where: { jobId: assignment.jobId } }),
      0,
    );

    // The project's own contacts are not this job's to remove.
    check(
      "the project's numbers are not removable from a job",
      await planner.getByRole("button", { name: /^Remove NetCom/ }).count(),
      0,
    );

    // Pay is not on the page any more. It is one of three things done *to* a
    // job rather than on it, and they all live behind the corner menu now.
    check(
      "the rate is not in the scroll a tech reads on site",
      await planner.locator("#job-pay-type").count(),
      0,
    );

    await openPortal(planner, assignment.jobId);
    await planner.locator("#job-pay-type").selectOption("FLAT");
    await planner.locator("#job-pay-rate").fill("450");
    await planner.locator("#job-pay-travel").fill("30");
    await planner
      .getByRole("button", { name: "Apply to everybody on this job" })
      .click();
    await planner.waitForTimeout(2500);
    await planner.goto(url, { waitUntil: "load" });
    await planner.waitForTimeout(800);

    const paid = await db.jobAssignment.findMany({
      where: { jobId: assignment.jobId },
      select: { payType: true, payRate: true, travelReimbursement: true, userId: true },
    });
    const paidUserIds = paid.map((row) => row.userId);
    check(
      "the rate can be changed on a job afterwards",
      paid.every((row) => row.payType === "FLAT" && row.payRate.toString() === "450"),
      true,
    );
    check(
      "travel money with it",
      paid[0]?.travelReimbursement?.toString(),
      "30",
    );

    // The bug this replaces: the rate was written onto whoever happened to be
    // on the job at the time and then forgotten, so the next person added
    // arrived on their own rate — non-billable, in the usual case — and
    // somebody had to notice and re-apply it.
    await planner.getByRole("button", { name: "Add a tech" }).click();
    await planner.locator("#crew-add").click();
    const newcomer = await planner
      .locator("#crew-add-list")
      .getByRole("option")
      .first()
      .innerText();
    await planner.locator("#crew-add-list").getByRole("option").first().click();
    await planner.getByRole("button", { name: "Add to crew" }).click();
    await planner.waitForTimeout(2500);

    const joined = await db.jobAssignment.findFirstOrThrow({
      where: { jobId: assignment.jobId, user: { name: newcomer.split("\n")[0] } },
      select: { id: true, payType: true, payRate: true, payRateNote: true },
    });
    check(
      "somebody added afterwards arrives on the job's rate",
      `${joined.payType} ${joined.payRate.toString()}`,
      "FLAT 450",
    );
    check("and it says where it came from", joined.payRateNote, "Set on this job");

    // One person can still be put somewhere else deliberately.
    await planner
      .getByRole("button", { name: `Set pay for ${newcomer.split("\n")[0]}` })
      .click();
    await planner.locator("#override-type").selectOption("HOURLY");
    await planner.locator("#override-rate").fill("22.50");

    check(
      "a reason is required before that can be saved",
      await planner.getByRole("button", { name: "Save their rate" }).isDisabled(),
      true,
    );

    await planner.locator("#override-reason").fill("Shadowing at half rate");
    await planner.getByRole("button", { name: "Save their rate" }).click();
    await planner.waitForTimeout(2500);

    const overridden = await db.jobAssignment.findUniqueOrThrow({
      where: { id: joined.id },
      select: { payType: true, payRate: true, payRateNote: true, payOverridden: true },
    });
    check(
      "their own rate applies",
      `${overridden.payType} ${overridden.payRate.toString()}`,
      "HOURLY 22.5",
    );
    check("carrying why", overridden.payRateNote, "Shadowing at half rate");

    // Setting the job's pay again leaves them alone, which is the whole point
    // of having said they are different.
    await openPortal(planner, assignment.jobId);
    await planner.locator("#job-pay-rate").fill("500");
    await planner
      .getByRole("button", { name: "Apply to everybody on this job" })
      .click();
    await planner.waitForTimeout(2500);
    await planner.goto(url, { waitUntil: "load" });
    await planner.waitForTimeout(800);

    check(
      "changing the job's pay leaves a deliberate exception alone",
      (
        await db.jobAssignment.findUniqueOrThrow({
          where: { id: joined.id },
          select: { payRate: true },
        })
      ).payRate.toString(),
      "22.5",
    );
    check(
      "while everybody else moves",
      (
        await db.jobAssignment.findFirstOrThrow({
          where: { jobId: assignment.jobId, payOverridden: false },
          select: { payRate: true },
        })
      ).payRate.toString(),
      "500",
    );

    // Putting them back picks up whatever the job pays now, not what it paid
    // when they were taken off it.
    await planner
      .getByRole("button", { name: `Set pay for ${newcomer.split("\n")[0]}` })
      .click();
    await planner
      .getByRole("button", { name: /^Back to the job/ })
      .click();
    await planner.waitForTimeout(2500);
    check(
      "and they can be put back on it",
      (
        await db.jobAssignment.findUniqueOrThrow({
          where: { id: joined.id },
          select: { payRate: true, payOverridden: true },
        })
      ).payRate.toString(),
      "500",
    );

    await db.jobAssignment.delete({ where: { id: joined.id } });
  });

  // --- how far each role may move a clock -----------------------------------
  // The one calculation in the app that settles what somebody is paid. A crew
  // that forgot to clock out until the morning is the case it exists for, and
  // "we were there another hour" is the case it exists to stop.
  //
  // Site time is UTC-7 here, so 16:00Z reads as 09:00 and 23:00Z as 16:00.
  const clockVisit = await db.visit.findFirstOrThrow({
    where: { assignmentId: assignment.id },
    orderBy: { clockInAt: "asc" },
    select: { id: true },
  });
  const plantedIn = new Date("2026-07-28T16:00:00.000Z");
  const plantedOut = new Date("2026-07-28T23:00:00.000Z");

  async function plantClock() {
    await db.visit.update({
      where: { id: clockVisit.id },
      data: { clockInAt: plantedIn, clockOutAt: plantedOut },
    });
    await db.changeRequest.deleteMany({
      where: { jobId: assignment.jobId, fieldPath: { startsWith: "visit." } },
    });
  }

  async function visitNow() {
    return db.visit.findUniqueOrThrow({
      where: { id: clockVisit.id },
      select: { clockInAt: true, clockOutAt: true },
    });
  }

  await plantClock();
  await db.jobAssignment.update({
    where: { id: assignment.id },
    data: { isLead: false },
  });

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(800);
  check(
    "a tech who is not leading the job has no settings menu",
    await page.getByRole("button", { name: "Job settings", exact: true }).count(),
    0,
  );

  // Leading the job is enough to fix a clock and not enough to change what the
  // job pays, so the same menu opens with one section in it rather than three.
  await db.jobAssignment.update({
    where: { id: assignment.id },
    data: { isLead: true },
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(800);

  await openPortal(page, assignment.jobId);
  const sheet = page.locator(`[data-punch]`).first();
  check(
    "leading it opens the portal",
    await page.getByRole("heading", { name: "TimeClock Punches" }).isVisible(),
    true,
  );
  check(
    "with a block of their own per person",
    await page.locator("[data-punch]").count(),
    1,
  );
  check(
    "but the rate is not the lead's to set",
    await page.locator("#job-pay-type").count(),
    0,
  );

  // Downwards without limit: this can only ever give time back.
  await editPunch(page, sheet, "Edit CO", "2026-07-28T13:00", "Forgot to punch");
  await page.waitForTimeout(2500);

  check(
    "the lead may pull a clock-out back as far as it needs to go",
    (await visitNow()).clockOutAt?.toISOString(),
    "2026-07-28T20:00:00.000Z",
  );

  // Upwards past the hour is the one somebody would write if it were not true.
  await plantClock();
  await openPortal(page, assignment.jobId);

  await editPunch(page, sheet, "Edit CO", "2026-07-28T19:00", "Adjust to time worked");
  await page.waitForTimeout(2500);

  check(
    "adding three hours is not written",
    (await visitNow()).clockOutAt?.toISOString(),
    plantedOut.toISOString(),
  );
  check(
    "it goes to whoever pays for the time instead",
    (
      await db.changeRequest.findFirstOrThrow({
        where: {
          jobId: assignment.jobId,
          fieldPath: `visit.${clockVisit.id}.clockOut`,
        },
        select: { newValue: true, status: true },
      })
    ).newValue,
    "2026-07-29T02:00:00.000Z",
  );
  check(
    "and the lead is told, rather than left thinking it saved",
    await page.getByText(/goes to whoever pays/i).isVisible(),
    true,
  );

  // Pressing Save again with a different reason must not put a second copy in
  // somebody's queue.
  await editPunch(page, sheet, "Edit CO", "2026-07-28T20:00", "Adjust to time worked");
  await page.waitForTimeout(2500);
  check(
    "and asking twice does not queue it twice",
    await db.changeRequest.count({
      where: {
        jobId: assignment.jobId,
        fieldPath: `visit.${clockVisit.id}.clockOut`,
        status: "PENDING",
      },
    }),
    1,
  );

  check(
    "and says so rather than repeating the first answer",
    await page.getByText(/already waiting on whoever pays/i).isVisible(),
    true,
  );

  // Within the hour, either way, is theirs.
  await editPunch(page, sheet, "Edit CI", "2026-07-28T08:30", "Forgot to punch");
  await page.waitForTimeout(2500);
  check(
    "half an hour on a clock-in is within reach",
    (await visitNow()).clockInAt?.toISOString(),
    "2026-07-28T15:30:00.000Z",
  );

  // Whoever pays for the time has no bounds — they are the ones who answer the
  // request above.
  await plantClock();
  await db.auditEvent.deleteMany({
    where: { jobId: assignment.jobId, action: "time_adjusted" },
  });

  await bossPage(browser, bossToken, async (planner) => {
    await openPortal(planner, assignment.jobId);

    const menu = planner.locator("[data-punch]").first();
    await editPunch(planner, menu, "Edit CI", "2026-07-28T06:00", "Adjust to time worked");
    await planner.waitForTimeout(2500);

    check(
      "a manager moves a clock three hours without asking anybody",
      (await visitNow()).clockInAt?.toISOString(),
      "2026-07-28T13:00:00.000Z",
    );
    check(
      "and it is on the record with who and why",
      (
        (
          await db.auditEvent.findFirstOrThrow({
            where: { jobId: assignment.jobId, action: "time_adjusted" },
            select: { detail: true },
          })
        ).detail as { reason?: string } | null
      )?.reason,
      "QuickTec/Adjust to time worked",
    );
  });

  await plantClock();

  // --- the sections this job asks for ---------------------------------------
  // Old Serials, Return Labels and the rest existed in the model and on the
  // project, but there was nowhere to switch them on for one job — so a
  // customer who wants serials recorded on this visit alone could not be
  // answered without changing the project for everybody.
  await bossPage(browser, bossToken, async (planner) => {
    await planner.goto(url, { waitUntil: "load" });
    await planner.waitForTimeout(1000);

    check(
      "the sections are folded away until somebody wants them",
      await planner.getByRole("button", { name: /Sections/ }).isVisible(),
      true,
    );

    await planner.getByRole("button", { name: /Sections/ }).click();
    await planner.waitForTimeout(300);

    await planner
      .getByRole("checkbox", { name: "Old Serials" })
      .check({ force: true });
    await planner.waitForTimeout(2000);

    const rules = await db.deliverableRequirement.findMany({
      where: { jobId: assignment.jobId },
      select: { category: true, enabled: true, required: true },
    });
    const on = rules
      .filter((rule) => rule.enabled)
      .map((rule) => rule.category)
      .sort();

    check("switching one on saves it against this job", on.includes("OLD_SERIALS"), true);
    // The trap: job rules win outright over the project's, so writing one row
    // on its own would leave the job asking for that row and nothing else.
    check(
      "and what the project already asked for is still there",
      on.includes("PRE_INSTALL") && on.includes("POST_INSTALL"),
      true,
    );
    // The nine fixed sections. A custom one is not among them until somebody
    // makes it, because it has no meaning without the name they give it.
    check("the whole sheet is written, not one row", rules.length, 9);

    await planner
      .locator('[data-section="OLD_SERIALS"]')
      .getByRole("checkbox", { name: "Required", exact: true })
      .check({ force: true });
    await planner.waitForTimeout(2000);
    check(
      "and that section on its own can be made mandatory",
      (
        await db.deliverableRequirement.findFirstOrThrow({
          where: { jobId: assignment.jobId, category: "OLD_SERIALS" },
        })
      ).required,
      true,
    );

    await planner.reload({ waitUntil: "domcontentloaded" });
    await planner.waitForTimeout(500);
    check(
      "the tech is now shown the section",
      await planner.getByRole("button", { name: "Add to Old Serials" }).isVisible(),
      true,
    );
  });

  // --- a return that goes back in more than one box -------------------------
  // The number used to be a single field in Time & schedule, three blocks away
  // from the label the tech is holding, and there was one of it. It is now
  // recorded beside the photo of the label, one field per box.
  await db.deliverableRequirement.updateMany({
    where: { jobId: assignment.jobId, category: "RETURN_LABELS" },
    data: { enabled: true, required: false, requiresText: true },
  });
  await db.deliverableItem.deleteMany({
    where: { jobId: assignment.jobId, category: "RETURN_LABELS" },
  });

  await page.goto(url, { waitUntil: "load" });
  await page.waitForTimeout(1000);

  check(
    "return tracking is no longer a field of its own in Time & schedule",
    await page.getByText("Return tracking #").count(),
    0,
  );

  await page.getByRole("button", { name: "Add to Return Labels" }).click();
  // By role as well as name: each row's remove button is labelled after the
  // number it removes, so "Tracking number 2" alone matches two elements.
  await page
    .getByRole("textbox", { name: "Tracking number 1", exact: true })
    .fill("1Z999AA10123456784");
  await page
    .getByRole("button", { name: "Another tracking number" })
    .click();
  await page
    .getByRole("textbox", { name: "Tracking number 2", exact: true })
    .fill("1Z999AA10123456791");
  await page.getByRole("button", { name: "Save", exact: true }).first().click();
  await page.waitForTimeout(2500);

  check(
    "each box's number is kept on its own",
    (
      await db.deliverableItem.findFirstOrThrow({
        where: { jobId: assignment.jobId, category: "RETURN_LABELS" },
        select: { textValue: true },
      })
    ).textValue,
    "1Z999AA10123456784\n1Z999AA10123456791",
  );

  check(
    "and the client reads them as one list",
    buildTextReport((await loadJobForExport(assignment.jobId))!)
      .split("\n")
      .find((line) => line.startsWith("Return track #:")),
    "Return track #: 1Z999AA10123456784, 1Z999AA10123456791",
  );

  // --- the crew picker ------------------------------------------------------
  await bossPage(browser, bossToken, async (planner) => {
    await planner.goto(url, { waitUntil: "load" });
    await planner.waitForTimeout(1000);

    await planner.getByRole("button", { name: "Add a tech" }).click();
    await planner.locator("#crew-add").click();
    check(
      "the crew is picked by searching too, not from a wheel",
      await planner.locator('input[role="combobox"]#crew-add').isVisible(),
      true,
    );
  });

  // --- the read-through before signing off ----------------------------------
  // One button asked somebody to vouch for a day they did not see, and the only
  // possible answer was yes.
  await bossPage(browser, bossToken, async (planner) => {
    await db.job.update({
      where: { id: assignment.jobId },
      data: { lifecycle: "PENDING_REVIEW", estimateMinutes: 60 },
    });

    await planner.goto(`${BASE}/jobs/${assignment.jobId}/review`, {
      waitUntil: "load",
    });
    await planner.waitForTimeout(1000);

    check(
      "the reviewer gets a read-through, not a button",
      await planner.getByText("Review before approving").isVisible(),
      true,
    );

    for (const [step, next] of [
      ["times", "Deliverables"],
      ["deliverables", "Reimbursements"],
      ["reimbursements", "Work performed"],
    ] as const) {
      check(
        `the ${step} step is shown`,
        await planner.locator(`[data-review-step="${step}"]`).isVisible(),
        true,
      );
      check(
        `and ${next} is waiting behind it`,
        await planner.getByRole("button", { name: next }).isVisible(),
        true,
      );
      await planner.getByRole("button", { name: "Looks right" }).click();
      await planner.waitForTimeout(300);
    }

    check(
      "the last step is what the client will read",
      await planner.locator('[data-review-step="work"]').isVisible(),
      true,
    );

    // The day ran well past an hour, which is exactly the thing a reviewer
    // would otherwise have to work out from two timestamps.
    await planner.getByRole("button", { name: "Times" }).click();
    await planner.waitForTimeout(300);
    check(
      "a day well past the estimate is put in front of them",
      await planner.getByText(/against an estimate of/).isVisible(),
      true,
    );

    await planner.getByRole("button", { name: "Work performed" }).click();
    await planner.waitForTimeout(300);
    await planner.getByRole("button", { name: "Approve report" }).click();
    await planner.waitForTimeout(2500);

    check(
      "and approving at the end of it signs the job off",
      (
        await db.job.findUniqueOrThrow({
          where: { id: assignment.jobId },
          select: { lifecycle: true },
        })
      ).lifecycle,
      "APPROVED",
    );
  });

  // --- one person's punch, not the crew's ------------------------------------
  // The flat list this replaces mixed two techs' rows into one column, so a
  // Remove button meant for one read as one that would take everybody's day.
  await bossPage(browser, bossToken, async (planner) => {
    const second = await db.user.findFirstOrThrow({
      where: { email: "sup@417group.org" },
      select: { id: true, name: true },
    });
    const extra = await db.jobAssignment.create({
      data: {
        jobId: assignment.jobId,
        userId: second.id,
        payType: "HOURLY",
        payRate: "40",
      },
      select: { id: true },
    });
    await db.visit.create({
      data: {
        assignmentId: extra.id,
        clockInAt: new Date("2026-07-28T17:00:00Z"),
        clockOutAt: new Date("2026-07-28T22:00:00Z"),
      },
    });
    await plantClock();

    await openPortal(planner, assignment.jobId);
    check(
      "each person gets a block of their own",
      await planner.locator("[data-punch]").count(),
      2,
    );

    const theirs = planner.locator(`[data-punch]`).nth(1);
    await theirs
      .getByRole("button", { name: `Punch actions for ${second.name}` })
      .click();
    await planner.getByRole("button", { name: "Remove punch" }).click();
    await pickReason(planner, "Job Cancelled");
    await planner.getByRole("button", { name: "Remove", exact: true }).click();
    await planner.waitForTimeout(2500);

    check(
      "removing one takes only theirs",
      await db.visit.count({ where: { assignmentId: extra.id } }),
      0,
    );
    check(
      "and leaves the rest of the crew's alone",
      await db.visit.count({ where: { assignmentId: assignment.id } }),
      1,
    );

    // A punch that was never made can be written by whoever pays for the time.
    await planner.reload({ waitUntil: "load" });
    await planner.waitForTimeout(800);
    await planner
      .getByRole("button", { name: `Punch actions for ${second.name}` })
      .click();
    await planner.getByRole("button", { name: "Add a punch" }).click();
    await planner.locator(`#add-in-${extra.id}`).fill("2026-07-28T10:00");
    await planner.locator(`#add-out-${extra.id}`).fill("2026-07-28T15:00");
    await pickReason(planner, "Forgot to punch");
    await planner.getByRole("button", { name: "Save punch" }).click();
    await planner.waitForTimeout(2500);

    check(
      "and it is marked as written by hand rather than pressed",
      (
        await db.visit.findFirstOrThrow({
          where: { assignmentId: extra.id },
          select: { addedManually: true },
        })
      ).addedManually,
      true,
    );

    check(
      "and a day nobody recorded can be written",
      (
        await db.visit.findFirstOrThrow({
          where: { assignmentId: extra.id },
          select: { clockInAt: true },
        })
      ).clockInAt.toISOString(),
      "2026-07-28T17:00:00.000Z",
    );

    await db.jobAssignment.delete({ where: { id: extra.id } });
  });

  // --- booking the return trip answers the flag -----------------------------
  // A queue that only ever grows is one people stop opening, so the job leaves
  // it when the revisit it asked for exists.
  await bossPage(browser, bossToken, async (planner) => {
    await db.job.update({
      where: { id: assignment.jobId },
      data: { internalStatus: "REVISIT_REQUIRED" },
    });

    await planner.goto(url, { waitUntil: "load" });
    await planner.waitForTimeout(1000);

    await openJobMenu(planner);
    await planner
      .getByRole("link", { name: /Schedule a revisit/ })
      .click();
    await planner.waitForTimeout(1500);
    await planner.getByRole("button", { name: "Schedule a revisit" }).click();
    await planner.getByRole("button", { name: "Create revisit" }).click();

    // Not waitForURL: the page is already on a job URL, so the pattern matches
    // before anything has happened and the check below reads the old state.
    for (let attempt = 0; attempt < 30; attempt++) {
      const made = await db.job.count({
        where: { parentJobId: assignment.jobId },
      });
      if (made > 0) break;
      await planner.waitForTimeout(1000);
    }

    check(
      "the revisit exists",
      await db.job.count({ where: { parentJobId: assignment.jobId } }),
      1,
    );

    check(
      "scheduling the revisit takes the job out of the queue",
      (
        await db.job.findUniqueOrThrow({
          where: { id: assignment.jobId },
          select: { internalStatus: true },
        })
      ).internalStatus,
      "RESCHEDULED",
    );

    // Not left behind for the next run to trip over.
    await db.job.deleteMany({ where: { parentJobId: assignment.jobId } });
    await db.job.update({
      where: { id: assignment.jobId },
      data: { internalStatus: null },
    });
  });

  // --- a company's standing blank, offered on the next job ------------------
  // The sign-off sheet is the same PDF every time. Re-uploading it per job is
  // how a job goes out on last year's form.
  const netcom = await db.client.findFirstOrThrow({ where: { name: { startsWith: "NetCom" } } });
  const blank = await db.attachment.create({
    data: {
      storagePath: "templates/seed-signoff.pdf",
      originalName: "NetCom-SignOff.pdf",
      mimeType: "application/pdf",
      sizeBytes: 32,
      uploadedById: boss.id,
    },
  });
  await mkdir(dirname(absolutePath("templates/seed-signoff.pdf")), {
    recursive: true,
  });
  await writeFile(
    absolutePath("templates/seed-signoff.pdf"),
    "%PDF-1.4\ntrailer<<>>\n%%EOF\n",
  );
  const template = await db.clientDocumentTemplate.create({
    data: {
      clientId: netcom.id,
      kind: "SIGN_OFF",
      label: "NetCom sign-off 2026",
      isDefault: true,
      attachmentId: blank.id,
    },
  });

  await bossPage(browser, bossToken, async (planner) => {
    await planner.goto(`${BASE}/jobs/new`, { waitUntil: "load" });
    await planner.waitForTimeout(1500);

    await planner.locator("#clientId").click();
    await planner.locator("#clientId").fill("netcom");
    await planner.getByRole("option", { name: /NetCom/ }).click();
    await planner.waitForTimeout(300);

    check(
      "their standing form is offered",
      await planner.getByText("NetCom sign-off 2026").isVisible(),
      true,
    );
    check(
      "already ticked, because it is their default",
      await planner
        .locator(`input[name="templateIds"][value="${template.id}"]`)
        .isChecked(),
      true,
    );

    await planner.locator("#customerId").click();
    await planner.locator("#customerId-list").getByRole("option").first().click();
    await planner.waitForTimeout(300);
    await planner.locator("#siteId").click();
    await planner.locator("#siteId-list").getByRole("option").first().click();
    await planner.locator("#title").fill("Job with their sign-off blank");
    await planner.getByRole("button", { name: "Create job" }).click();
    await planner.waitForURL(JOB_URL, { timeout: 20_000 }).catch(() => undefined);

    const withBlank = await db.job.findFirst({
      where: { title: "Job with their sign-off blank" },
      select: {
        id: true,
        documents: { select: { originalName: true, jobDocumentKind: true, storagePath: true } },
      },
    });
    check("the blank comes across onto the job", withBlank?.documents.length, 1);
    check(
      "as the sign-off sheet",
      withBlank?.documents[0]?.jobDocumentKind,
      "SIGN_OFF",
    );
    // Its own copy of the bytes: replacing the template next year must not
    // change what a job that already went out was sent on.
    check(
      "with its own copy of the file",
      withBlank?.documents[0]?.storagePath !== blank.storagePath,
      true,
    );

    if (withBlank) await db.job.delete({ where: { id: withBlank.id } });
  });

  await db.clientDocumentTemplate.delete({ where: { id: template.id } });
  await db.attachment.delete({ where: { id: blank.id } });

  // --- the shell -----------------------------------------------------------
  // The sign-out icon was one mis-tap from ending somebody's shift, and it was
  // the only route to the account page short of knowing the URL.
  await bossPage(browser, bossToken, async (planner) => {
    await planner.goto(`${BASE}/dashboard`, { waitUntil: "load" });
    await planner.waitForTimeout(500);

    check(
      "there is no bare sign-out button in the corner",
      await planner.getByRole("button", { name: "Sign out" }).count(),
      0,
    );

    await planner.getByRole("button", { name: "Account" }).click();
    check(
      "the account menu offers the profile",
      await planner.getByRole("menuitem", { name: "Your profile" }).isVisible(),
      true,
    );
    check(
      "the settings",
      await planner.getByRole("menuitem", { name: "Settings" }).isVisible(),
      true,
    );
    check(
      "and signing out, behind a deliberate open",
      await planner.getByRole("menuitem", { name: "Sign out" }).isVisible(),
      true,
    );
    await planner.keyboard.press("Escape");

    // The company owns the deployment; whether its name is spelled out is a
    // setting, because a long one eats the whole bar on a phone.
    check(
      "the header names the company by default",
      await planner.locator("header").getByText("417 Group | QuickTec").isVisible(),
      true,
    );

    await db.companySettings.update({
      where: { id: "singleton" },
      data: { showCompanyNameInHeader: false },
    });
    await planner.reload({ waitUntil: "load" });
    check(
      "and can be told to show only the app",
      await planner.locator("header").getByText("QuickTec", { exact: true }).isVisible(),
      true,
    );
    await db.companySettings.update({
      where: { id: "singleton" },
      data: { showCompanyNameInHeader: true },
    });
  });

  // --- the dashboard is about the work -------------------------------------
  // It used to describe your own permissions, which is a thing you find out
  // once and never need again.
  await bossPage(browser, bossToken, async (planner) => {
    // Tuesday noon at the site, derived from the week the app itself computes.
    // "today at 18:00Z" is next week when UTC has rolled over and Los Angeles
    // has not, which is every evening.
    const { startOfWeekMonday } = await import("@/lib/datetime");
    const company = await db.companySettings.findUniqueOrThrow({
      where: { id: "singleton" },
      select: { defaultTimeZone: true },
    });
    const midweek = new Date(
      startOfWeekMonday(new Date(), company.defaultTimeZone).getTime() +
        36 * 3_600_000,
    );

    await db.job.update({
      where: { id: assignment.jobId },
      data: { scheduledStart: midweek, lifecycle: "SCHEDULED" },
    });

    await planner.goto(`${BASE}/dashboard`, { waitUntil: "load" });
    await planner.waitForTimeout(500);

    check(
      "the week is what the dashboard opens on",
      await planner.getByRole("heading", { name: "This week" }).isVisible(),
      true,
    );
    // Both layouts are in the DOM and CSS decides which one shows, so ask for
    // the visible one rather than the first one.
    check(
      "a job scheduled this week is on it",
      await planner
        .locator(`a[href="/jobs/${assignment.jobId}"]:visible`)
        .count(),
      1,
    );

    // And the phone gets the same week as a vertical run of days.
    await planner.setViewportSize({ width: 390, height: 844 });
    await planner.waitForTimeout(300);
    check(
      "which a phone shows too, in its own shape",
      await planner
        .locator(`a[href="/jobs/${assignment.jobId}"]:visible`)
        .count(),
      1,
    );
    await planner.setViewportSize({ width: 1280, height: 800 });
    check(
      "what is waiting on you is there too",
      await planner.getByRole("heading", { name: "Waiting on you" }).isVisible(),
      true,
    );
    check(
      "and the projects you are on",
      await planner.getByRole("heading", { name: "Your projects" }).isVisible(),
      true,
    );
    check(
      "with no wall of permission badges",
      await planner.getByText("What you can do").count(),
      0,
    );
  });

  // --- the tab bar is a fixed shape ----------------------------------------
  await bossPage(browser, bossToken, async (planner) => {
    await planner.setViewportSize({ width: 390, height: 844 });
    await planner.goto(`${BASE}/dashboard`, { waitUntil: "load" });
    await planner.waitForTimeout(500);

    const bar = planner.locator("nav").last();
    check(
      "five tabs, no more",
      await bar.getByRole("link").count(),
      5,
    );
    for (const label of ["Dashboard", "Jobs", "Projects", "Approvals", "More"]) {
      check(
        `  ${label} is one of them`,
        await bar.getByRole("link", { name: label }).isVisible(),
        true,
      );
    }

    await bar.getByRole("link", { name: "More" }).click();
    await planner.waitForTimeout(500);
    check(
      "and More holds what the bar does not, without repeating it",
      await planner.getByRole("main").getByRole("link", { name: "Jobs" }).count(),
      0,
    );
  });

  // Renamed because "client" reads as the customer being served, which is the
  // opposite of what it means here.
  await bossPage(browser, bossToken, async (adminPage) => {
    await adminPage.goto(`${BASE}/directory`, { waitUntil: "domcontentloaded" });
    check(
      "the directory calls them representing companies",
      await adminPage.getByText("Representing companies").first().isVisible(),
      true,
    );
    check(
      "and never clients",
      await adminPage.getByText("Clients", { exact: true }).count(),
      0,
    );
  });

  await browser.close();
  await db.companySettings.update({
    where: { id: "singleton" },
    data: { name: settings.name },
  });
  await db.$disconnect();

  console.log(
    `\n${failures === 0 ? "ALL BROWSER CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

/** Runs a block in a fresh manager session, then closes it. */
/** The "…" in the page header, which now chooses between three pages. */
async function openJobMenu(page: import("playwright").Page) {
  await page.getByRole("button", { name: "Job settings", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Job settings" })
    .waitFor({ timeout: 15_000 });
}

/**
 * Chooses a reason in the smart-search field, whichever pane is open.
 *
 * The picker is a button until it is opened and an input after — the same id
 * on both — so it takes a click before it takes any typing.
 */
async function pickReason(page: import("playwright").Page, what: string) {
  const field = page.locator('[id$="-reason"]').last();
  await field.click();
  await page.locator('input[role="combobox"]').last().fill(what);
  await page.getByRole("option", { name: new RegExp(what) }).first().click();
}

/** Opens one punch's menu, edits a clock, and says why. */
async function editPunch(
  page: import("playwright").Page,
  block: import("playwright").Locator,
  action: string,
  at: string,
  reason: string,
) {
  await block.getByRole("button", { name: /^Punch actions for/ }).click();
  await page.getByRole("button", { name: action, exact: true }).click();
  await block.locator('input[type="datetime-local"]').fill(at);
  await pickReason(page, reason);
  await block.getByRole("button", { name: "Save", exact: true }).click();
}

/** Straight to the portal, which is where punches and pay went. */
async function openPortal(page: import("playwright").Page, jobId: string) {
  await page.goto(`${BASE}/jobs/${jobId}/manage`, { waitUntil: "load" });
  await page.waitForTimeout(800);
}

async function bossPage(
  browser: import("playwright").Browser,
  token: string,
  run: (page: import("playwright").Page) => Promise<void>,
) {
  const context = await browser.newContext();
  await context.addCookies([
    { name: "authjs.session-token", value: token, url: BASE },
  ]);
  await run(await context.newPage());
  await context.close();
}

/**
 * Scribbles on the signature pad. Pointer events rather than mouse events,
 * because that is what the pad listens for so a finger and a stylus work the
 * same way.
 */
async function drawSignature(page: import("playwright").Page) {
  const canvas = page.locator("canvas").first();
  await canvas.waitFor({ timeout: 15_000 });

  const box = await canvas.boundingBox();
  if (!box) throw new Error("Signature pad has no box");

  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + 20, y);
  await page.mouse.down();
  for (let step = 1; step <= 6; step++) {
    await page.mouse.move(
      box.x + 20 + (box.width - 40) * (step / 6),
      y + (step % 2 === 0 ? -18 : 18),
    );
  }
  await page.mouse.up();
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
