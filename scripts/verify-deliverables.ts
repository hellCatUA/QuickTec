import "dotenv/config";
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

/** The paths inside a zip, read from its central directory. */
function zipEntryNames(zip: Buffer): string[] {
  const names: string[] = [];
  for (let at = 0; at + 46 <= zip.length; at++) {
    if (zip.readUInt32LE(at) !== 0x02014b50) continue;
    const nameLength = zip.readUInt16LE(at + 28);
    const extraLength = zip.readUInt16LE(at + 30);
    const commentLength = zip.readUInt16LE(at + 32);
    names.push(zip.subarray(at + 46, at + 46 + nameLength).toString("utf8"));
    at += 45 + nameLength + extraLength + commentLength;
  }
  return names;
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
    select: { id: true, jobId: true, isLead: true },
  });
  const jobId = assignment.jobId;
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
    "full size is the original",
    await viewer.getByRole("link", { name: "Full size" }).getAttribute("href"),
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
    "and it is asked for at once",
    (await banner.textContent())?.includes("Install point"),
    true,
  );

  await page.getByRole("button", { name: "Add a location" }).first().click();
  await where.fill("mdf");
  check(
    "the same room twice is not offered, whatever the case",
    await page.getByText("“mdf” is already on this job.").isVisible(),
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
    "but does not count towards any room",
    (await missingRequiredDeliverables(jobId))[0],
    "Pre-Install at all 3 locations",
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

  // The archive keeps each room's photos together.
  const zip = await planner.request.get(`${BASE}/api/jobs/${jobId}/export/zip`);
  check(
    "the export files photos by section, then location",
    zipEntryNames(await zip.body()).some((name) =>
      name.startsWith("Pre-Install/MDF/"),
    ),
    true,
  );

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
