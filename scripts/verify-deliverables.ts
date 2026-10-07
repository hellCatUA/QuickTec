import "dotenv/config";
import { inflateRawSync } from "node:zlib";
import { encode } from "@auth/core/jwt";
import { chromium, type Page } from "playwright";
import { db } from "@/lib/db";
import { missingRequiredDeliverables } from "@/lib/job-deliverables";

/**
 * Deliverables as the crew meets them: sections counted in photos, a section
 * photographed at each location, the note the planner left, and a photo
 * opened, moved and deleted from its own window.
 *
 * Works on the fixture job, and resets what it touches first — run
 * `npm run fixtures` once on a fresh database. Needs the app running on
 * BASE_URL with the same AUTH_SECRET. Never alongside another browser suite:
 * they share the fixture job.
 */

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const NOTE = "Shoot the rack front and the patch panel labels.";

let failures = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label}\n      got ${actual}${ok ? "" : `  want ${expected}`}`,
  );
}

/** Every file in a zip, by name, read from its central directory. */
function zipEntries(zip: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  for (let at = 0; at + 46 <= zip.length; at++) {
    if (zip.readUInt32LE(at) !== 0x02014b50) continue;
    const method = zip.readUInt16LE(at + 10);
    const compressed = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const extraLength = zip.readUInt16LE(at + 30);
    const commentLength = zip.readUInt16LE(at + 32);
    const local = zip.readUInt32LE(at + 42);
    const name = zip.subarray(at + 46, at + 46 + nameLength).toString("utf8");
    const start =
      local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const data = zip.subarray(start, start + compressed);
    out.set(name, method === 8 ? inflateRawSync(data) : Buffer.from(data));
    at += 45 + nameLength + extraLength + commentLength;
  }
  return out;
}

async function openDeliverables(page: Page, url: string) {
  await page.goto(url, { waitUntil: "load" });
  const tab = page.getByRole("tab", { name: /^Deliverables/ });
  await tab.waitFor({ timeout: 15_000 });
  if ((await tab.getAttribute("aria-selected")) !== "true") await tab.click();
  await page.waitForTimeout(300);
}

async function main() {
  if (process.env.QUICKTEC_ALLOW_DESTRUCTIVE_VERIFY !== "1") {
    console.log("Refusing to run: this rewrites the fixture job's deliverables.");
    console.log("Set QUICKTEC_ALLOW_DESTRUCTIVE_VERIFY=1 on a development database.");
    process.exit(1);
  }

  const tech = await db.user.findUniqueOrThrow({
    where: { email: "tech@417group.org" },
  });
  const boss = await db.user.findUniqueOrThrow({
    where: { email: "boss@417group.org" },
  });
  const assignment = await db.jobAssignment.findFirstOrThrow({
    where: { userId: tech.id, job: { title: "Elevator phone line" } },
    select: {
      id: true,
      jobId: true,
      isLead: true,
      job: { select: { lifecycle: true, deliverablesFrozenAt: true } },
    },
  });
  const jobId = assignment.jobId;
  // Before checkout, as a job is while the crew is photographing it, and
  // following its project. The job page suite checks it out and leaves it that
  // way — fixed at checkout, which is not where this starts.
  await db.job.update({
    where: { id: jobId },
    data: { lifecycle: "SCHEDULED", deliverablesFrozenAt: null, deliverablesOwn: false },
  });
  const url = `${BASE}/jobs/${jobId}`;

  // --- a clean slate ---------------------------------------------------------
  // The tech is the lead on the fixture job, and the lead may take locations
  // away. This is about a tech who is not.
  await db.jobAssignment.update({
    where: { id: assignment.id },
    data: { isLead: false },
  });
  await db.attachment.deleteMany({ where: { deliverableItem: { jobId } } });
  await db.deliverableItem.deleteMany({ where: { jobId } });
  await db.jobLocation.deleteMany({ where: { jobId } });
  await db.deliverableRequirement.deleteMany({ where: { jobId } });
  await db.deliverableRequirement.createMany({
    data: [
      {
        jobId,
        category: "PRE_INSTALL",
        enabled: true,
        required: true,
        requiresPhoto: true,
        minPhotos: 2,
        perLocation: true,
        note: NOTE,
        order: 0,
      },
      {
        jobId,
        category: "POST_INSTALL",
        enabled: true,
        required: true,
        requiresPhoto: true,
        order: 1,
      },
      {
        jobId,
        category: "ISSUES",
        enabled: true,
        required: false,
        requiresPhoto: true,
        order: 3,
      },
    ],
  });
  // The dictionary as the seed leaves it, for the entries this relies on.
  for (const [label, icon, order] of [
    ["MDF", "server", 0],
    ["IDF", "network", 1],
    ["Install point", "locate-fixed", 3],
  ] as const) {
    await db.knownLocation.upsert({
      where: { label },
      update: { icon, active: true },
      create: { label, icon, order },
    });
  }
  await db.knownLocation.deleteMany({ where: { label: { startsWith: "Kitchen" } } });

  const mdf = await db.jobLocation.create({
    data: { jobId, name: "MDF", order: 0 },
  });
  const idf = await db.jobLocation.create({
    data: { jobId, name: "IDF", order: 1 },
  });

  const sharp = (await import("sharp")).default;
  const photo = (colour: string) =>
    sharp({
      create: { width: 1200, height: 900, channels: 3, background: colour },
    })
      .jpeg()
      .toBuffer();

  const tokenFor = (user: { nextcloudSub: string | null; id: string }) =>
    encode({
      token: { sub: user.nextcloudSub!, userId: user.id },
      secret: process.env.AUTH_SECRET!,
      salt: "authjs.session-token",
      maxAge: 3600,
    });

  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
  });
  const techContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  await techContext.addCookies([
    { name: "authjs.session-token", value: await tokenFor(tech), url: BASE },
  ]);
  const page = await techContext.newPage();
  page.on("dialog", (dialog) => dialog.accept());

  // --- what the tech is told -------------------------------------------------
  await openDeliverables(page, url);

  const banner = page.getByRole("button", { name: /Still needed to close/ });
  check(
    "the strip says what is missing, room by room",
    (await banner.textContent())?.includes("Pre-Install at both locations"),
    true,
  );
  check(
    "and names the section counted as a whole",
    (await banner.textContent())?.includes("Post Install"),
    true,
  );
  check(
    "the planner's note is shown under the section",
    await page.getByText(NOTE).isVisible(),
    true,
  );
  check(
    "the descriptions nobody wrote are gone",
    await page.getByText("Photos of the finished work.").count(),
    0,
  );
  check(
    "each location is a pill with what it still owes",
    await page.getByRole("button", { name: "MDF 0/2" }).isVisible(),
    true,
  );
  check(
    "drawn with its icon from the list",
    await page
      .getByRole("button", { name: "MDF 0/2" })
      .locator("svg.lucide-server")
      .count(),
    1,
  );
  check(
    "and the folded row counts what the section needs in all",
    await page
      .locator('[data-deliverable="PRE_INSTALL"]')
      .getByText("0 of 4")
      .isVisible(),
    true,
  );

  // --- photographing the MDF -------------------------------------------------
  await page.getByRole("button", { name: "MDF 0/2" }).click();
  await page.waitForTimeout(300);
  check(
    "a pill opens the section at that location",
    await page.locator(`#loc-PRE_INSTALL-${mdf.id}`).isVisible(),
    true,
  );
  check(
    "the missing photos are slots you can tap",
    await page
      .getByRole("button", { name: /Add the missing photo \(1 of 2\) at MDF/ })
      .isVisible(),
    true,
  );

  async function addAt(place: string, colour: string, name: string) {
    await page.getByRole("button", { name: `Add to ${place}`, exact: true }).click();
    await page
      .locator('input[type="file"]:not([id^="doc-"])')
      .first()
      .setInputFiles({ name, mimeType: "image/jpeg", buffer: await photo(colour) });
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page
      .getByText(`Adding to ${place}`)
      .waitFor({ state: "detached", timeout: 60_000 });
    await page.waitForTimeout(1200);
  }

  await addAt("Pre-Install at MDF", "#3a4250", "MDF-1.jpg");
  const first = await db.deliverableItem.findFirst({
    where: { jobId, category: "PRE_INSTALL" },
    select: { locationId: true, _count: { select: { attachments: true } } },
  });
  check("the photo is filed under the location it was added at", first?.locationId, mdf.id);
  check(
    "one of two reads as such",
    await page.locator(`#loc-PRE_INSTALL-${mdf.id}`).getByText("1 of 2").isVisible(),
    true,
  );

  await addAt("Pre-Install at MDF", "#5b4a3a", "MDF-2.jpg");
  check(
    "a location with enough is no longer on the strip",
    (await banner.textContent())?.includes("MDF"),
    false,
  );
  check(
    "the rest of the section still is",
    (await banner.textContent())?.includes("Pre-Install at IDF"),
    true,
  );
  check(
    "and checkout refuses on the same terms",
    (await missingRequiredDeliverables(jobId)).join(" | "),
    "Pre-Install at IDF (0 of 2) | Post Install",
  );

  // --- the photo window ------------------------------------------------------
  await page
    .locator(`#loc-PRE_INSTALL-${mdf.id}`)
    .getByRole("button", { name: "Open photo 1 of 2" })
    .click();
  const viewer = page.getByRole("dialog");
  await viewer.waitFor({ timeout: 10_000 });
  check(
    "a photo opens in a window over the job, not a new tab",
    await viewer.getAttribute("aria-label"),
    "Pre-Install, MDF · photo 1 of 2",
  );
  const attachments = await db.attachment.findMany({
    where: { deliverableItem: { jobId, category: "PRE_INSTALL" } },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  check(
    "full size is the original, not a thumbnail",
    (await viewer.getByRole("link", { name: "Full size" }).getAttribute("href"))?.replace(
      /\?v=\w+$/,
      "",
    ),
    `/api/files/${attachments[0].id}`,
  );
  const download = await page.request.get(
    `${BASE}${await viewer.getByRole("link", { name: "Download" }).getAttribute("href")}`,
  );
  check(
    "download hands the file over as a file",
    download.headers()["content-disposition"]?.startsWith("attachment;"),
    true,
  );

  await viewer.getByRole("button", { name: "Next photo" }).click();
  check(
    "the arrows walk the section",
    await viewer.getAttribute("aria-label"),
    "Pre-Install, MDF · photo 2 of 2",
  );

  // The second MDF photo was of the IDF.
  await viewer.getByRole("button", { name: "Options for this photo" }).click();
  await viewer
    .getByRole("menuitem", { name: "Move to another field or location" })
    .click();
  await viewer.getByRole("combobox", { name: "Location" }).selectOption(idf.id);
  await viewer.getByRole("button", { name: "Move", exact: true }).click();
  await page.waitForTimeout(2000);
  const moved = await db.attachment.findUniqueOrThrow({
    where: { id: attachments[1].id },
    select: { deliverableItem: { select: { locationId: true, category: true } } },
  });
  check(
    "one photo moves to another location on its own",
    `${moved.deliverableItem?.category}@${moved.deliverableItem?.locationId === idf.id ? "IDF" : "elsewhere"}`,
    "PRE_INSTALL@IDF",
  );
  check(
    "and the one it was uploaded with stays put",
    (
      await db.attachment.findUniqueOrThrow({
        where: { id: attachments[0].id },
        select: { deliverableItem: { select: { locationId: true } } },
      })
    ).deliverableItem?.locationId,
    mdf.id,
  );
  check(
    "the window follows it and stays open",
    await viewer.getAttribute("aria-label"),
    "Pre-Install, IDF · photo 2 of 2",
  );

  await viewer.getByRole("button", { name: "Options for this photo" }).click();
  await viewer.getByRole("menuitem", { name: "Delete this photo" }).click();
  await page.waitForTimeout(2000);
  check(
    "one photo can be deleted on its own",
    await db.attachment.count({ where: { id: attachments[1].id } }),
    0,
  );
  check(
    "an upload left empty does not linger as an empty row",
    await db.deliverableItem.count({ where: { jobId, locationId: idf.id } }),
    0,
  );
  await viewer.getByRole("button", { name: "Close" }).click();
  await viewer.waitFor({ state: "detached", timeout: 5000 });

  // --- a room nobody mentioned ------------------------------------------------
  await page.getByRole("button", { name: "Add a location" }).first().click();
  const where = page.getByRole("textbox", { name: "Name of the location" });
  await where.fill("instal");
  check(
    "the list in settings is offered as you type",
    await page.getByRole("button", { name: "Install point", exact: true }).isVisible(),
    true,
  );
  check(
    "and what is already on the job is not",
    await page.getByRole("button", { name: "MDF", exact: true }).count(),
    0,
  );
  await where.press("Enter");
  await page.waitForTimeout(1500);
  const added = await db.jobLocation.findFirst({
    where: { jobId, name: "Install point" },
    select: { icon: true },
  });
  check("anyone on the job can add a location", Boolean(added), true);
  check("and it comes with the list's icon", added?.icon, "locate-fixed");
  check(
    "found on site, it owes no photos the planner did not ask for",
    (await banner.textContent())?.includes("Install point"),
    false,
  );
  check(
    "and the upload opens on it, since it was named to be photographed",
    await page.getByText("Adding to Pre-Install at Install point").isVisible(),
    true,
  );
  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  await page.getByRole("button", { name: "Add a location" }).first().click();
  await where.fill("mdf");
  check(
    "the same room twice is not offered, whatever the case",
    await page.getByText("“mdf” is already in Pre-Install.").isVisible(),
    true,
  );
  check(
    "nor can it be added by typing it",
    await page.getByRole("button", { name: /^Add “mdf”/ }).count(),
    0,
  );

  // A second IDF is not on the list, but it is still an IDF.
  await where.fill("IDF 2");
  await page.getByRole("button", { name: /^Add “IDF 2”/ }).click();
  await page.waitForTimeout(1500);
  check(
    "a room typed by hand is kept as typed, with its namesake's icon",
    (
      await db.jobLocation.findFirst({
        where: { jobId, name: "IDF 2" },
        select: { icon: true },
      })
    )?.icon,
    "network",
  );
  await db.jobLocation.deleteMany({ where: { jobId, name: "IDF 2" } });
  check(
    "a tech who is not the lead is not offered taking one away",
    await page.getByRole("button", { name: /Remove the location/ }).count(),
    0,
  );

  // --- photos from before the locations --------------------------------------
  await db.deliverableItem.updateMany({
    where: { jobId, locationId: mdf.id },
    data: { locationId: null },
  });
  await openDeliverables(page, url);
  await page.locator('[data-deliverable="PRE_INSTALL"] > button').first().click();
  await page.waitForTimeout(300);
  check(
    "a photo not at a location is shown, not lost",
    await page.getByText("Not at a location").isVisible(),
    true,
  );
  check(
    "but does not count towards any room — and the room found on site is not asked for",
    (await missingRequiredDeliverables(jobId))[0],
    "Pre-Install at MDF (0 of 2) · IDF (0 of 2)",
  );
  await db.deliverableItem.updateMany({
    where: { jobId, category: "PRE_INSTALL", locationId: null },
    data: { locationId: mdf.id },
  });

  // --- what the tech may not change ------------------------------------------
  await openDeliverables(page, url);
  await page.getByRole("button", { name: /Sections/ }).click();
  await page.getByRole("button", { name: "Set up Pre-Install" }).click();
  check(
    "a tech cannot change how many photos a section demands",
    await page.getByRole("button", { name: "One more photo" }).isDisabled(),
    true,
  );
  check(
    "or what the crew is told",
    await page.getByRole("textbox", { name: "Note for the crew" }).isDisabled(),
    true,
  );
  check(
    "or untick Photo so text stands in for the photos",
    await page
      .locator('[data-section="PRE_INSTALL"]')
      .getByRole("checkbox", { name: "Photo", exact: true })
      .isDisabled(),
    true,
  );
  check(
    "or plan the rooms and what each owes",
    await page.locator("[data-location-plan]").count(),
    0,
  );

  // --- the planner's side ----------------------------------------------------
  const bossContext = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  await bossContext.addCookies([
    { name: "authjs.session-token", value: await tokenFor(boss), url: BASE },
  ]);
  const planner = await bossContext.newPage();
  planner.on("dialog", (dialog) => dialog.accept());
  await openDeliverables(planner, url);
  await planner.locator('[data-deliverable="PRE_INSTALL"] > button').first().click();
  await planner.waitForTimeout(300);

  check(
    "a supervisor may take an empty location away",
    await planner
      .getByRole("button", { name: "Remove the location Install point" })
      .count() > 0,
    true,
  );
  check(
    "but not one with photos in it",
    await planner.getByRole("button", { name: "Remove the location MDF" }).count(),
    0,
  );

  // Opened, a section on a laptop leaves the others open too.
  await planner.getByRole("button", { name: "Add to Post Install" }).click();
  check(
    "a laptop keeps several sections open at once",
    await planner.locator(`#loc-PRE_INSTALL-${mdf.id}`).isVisible(),
    true,
  );
  await planner.getByRole("button", { name: "Cancel", exact: true }).click();

  await planner
    .getByRole("button", { name: "Remove the location Install point" })
    .first()
    .click();
  await planner.waitForTimeout(1500);
  check(
    "and it is gone",
    await db.jobLocation.count({ where: { jobId, name: "Install point" } }),
    0,
  );

  // The laptop window folds back with Esc.
  await planner
    .locator(`#loc-PRE_INSTALL-${mdf.id}`)
    .getByRole("button", { name: /Open photo 1 of/ })
    .click();
  const wideViewer = planner.getByRole("dialog");
  await wideViewer.waitFor({ timeout: 10_000 });
  check(
    "on a laptop the window has Back rather than a cross",
    await wideViewer.getByRole("button", { name: "Back to the job" }).isVisible(),
    true,
  );
  await planner.keyboard.press("Escape");
  await wideViewer.waitFor({ state: "detached", timeout: 5000 });
  check("and Esc folds it away", await wideViewer.count(), 0);

  await planner.getByRole("button", { name: /Sections/ }).click();
  await planner.getByRole("button", { name: "Set up Pre-Install" }).click();
  await planner.getByRole("button", { name: "One more photo" }).click();
  await planner.waitForTimeout(1500);
  check(
    "the planner sets how many photos it takes",
    (
      await db.deliverableRequirement.findFirstOrThrow({
        where: { jobId, category: "PRE_INSTALL" },
      })
    ).minPhotos,
    3,
  );

  const note = planner.getByRole("textbox", { name: "Note for the crew" });
  await note.fill(`Labels too. ${"x".repeat(150)}`);
  check("the note stops at 100 characters", (await note.inputValue()).length, 100);
  await note.press("Enter");
  await planner.waitForTimeout(1500);
  check(
    "and is saved when they are done with it",
    (
      await db.deliverableRequirement.findFirstOrThrow({
        where: { jobId, category: "PRE_INSTALL" },
      })
    ).note?.length,
    100,
  );

  await planner.getByRole("button", { name: "Done with Pre-Install" }).click();
  check(
    "folded, the section says what it asks for in a line",
    await planner
      .locator('[data-section="PRE_INSTALL"]')
      .getByText(/^3 photos at each of 2 locations · “Labels too\./)
      .isVisible(),
    true,
  );

  await planner.getByRole("button", { name: "Set up Issues" }).click();
  check(
    "an optional section has no count to set",
    await planner.getByRole("button", { name: "One more photo" }).count(),
    0,
  );

  // --- where each room is photographed, and how much -------------------------
  // Before the work and after it. A room first seen during Post-Install has no
  // "before"; one the crew found owes nothing until the planner says so; and a
  // room can ask for more, or fewer, than its field.
  const { jobDeliverableProgress } = await import("@/lib/job-deliverables");
  const roomsIn = async (key: string) =>
    (await jobDeliverableProgress(jobId))
      ?.find((field) => field.key === key)
      ?.locations?.map((location) => location.name)
      .join(",");
  await db.deliverableRequirement.updateMany({
    where: { jobId, category: "POST_INSTALL" },
    data: { perLocation: true, minPhotos: 1 },
  });
  await openDeliverables(page, url);
  const postSection = page.locator('[data-deliverable="POST_INSTALL"]');
  await page.locator('[data-deliverable="POST_INSTALL"] > button').first().click();
  await page.waitForTimeout(300);
  await postSection.getByRole("button", { name: "Add a location" }).click();
  await page.getByRole("textbox", { name: "Name of the location" }).fill("Closet");
  await page.getByRole("button", { name: /^Add “Closet”/ }).click();
  await page.waitForTimeout(1500);
  const closet = await db.jobLocation.findFirstOrThrow({
    where: { jobId, name: "Closet" },
    select: { id: true, fields: true, counted: true },
  });
  check(
    "a room found during Post-Install is photographed there alone",
    closet.fields.join(),
    "POST_INSTALL",
  );
  check("and owes no photos — nobody planned it", closet.counted, false);
  check("Post-Install has it", await roomsIn("POST_INSTALL"), "MDF,IDF,Closet");
  check("Pre-Install does not", await roomsIn("PRE_INSTALL"), "MDF,IDF");
  check(
    "the upload opens on it there",
    await page.getByText("Adding to Post Install at Closet").isVisible(),
    true,
  );
  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  // The same room found again from Pre-Install: it was there before the work
  // after all, and is photographed before and after — one room, not two.
  const preSection = page.locator('[data-deliverable="PRE_INSTALL"]');
  await page.locator('[data-deliverable="PRE_INSTALL"] > button').first().click();
  await page.waitForTimeout(300);
  await preSection.getByRole("button", { name: "Add a location" }).click();
  await page.getByRole("textbox", { name: "Name of the location" }).fill("Closet");
  check(
    "in Pre-Install, a room the job has only after the work is still offered",
    await page.getByRole("button", { name: /^Add “Closet”/ }).isVisible(),
    true,
  );
  await page.getByRole("button", { name: /^Add “Closet”/ }).click();
  await page.waitForTimeout(1500);
  check(
    "and joins Pre-Install, so it is in both",
    `${await db.jobLocation.count({ where: { jobId, name: "Closet" } })} ${(
      await db.jobLocation.findUniqueOrThrow({ where: { id: closet.id } })
    ).fields.join()}`,
    "1 POST_INSTALL,PRE_INSTALL",
  );
  check("Pre-Install has it now", await roomsIn("PRE_INSTALL"), "MDF,IDF,Closet");

  // The planner's side: the rooms in the job's settings.
  await openDeliverables(planner, url);
  await planner.getByRole("button", { name: /Sections/ }).click();
  const plan = planner.locator("[data-location-plan]");
  const closetRow = plan.locator('[data-location="Closet"]');
  check(
    "the planner sees which rooms were found on site",
    await closetRow.getByText("Added on site — no count of its own").isVisible(),
    true,
  );
  const closetPost = closetRow.getByRole("spinbutton", {
    name: "Photos needed in Post Install at Closet",
  });
  check(
    "a found room's count is 0 until one is set",
    await closetPost.getAttribute("placeholder"),
    "0",
  );
  await closetPost.fill("3");
  await closetPost.press("Enter");
  await planner.waitForTimeout(1500);
  check(
    "a room can be given a count of its own",
    JSON.stringify(
      (await db.jobLocation.findUniqueOrThrow({ where: { id: closet.id } })).minPhotos,
    ),
    '{"POST_INSTALL":3}',
  );
  check(
    "and checkout asks for that many there",
    (await jobDeliverableProgress(jobId))
      ?.find((field) => field.key === "POST_INSTALL")
      ?.locations?.map((location) => `${location.name}:${location.needed}`)
      .join(" "),
    "MDF:1 IDF:1 Closet:3",
  );

  const mdfRow = plan.locator('[data-location="MDF"]');
  check(
    "a planned room shows the field's count",
    await mdfRow
      .getByRole("spinbutton", { name: "Photos needed in Pre-Install at MDF" })
      .getAttribute("placeholder"),
    "3",
  );
  await mdfRow.getByRole("checkbox", { name: "Photograph MDF in Pre-Install" }).click();
  await planner.waitForTimeout(1500);
  check(
    "a field a room has photos in is not taken from it",
    await planner
      .getByText("MDF has photos or notes in Pre-Install. Move or delete them first.")
      .isVisible(),
    true,
  );
  check(
    "and it stays",
    (await db.jobLocation.findUniqueOrThrow({ where: { id: mdf.id } })).fields.length,
    0,
  );
  await plan
    .locator('[data-location="IDF"]')
    .getByRole("checkbox", { name: "Photograph IDF in Pre-Install" })
    .click();
  await planner.waitForTimeout(1500);
  check(
    "an empty one can be photographed after the work alone",
    (await db.jobLocation.findUniqueOrThrow({ where: { id: idf.id } })).fields.join(),
    "POST_INSTALL",
  );
  check("and Pre-Install stops asking for it", await roomsIn("PRE_INSTALL"), "MDF,Closet");

  // A tech who finds it in Pre-Install after all adds it there — and only
  // there: it is not put back into every field, and owes Pre-Install nothing
  // the planner did not ask for.
  await openDeliverables(page, url);
  await page.locator('[data-deliverable="PRE_INSTALL"] > button').first().click();
  await page.waitForTimeout(300);
  await preSection.getByRole("button", { name: "Add a location" }).click();
  await page.getByRole("textbox", { name: "Name of the location" }).fill("IDF");
  await page.getByRole("button", { name: "IDF", exact: true }).click();
  await page.waitForTimeout(1500);
  const idfAfter = await db.jobLocation.findUniqueOrThrow({
    where: { id: idf.id },
    select: { fields: true, minPhotos: true },
  });
  check(
    "a planned room a tech finds in another field joins it, owing it nothing",
    `${idfAfter.fields.join()} ${JSON.stringify(idfAfter.minPhotos)}`,
    'POST_INSTALL,PRE_INSTALL {"PRE_INSTALL":0}',
  );
  const mdfPre = mdfRow.getByRole("spinbutton", { name: "Photos needed in Pre-Install at MDF" });
  await mdfPre.fill("0");
  await mdfPre.press("Tab");
  await planner.waitForTimeout(1500);
  check(
    "0 lets a planned room go without photos in a field",
    (await missingRequiredDeliverables(jobId)).some((gap) => gap.includes("Pre-Install")),
    false,
  );

  await plan.getByRole("button", { name: "Add a location" }).click();
  await plan.getByRole("textbox", { name: "Name of the location" }).fill("Verify room 7");
  await plan.getByRole("button", { name: /^Add “Verify room 7”/ }).click();
  await planner.waitForTimeout(1500);
  const roomSeven = await db.jobLocation.findFirst({
    where: { jobId, name: "Verify room 7" },
    select: { fields: true, counted: true },
  });
  check(
    "a room named in the job's settings is planned: in every field, and counted",
    `${roomSeven?.fields.length} ${roomSeven?.counted}`,
    "0 true",
  );
  check(
    "so checkout asks for it at once",
    (await missingRequiredDeliverables(jobId)).some((gap) => gap.includes("Verify room 7")),
    true,
  );

  // As the rest of the suite expects the rooms: two, photographed everywhere,
  // Post-Install counted as a whole.
  await db.jobLocation.deleteMany({
    where: { jobId, id: { notIn: [mdf.id, idf.id] } },
  });
  await db.jobLocation.updateMany({
    where: { jobId },
    data: { fields: [], counted: true, minPhotos: {} },
  });
  await db.deliverableRequirement.updateMany({
    where: { jobId, category: "POST_INSTALL" },
    data: { perLocation: false },
  });

  // --- the dictionary in settings ----------------------------------------------
  await planner.goto(`${BASE}/settings/company`, { waitUntil: "load" });
  check(
    "the locations are listed in company settings",
    await planner.getByRole("heading", { name: "Locations" }).isVisible(),
    true,
  );
  check(
    "each with the icon it is drawn with",
    await planner
      .getByRole("button", { name: "Icon for MDF: Server rack. Change it" })
      .isVisible(),
    true,
  );

  const newName = planner.getByRole("textbox", { name: "A location to add" });
  await newName.fill("Kitchen");
  check(
    "a new name suggests its icon from its words",
    await planner
      .getByRole("button", { name: "Icon for the new location: Kitchen. Change it" })
      .isVisible(),
    true,
  );
  await newName.press("Enter");
  await planner.waitForTimeout(1500);
  check(
    "and is added with it",
    (await db.knownLocation.findUnique({ where: { label: "Kitchen" } }))?.icon,
    "chef-hat",
  );

  await newName.fill("mdf");
  await newName.press("Enter");
  await planner.waitForTimeout(1200);
  check(
    "the same room twice is refused, whatever the case",
    await planner.getByText("That one is already on the list.").isVisible(),
    true,
  );
  await newName.fill("");

  await planner
    .getByRole("button", { name: "Icon for MDF: Server rack. Change it" })
    .click();
  await planner.getByRole("textbox", { name: "Search icons" }).fill("router");
  await planner
    .getByRole("dialog", { name: "Pick an icon for MDF" })
    .getByRole("button", { name: "Router", exact: true })
    .click();
  await planner.waitForTimeout(1500);
  check(
    "an icon is changed by searching for it",
    (await db.knownLocation.findUnique({ where: { label: "MDF" } }))?.icon,
    "router",
  );
  check(
    "and nothing already on a job is rewritten",
    await db.jobLocation.count({ where: { icon: "router" } }),
    0,
  );
  await db.knownLocation.update({
    where: { label: "MDF" },
    data: { icon: "server" },
  });

  await planner.getByRole("button", { name: "Options for Kitchen" }).click();
  await planner.getByRole("menuitem", { name: "Take off the list" }).click();
  await planner.waitForTimeout(1500);
  check(
    "one is taken off the list rather than deleted",
    (await db.knownLocation.findUnique({ where: { label: "Kitchen" } }))?.active,
    false,
  );
  await db.knownLocation.deleteMany({ where: { label: "Kitchen" } });

  // --- the project's sheet is the one its jobs follow ------------------------
  // A project nothing has been saved on answers with the defaults. Its
  // settings used to show every section off all the same, and saving one
  // section there turned the rest off for every job under it.
  const projectId = (
    await db.job.findUniqueOrThrow({ where: { id: jobId }, select: { projectId: true } })
  ).projectId!;
  await db.deliverableRequirement.deleteMany({ where: { projectId, jobId: null } });
  await planner.goto(`${BASE}/projects/${projectId}/settings`, { waitUntil: "load" });
  check(
    "a project with nothing saved shows the sections its jobs actually ask for",
    await planner
      .locator('[data-section="PRE_INSTALL"]')
      .getByRole("checkbox", { name: "Pre-Install" })
      .isChecked(),
    true,
  );
  await planner
    .locator('[data-section="ISSUES"]')
    .getByRole("checkbox", { name: "Issues" })
    .check({ force: true });
  await planner.waitForTimeout(1500);
  const projectRules = await db.deliverableRequirement.findMany({
    where: { projectId, jobId: null, enabled: true },
    select: { category: true },
  });
  check(
    "and switching one on there keeps the ones it already asked for",
    projectRules.map((rule) => rule.category).sort().join(","),
    "ISSUES,POST_INSTALL,PRE_INSTALL",
  );
  await db.deliverableRequirement.deleteMany({ where: { projectId, jobId: null } });

  // --- a job follows its project until it is changed for itself --------------
  await db.deliverableRequirement.deleteMany({ where: { jobId } });
  await planner.goto(`${BASE}/projects/${projectId}/settings`, { waitUntil: "load" });
  await planner.getByRole("button", { name: "Set up Post Install" }).click();
  await planner.getByRole("button", { name: "One more photo" }).click();
  await planner.waitForTimeout(1500);
  check(
    "a change on the project reaches a job that follows it",
    (await missingRequiredDeliverables(jobId)).includes("Post Install (0 of 2)"),
    true,
  );

  await openDeliverables(planner, url);
  await planner.getByRole("button", { name: /Sections/ }).click();
  check(
    "and the job says whose sections it is following",
    await planner.getByText(/Following the project’s sections/).isVisible(),
    true,
  );
  await planner
    .locator('[data-section="ISSUES"]')
    .getByRole("checkbox", { name: "Issues" })
    .check({ force: true });
  await planner.waitForTimeout(1500);
  check(
    "changing a section on the job gives it its own copy",
    await planner.getByText(/Changed for this job/).isVisible(),
    true,
  );
  await db.deliverableRequirement.updateMany({
    where: { projectId, jobId: null, category: "POST_INSTALL" },
    data: { minPhotos: 3 },
  });
  check(
    "which the project's later edits do not reach",
    (await missingRequiredDeliverables(jobId)).includes("Post Install (0 of 2)"),
    true,
  );

  await planner.getByRole("button", { name: "Use the project’s again" }).click();
  await planner.waitForTimeout(1500);
  check(
    "until it is handed back to the project",
    await db.deliverableRequirement.count({ where: { jobId } }),
    0,
  );
  check(
    "and asks for what the project asks for now",
    (await missingRequiredDeliverables(jobId)).includes("Post Install (0 of 3)"),
    true,
  );
  await db.deliverableRequirement.deleteMany({ where: { projectId, jobId: null } });

  // --- moving photos about, and the export following them -------------------
  // Field, location, photo: Pre-Install/MDF/001.jpg. After every move the
  // archive is opened and each numbered file traced back to the photo it is,
  // through the photo index written beside them.
  await db.deliverableItem.deleteMany({ where: { jobId } });
  await db.deliverableRequirement.deleteMany({ where: { jobId } });
  await db.deliverableRequirement.createMany({
    data: [
      { jobId, category: "PRE_INSTALL", enabled: true, required: true, requiresPhoto: true, perLocation: true, order: 0 },
      { jobId, category: "POST_INSTALL", enabled: true, required: true, requiresPhoto: true, order: 1 },
    ],
  });
  await db.job.update({ where: { id: jobId }, data: { deliverablesOwn: true } });

  const { storeFile } = await import("@/lib/storage");
  async function seedUpload(
    category: "PRE_INSTALL" | "POST_INSTALL",
    locationId: string | null,
    shots: { name: string; colour: string; minute: number }[],
  ) {
    const item = await db.deliverableItem.create({
      data: { jobId, assignmentId: assignment.id, category, locationId },
    });
    for (const shot of shots) {
      const stored = await storeFile(jobId, await photo(shot.colour), "image/jpeg");
      await db.attachment.create({
        data: {
          storagePath: stored.storagePath,
          originalName: shot.name,
          mimeType: "image/jpeg",
          sizeBytes: stored.sizeBytes,
          uploadedById: tech.id,
          deliverableItemId: item.id,
          createdAt: new Date(Date.UTC(2026, 6, 28, 15, shot.minute)),
        },
      });
    }
  }
  await seedUpload("PRE_INSTALL", mdf.id, [
    { name: "p1.jpg", colour: "#203040", minute: 1 },
    { name: "p2.jpg", colour: "#304050", minute: 2 },
  ]);
  await seedUpload("PRE_INSTALL", idf.id, [{ name: "p3.jpg", colour: "#405060", minute: 3 }]);
  await seedUpload("POST_INSTALL", null, [{ name: "p4.jpg", colour: "#506070", minute: 4 }]);

  /** "path=photo" for every deliverable photo in the archive, as it is now. */
  async function exported(): Promise<string> {
    const zip = await planner.request.get(`${BASE}/api/jobs/${jobId}/export/zip`);
    const entries = zipEntries(await zip.body());
    const index = (entries.get("Photo index.csv")?.toString("utf8") ?? "")
      .split("\r\n")
      .slice(1)
      .filter(Boolean)
      .map((row) => row.split(","));
    const lines = index.map((row) => {
      const path = row[0];
      // The index says which file is which; the file has to be there too.
      return `${path}=${row[row.length - 1]}${entries.has(path) ? "" : " (MISSING)"}`;
    });
    return lines.sort().join(" ");
  }

  async function emptyUploads(): Promise<number> {
    return db.deliverableItem.count({
      where: { jobId, attachments: { none: {} }, OR: [{ textValue: null }, { textValue: "" }] },
    });
  }

  async function movePhoto(name: string, field: string, locationId?: string) {
    await openDeliverables(planner, url);
    // A laptop keeps several open: open every folded one, one at a time, as
    // the list of folded ones shrinks with each.
    const folded = planner.locator('[data-deliverable] > button[aria-expanded="false"]');
    while ((await folded.count()) > 0) {
      await folded.first().click();
      await planner.waitForTimeout(100);
    }
    await planner.locator(`button:has(img[alt="${name}"])`).first().click();
    const window = planner.getByRole("dialog");
    await window.getByRole("button", { name: "Options for this photo" }).click();
    await window
      .getByRole("menuitem", { name: "Move to another field or location" })
      .click();
    await window.getByRole("combobox", { name: "Field" }).selectOption(field);
    if (locationId) {
      await window.getByRole("combobox", { name: "Location" }).selectOption(locationId);
    }
    await window.getByRole("button", { name: "Move", exact: true }).click();
    await planner.waitForTimeout(1500);
    await planner.keyboard.press("Escape");
  }

  check(
    "the export is field, location, then a numbered photo",
    await exported(),
    "Post Install/001.jpg=p4.jpg Pre-Install/IDF/001.jpg=p3.jpg Pre-Install/MDF/001.jpg=p1.jpg Pre-Install/MDF/002.jpg=p2.jpg",
  );
  check(
    "with no folder per tech any more",
    [...zipEntries(
      await (await planner.request.get(`${BASE}/api/jobs/${jobId}/export/zip`)).body(),
    ).keys()].some(
      // Their signature is theirs to have a name on; the photos are not.
      (name) => name.includes("Terry Tech") && !name.startsWith("Signatures/"),
    ),
    false,
  );

  await movePhoto("p2.jpg", "PRE_INSTALL", idf.id);
  check(
    "moved to another location, it is numbered there by when it was taken",
    await exported(),
    "Post Install/001.jpg=p4.jpg Pre-Install/IDF/001.jpg=p2.jpg Pre-Install/IDF/002.jpg=p3.jpg Pre-Install/MDF/001.jpg=p1.jpg",
  );

  await movePhoto("p3.jpg", "POST_INSTALL");
  check(
    "moved to a field with no locations, it loses its location folder",
    await exported(),
    "Post Install/001.jpg=p3.jpg Post Install/002.jpg=p4.jpg Pre-Install/IDF/001.jpg=p2.jpg Pre-Install/MDF/001.jpg=p1.jpg",
  );
  check(
    "and in the database too",
    (
      await db.attachment.findFirstOrThrow({
        where: { originalName: "p3.jpg", deliverableItem: { jobId } },
        select: { deliverableItem: { select: { category: true, locationId: true } } },
      })
    ).deliverableItem?.locationId ?? "none",
    "none",
  );

  await movePhoto("p3.jpg", "PRE_INSTALL", mdf.id);
  check(
    "moved back, it takes its place among the others",
    await exported(),
    "Post Install/001.jpg=p4.jpg Pre-Install/IDF/001.jpg=p2.jpg Pre-Install/MDF/001.jpg=p1.jpg Pre-Install/MDF/002.jpg=p3.jpg",
  );

  await movePhoto("p1.jpg", "PRE_INSTALL", idf.id);
  check(
    "and after the last of a location's photos moves, the numbers close up",
    await exported(),
    "Post Install/001.jpg=p4.jpg Pre-Install/IDF/001.jpg=p1.jpg Pre-Install/IDF/002.jpg=p2.jpg Pre-Install/MDF/001.jpg=p3.jpg",
  );
  check("no upload is left empty after all that", await emptyUploads(), 0);
  check(
    "and every photo is still on disk",
    (
      await Promise.all(
        (
          await db.attachment.findMany({
            where: { deliverableItem: { jobId } },
            select: { storagePath: true },
          })
        ).map(async (one) => (await import("@/lib/storage")).fileExists(one.storagePath)),
      )
    ).every(Boolean),
    true,
  );

  // --- the paying company's paperwork goes in the archive too ---------------
  // Their work order and the sign-off sheet, blank and filled, each in a
  // folder of its own beside our photos — the archive is the whole job.
  const { safeSegment } = await import("@/lib/exports/photo-layout");
  const { deleteFile } = await import("@/lib/storage");
  const { client } = await db.job.findUniqueOrThrow({
    where: { id: jobId },
    select: { client: { select: { name: true } } },
  });
  const theirFolder = safeSegment(`${client.name} WO`);
  const pdf = (label: string) => Buffer.from(`%PDF-1.4\n% ${label}\n%%EOF\n`);
  const seededDocuments: { id: string; storagePath: string }[] = [];
  async function seedDocument(
    kind: "CLIENT_WORK_ORDER" | "SIGN_OFF",
    originalName: string,
    mimeType: string,
    bytes: Buffer,
    generated = false,
  ) {
    const stored = await storeFile(jobId, bytes, mimeType);
    seededDocuments.push(
      await db.attachment.create({
        data: {
          storagePath: stored.storagePath,
          originalName,
          mimeType,
          sizeBytes: stored.sizeBytes,
          uploadedById: tech.id,
          jobDocumentId: jobId,
          jobDocumentKind: kind,
          generated,
        },
        select: { id: true, storagePath: true },
      }),
    );
  }
  await seedDocument("CLIENT_WORK_ORDER", "WO-55120.pdf", "application/pdf", pdf("work order"));
  await seedDocument("CLIENT_WORK_ORDER", "scan.png", "image/jpeg", await photo("#708090"));
  await seedDocument("SIGN_OFF", "Sign-off.pdf", "application/pdf", pdf("blank"));
  await seedDocument("SIGN_OFF", "Sign-off — filled.pdf", "application/pdf", pdf("filled"), true);

  const withDocuments = zipEntries(
    await (await planner.request.get(`${BASE}/api/jobs/${jobId}/export/zip`)).body(),
  );
  check(
    "their work order is in the archive, under their name",
    withDocuments.get(`${theirFolder}/WO-55120.pdf`)?.toString("utf8").includes("work order") ?? false,
    true,
  );
  check(
    "a photographed one carries the extension its bytes are",
    withDocuments.has(`${theirFolder}/scan.jpg`),
    true,
  );
  check(
    "and the sign-off sheet, blank and filled",
    [
      withDocuments.get("Sign-off sheets/Sign-off.pdf")?.toString("utf8").includes("blank"),
      withDocuments.get("Sign-off sheets/Sign-off — filled.pdf")?.toString("utf8").includes("filled"),
    ],
    [true, true],
  );
  check(
    "every document on the job is there",
    [...withDocuments.keys()].filter(
      (name) => name.startsWith(`${theirFolder}/`) || name.startsWith("Sign-off sheets/"),
    ).length,
    await db.attachment.count({ where: { jobDocumentId: jobId } }),
  );
  check("and nothing had to be left out", withDocuments.has("MISSING FILES.txt"), false);
  check(
    "the photos are where they were",
    await exported(),
    "Post Install/001.jpg=p4.jpg Pre-Install/IDF/001.jpg=p1.jpg Pre-Install/IDF/002.jpg=p2.jpg Pre-Install/MDF/001.jpg=p3.jpg",
  );

  // --- a label on one photo --------------------------------------------------
  // Written on the photo above its stamp, its name in the export, and offered
  // again for the job's next photos.
  const { fileExists } = await import("@/lib/storage");
  const attachmentNamed = (name: string) =>
    db.attachment.findFirstOrThrow({
      where: { originalName: name, deliverableItem: { jobId } },
      select: { id: true, storagePath: true, basePath: true, label: true, stampText: true },
    });
  async function photoMenu(alt: string) {
    await openDeliverables(planner, url);
    const folded = planner.locator('[data-deliverable] > button[aria-expanded="false"]');
    while ((await folded.count()) > 0) {
      await folded.first().click();
      await planner.waitForTimeout(100);
    }
    await planner.locator(`button:has(img[alt="${alt}"])`).first().click();
    const window = planner.getByRole("dialog");
    await window.getByRole("button", { name: "Options for this photo" }).click();
    return window;
  }
  async function writeLabel(alt: string, item: string, label: string | "pick") {
    const window = await photoMenu(alt);
    await window.getByRole("menuitem", { name: item }).click();
    if (label === "pick") {
      await window.getByRole("button", { name: "Use the label Damaged port" }).click();
    } else {
      await window.getByRole("textbox").fill(label);
    }
    await window.getByRole("button", { name: "Save label" }).click();
    await planner.waitForTimeout(2000);
    return window;
  }

  const p1Before = await attachmentNamed("p1.jpg");
  const labelWindow = await writeLabel("p1.jpg", "Add a label", "Damaged port");
  const p1 = await attachmentNamed("p1.jpg");
  check("a photo takes a label", p1.label, "Damaged port");
  check(
    "drawn on a copy, with the photo before it kept",
    `${p1.storagePath !== p1Before.storagePath} ${p1.basePath === p1Before.storagePath}`,
    "true true",
  );
  check(
    "the window says what it is",
    await labelWindow.getByText("Damaged port", { exact: true }).first().isVisible(),
    true,
  );
  await planner.keyboard.press("Escape");

  const pickWindow = await photoMenu("p2.jpg");
  await pickWindow.getByRole("menuitem", { name: "Add a label" }).click();
  check(
    "the job's labels are offered for its next photo",
    await pickWindow.getByRole("button", { name: "Use the label Damaged port" }).isVisible(),
    true,
  );
  await planner.keyboard.press("Escape");
  await writeLabel("p2.jpg", "Add a label", "pick");
  check("one tap gives it the same", (await attachmentNamed("p2.jpg")).label, "Damaged port");
  check(
    "the export names them by it, the second told apart from the first",
    await exported(),
    "Post Install/001.jpg=p4.jpg Pre-Install/IDF/Damaged port (2).jpg=p2.jpg Pre-Install/IDF/Damaged port.jpg=p1.jpg Pre-Install/MDF/001.jpg=p3.jpg",
  );

  const p3Before = await attachmentNamed("p3.jpg");
  await writeLabel("p3.jpg", "Add a label", "Panel");
  const p3Panel = await attachmentNamed("p3.jpg");
  await writeLabel("Panel", "Change the label", "Old switch");
  const p3Switch = await attachmentNamed("p3.jpg");
  check(
    "a label changed is drawn again on the photo before the first",
    `${p3Switch.label} ${p3Switch.basePath === p3Before.storagePath}`,
    "Old switch true",
  );
  check(
    "and the drawing it replaces is gone from disk",
    await fileExists(p3Panel.storagePath),
    false,
  );
  const labelledDownload = await planner.request.get(
    `${BASE}/api/files/${p3Switch.id}?download=1`,
  );
  check(
    "a labelled photo downloads under its label",
    labelledDownload.headers()["content-disposition"]?.includes("filename*=UTF-8''Old%20switch.jpg"),
    true,
  );
  const offWindow = await photoMenu("Old switch");
  await offWindow.getByRole("menuitem", { name: "Change the label" }).click();
  await offWindow.getByRole("button", { name: "Take the label off" }).click();
  await planner.waitForTimeout(2000);
  const p3After = await attachmentNamed("p3.jpg");
  check(
    "taken off, the photo is back as it was",
    `${p3After.label} ${p3After.storagePath === p3Before.storagePath} ${p3After.basePath}`,
    "null true null",
  );
  check("with no drawing left behind", await fileExists(p3Switch.storagePath), false);
  await planner.keyboard.press("Escape");

  // Given when the photos go up: written on each as it is stamped.
  await openDeliverables(page, url);
  await page.locator('[data-deliverable="POST_INSTALL"] > button').first().click();
  await page.getByRole("button", { name: "Add photos to Post Install" }).click();
  check(
    "the upload offers the job's labels too",
    await page.getByRole("button", { name: "Use the label Damaged port" }).isVisible(),
    true,
  );
  await page
    .locator('input[type="file"]:not([id^="doc-"])')
    .first()
    .setInputFiles({ name: "labelled.jpg", mimeType: "image/jpeg", buffer: await photo("#607080") });
  await page.getByLabel("Label (optional)").fill("Patch panel");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByText("Adding to Post Install").waitFor({ state: "detached", timeout: 60_000 });
  const uploaded = await attachmentNamed("labelled.jpg");
  check(
    "a label given with the upload is on the photo, with the photo before it kept",
    `${uploaded.label} ${Boolean(uploaded.basePath)} ${Boolean(uploaded.stampText)}`,
    "Patch panel true true",
  );

  for (const document of seededDocuments) {
    await db.attachment.delete({ where: { id: document.id } });
    await deleteFile(document.storagePath);
  }

  await browser.close();

  // Back to following the project, as the fixtures left it: the job page
  // suite expects its sections plain.
  await db.attachment.deleteMany({ where: { deliverableItem: { jobId } } });
  await db.deliverableItem.deleteMany({ where: { jobId } });
  await db.jobLocation.deleteMany({ where: { jobId } });
  await db.deliverableRequirement.deleteMany({ where: { jobId } });
  await db.jobAssignment.update({
    where: { id: assignment.id },
    data: { isLead: assignment.isLead },
  });
  await db.job.update({
    where: { id: jobId },
    data: {
      lifecycle: assignment.job.lifecycle,
      deliverablesFrozenAt: assignment.job.deliverablesFrozenAt,
      deliverablesOwn: false,
    },
  });
  await db.$disconnect();

  console.log(
    `\n${failures === 0 ? "ALL DELIVERABLE CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});
