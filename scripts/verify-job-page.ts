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

  const assignment = await db.jobAssignment.findFirstOrThrow({
    where: { userId: tech.id },
    select: { id: true, jobId: true },
  });

  // Start from a clean slate so repeated runs are comparable. Contacts and
  // signatures matter as much as visits here: a MOD left over from a previous
  // run changes which branch of the wizard renders.
  await db.visit.deleteMany({ where: { assignmentId: assignment.id } });
  await db.signature.deleteMany({ where: { jobId: assignment.jobId } });
  await db.pointOfContact.deleteMany({ where: { jobId: assignment.jobId } });
  await db.deliverableItem.deleteMany({ where: { jobId: assignment.jobId } });
  await db.reimbursement.deleteMany({ where: { jobId: assignment.jobId } });
  await db.attachment.deleteMany({ where: { workOrderJobId: assignment.jobId } });
  await db.auditEvent.deleteMany({ where: { jobId: assignment.jobId } });
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

    await page
      .locator('input[type="file"]')
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

    // Representing company: type, filter, pick.
    await planner.locator("#clientId").click();
    await planner.locator("#clientId").fill("netcom");
    await planner.getByRole("option", { name: /NetCom/ }).click();
    check(
      "the company can be found by typing",
      (await planner.locator('input[name="clientId"]').inputValue()).length > 0,
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

    if (made) await db.job.delete({ where: { id: made.id } });
    if (created) await db.site.delete({ where: { id: created.id } });
  });

  // --- creating a job -------------------------------------------------------
  // The Lead radio only exists in the DOM once somebody is assigned, so a job
  // planned with no crew submitted no leadId at all and the whole form was
  // rejected — presenting as a Create button that did nothing.
  await bossPage(browser, bossToken, async (planner) => {
    await planner.goto(`${BASE}/jobs/new`, { waitUntil: "load" });
    await planner.waitForTimeout(1500);

    await planner.locator("#title").fill("Planned with no crew");
    // Nothing is preselected any more, so the company is part of filling it in.
    await planner.locator("#clientId").click();
    await planner.getByRole("option").first().click();
    await planner.locator("#siteId").click();
    await planner.getByRole("option").first().click();
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

  // --- the representing company's work order --------------------------------
  // It used to live in somebody's inbox, which meant the tech at the door
  // could not read the document the job answers to.
  await bossPage(browser, bossToken, async (planner) => {
    await planner.goto(url, { waitUntil: "load" });
    await planner.waitForTimeout(1000);

    check(
      "there is somewhere to put the representing company's WO",
      await planner.getByText("No work order attached yet.").isVisible(),
      true,
    );

    await planner.locator('input[type="file"][accept*="pdf"]').last().setInputFiles({
      name: "NetCom-WO-887766.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(
        "%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
      ),
    });
    await planner.getByRole("button", { name: "Attach" }).click();
    await planner.waitForTimeout(2500);

    const stored = await db.attachment.findFirst({
      where: { workOrderJobId: assignment.jobId },
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
      await db.attachment.count({ where: { workOrderJobId: assignment.jobId } }),
      0,
    );
  });

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
