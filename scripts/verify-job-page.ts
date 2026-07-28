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

  // Start from a clean slate so repeated runs are comparable. Contacts and
  // signatures matter as much as visits here: a MOD left over from a previous
  // run changes which branch of the wizard renders.
  await db.visit.deleteMany({ where: { assignmentId: assignment.id } });
  await db.signature.deleteMany({ where: { jobId: assignment.jobId } });
  await db.pointOfContact.deleteMany({ where: { jobId: assignment.jobId } });
  await db.deliverableItem.deleteMany({ where: { jobId: assignment.jobId } });
  await db.reimbursement.deleteMany({ where: { jobId: assignment.jobId } });
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

  await browser.close();
  await db.$disconnect();

  console.log(
    `\n${failures === 0 ? "ALL BROWSER CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`,
  );
  process.exit(failures === 0 ? 0 : 1);
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
