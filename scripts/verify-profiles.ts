import "dotenv/config";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { encode } from "next-auth/jwt";
import { chromium, type Browser, type Page } from "playwright";
import sharp from "sharp";
import { importNextcloudPicture } from "@/lib/avatar";
import { db } from "@/lib/db";
import { formSource } from "@/lib/forms/catalogue";
import {
  audienceFor,
  contactCard,
  loadContactCards,
  loadProfile,
  phonesLine,
  preferredPhoneLine,
  seesPayOf,
} from "@/lib/profile";
import { stateText, zoneLine, zonePickedByHand } from "@/lib/profile-format";
import {
  preferredPhoneChange,
  profileHistory,
  recordProfileEvents,
  statesChange,
  type HistoryField,
} from "@/lib/profile-history";
import {
  effectivePreferred,
  levelFor,
  levelsAllowed,
  preferableKinds,
  privacySettings,
  yearsLabel,
} from "@/lib/profile-privacy";
import { answerProfileRequest, fileProfileRequest } from "@/lib/profile-requests";
import type { SessionUser } from "@/lib/session";
import { deleteFile } from "@/lib/storage";

/**
 * Profiles: who sees which line, how a legal name and a picture are asked for
 * and answered, the warning another manager gets, and the company's own
 * levels under Settings → Roles & permissions → Privacy.
 *
 * The rules are checked directly; the pages through a real browser against
 * the app on BASE_URL with the same AUTH_SECRET. Rewrites the fixture people's
 * profiles — a development database only.
 */

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
let failures = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}\n      got ${actual}${ok ? "" : `  want ${expected}`}`);
}

async function tokenFor(email: string) {
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  return encode({
    token: { sub: user.nextcloudSub ?? user.id, userId: user.id },
    secret: process.env.AUTH_SECRET!,
    salt: "authjs.session-token",
    maxAge: 3600,
  });
}

async function pageAs(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addCookies([
    {
      name: "authjs.session-token",
      value: await tokenFor(email),
      url: BASE,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  return context.newPage();
}

/** Builds the session a signed-in person would have, enough for the audience rules. */
async function sessionOf(email: string): Promise<SessionUser> {
  const user = await db.user.findUniqueOrThrow({
    where: { email },
    select: {
      id: true,
      email: true,
      name: true,
      baseRole: true,
      timeZone: true,
      directSupervisorId: true,
      projectMemberships: {
        where: { role: { in: ["PROJECT_MANAGER", "SUPERVISOR"] } },
        select: { projectId: true },
      },
      managedProjects: { select: { id: true } },
    },
  });
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: null,
    avatarPath: null,
    baseRole: user.baseRole,
    timeZone: user.timeZone,
    mustChangePassword: false,
    directSupervisorId: user.directSupervisorId,
    grants: new Map(),
    projectGrants: new Map(),
    scopedProjectIds: Array.from(
      new Set([
        ...user.projectMemberships.map((m) => m.projectId),
        ...user.managedProjects.map((p) => p.id),
      ]),
    ),
  };
}

async function jpeg(color: string): Promise<Buffer> {
  return sharp({ create: { width: 64, height: 64, channels: 3, background: color } })
    .jpeg()
    .toBuffer();
}

async function rules() {
  console.log("\n— the levels —");
  const defaults = privacySettings([]);
  const phones = { personal: "559-555-0142", work: "559-555-0110", voip: "559-555-0199" };

  check("a personal phone cannot be preferred while there is a work phone", preferableKinds(phones).join(","), "WORK,VOIP");
  check(
    "it can once the work phone is gone",
    preferableKinds({ ...phones, work: null }).join(","),
    "PERSONAL,VOIP",
  );
  check("nothing chosen falls back to the work phone", effectivePreferred(null, phones), "WORK");
  check("a choice that is no longer allowed falls back too", effectivePreferred("PERSONAL", phones), "WORK");
  check(
    "but never to the personal phone — nobody chose to share it",
    effectivePreferred(null, { personal: phones.personal, work: null, voip: null }),
    null,
  );
  check(
    "not even when a manager takes the work phone away",
    effectivePreferred("WORK", { personal: phones.personal, work: null, voip: null }),
    null,
  );

  const subject = (preferredPhone: "PERSONAL" | "WORK" | "VOIP" | null, avatarVisibility: "FEDERATED" | "PUBLIC" = "PUBLIC") => ({
    preferredPhone,
    phones: { ...phones, work: preferredPhone === "PERSONAL" ? null : phones.work },
    avatarVisibility,
  });
  check("the personal phone is Restricted", levelFor("personalPhone", defaults, subject("WORK")), "RESTRICTED");
  check("and Public while it is the preferred one", levelFor("personalPhone", defaults, subject("PERSONAL")), "PUBLIC");
  check(
    "unless the company says otherwise",
    levelFor(
      "personalPhone",
      privacySettings([{ field: "personalPhone", level: "RESTRICTED", allowChoice: false }]),
      subject("PERSONAL"),
    ),
    "RESTRICTED",
  );
  check(
    "and then the preferred phone is kept off the paperwork with it",
    levelFor(
      "preferredPhone",
      privacySettings([{ field: "personalPhone", level: "RESTRICTED", allowChoice: false }]),
      subject("PERSONAL"),
    ),
    "RESTRICTED",
  );
  check("the picture is Public", levelFor("picture", defaults, subject("WORK")), "PUBLIC");
  check("until its owner keeps it to the company", levelFor("picture", defaults, subject("WORK", "FEDERATED")), "FEDERATED");
  check(
    "which the company can refuse them",
    levelFor(
      "picture",
      privacySettings([{ field: "picture", level: "PUBLIC", allowChoice: false }]),
      subject("WORK", "FEDERATED"),
    ),
    "PUBLIC",
  );
  check(
    "and a choice never opens it past the company's level",
    levelFor(
      "picture",
      privacySettings([{ field: "picture", level: "FEDERATED", allowChoice: true }]),
      subject("WORK", "PUBLIC"),
    ),
    "FEDERATED",
  );
  check(
    "a name the whole app shows cannot be kept narrower than Public",
    privacySettings([{ field: "name", level: "RESTRICTED", allowChoice: null }]).name.level,
    "PUBLIC",
  );
  check(
    "a stored level below a field's floor is raised to the floor, not to the default",
    privacySettings([{ field: "email", level: "RESTRICTED", allowChoice: null }]).email.level,
    "FEDERATED",
  );
  check("and the settings offer only what is allowed", levelsAllowed("role").join(","), "FEDERATED,PUBLIC");
  check(
    "a field the code no longer knows is ignored",
    Object.keys(privacySettings([{ field: "shoeSize", level: "PUBLIC", allowChoice: null }])).includes("shoeSize"),
    false,
  );
  check("years count whole years", yearsLabel(new Date("2019-03-04T00:00:00Z"), new Date("2026-03-03T00:00:00Z")), "6 years");
  check("and turn on the day", yearsLabel(new Date("2019-03-04T00:00:00Z"), new Date("2026-03-04T00:00:00Z")), "7 years");
  check("under a year it counts months", yearsLabel(new Date("2026-01-15T00:00:00Z"), new Date("2026-09-14T00:00:00Z")), "7 months");
  check("which turn on the day too", yearsLabel(new Date("2026-01-15T00:00:00Z"), new Date("2026-09-15T00:00:00Z")), "8 months");
  check("one month is one", yearsLabel(new Date("2026-08-31T00:00:00Z"), new Date("2026-10-01T00:00:00Z")), "1 month");
  check("and the first weeks say so", yearsLabel(new Date("2026-10-01T00:00:00Z"), new Date("2026-10-20T00:00:00Z")), "Less than a month");
}

async function audienceAndCards() {
  console.log("\n— who is looking —");
  const tech = await db.user.findUniqueOrThrow({ where: { email: "tech@417group.org" } });
  const subject = { id: tech.id, directSupervisorId: tech.directSupervisorId, baseRole: tech.baseRole };

  check("the person themselves", await audienceFor(await sessionOf("tech@417group.org"), subject), "SELF");
  check("their direct supervisor", await audienceFor(await sessionOf("boss@417group.org"), subject), "RESTRICTED");
  check("any company manager", await audienceFor(await sessionOf("admin@417group.org"), subject), "RESTRICTED");
  check("another tech", await audienceFor(await sessionOf("tech2@417group.org"), subject), "FEDERATED");
  check(
    "a supervisor demoted to tech is no longer one over their old reports",
    await audienceFor(await sessionOf("tech2@417group.org"), { ...subject, directSupervisorId: (await sessionOf("tech2@417group.org")).id }),
    "FEDERATED",
  );

  const tech2 = await sessionOf("tech2@417group.org");
  check("a pay rate is not for another tech", await seesPayOf(tech2, tech.id), false);
  check(
    "nor for somebody who sees only their own",
    await seesPayOf({ ...tech2, grants: new Map([["pay.view_rates", "OWN"]]) as SessionUser["grants"] }, tech.id),
    false,
  );
  check(
    "but is for somebody who sees everyone's",
    await seesPayOf({ ...tech2, grants: new Map([["pay.view_rates", "ALL"]]) as SessionUser["grants"] }, tech.id),
    true,
  );
  check("and always for the person themselves", await seesPayOf(await sessionOf("tech@417group.org"), tech.id), true);

  // A field supervisor sees Restricted lines only through open work they
  // manage the person on.
  const sup = await sessionOf("sup@417group.org");
  const peer = await db.user.upsert({
    where: { email: "peer-profile@example.com" },
    update: { active: true, baseRole: "SUPERVISOR" },
    create: {
      email: "peer-profile@example.com",
      name: "Pat Peer",
      baseRole: "SUPERVISOR",
      signInMethod: "LOCAL",
    },
  });
  const client = await db.client.findFirstOrThrow();
  const project = await db.project.create({
    data: {
      name: "Profile audience check",
      code: `PRF${Math.floor(Math.random() * 90000 + 10000)}`,
      clientId: client.id,
      members: {
        create: [
          { userId: sup.id, role: "SUPERVISOR" },
          { userId: tech.id, role: "TECH" },
          { userId: peer.id, role: "SUPERVISOR" },
        ],
      },
    },
  });
  try {
    const onProject = { ...sup, scopedProjectIds: [...sup.scopedProjectIds, project.id] };
    check("a supervisor on a project they share", await audienceFor(onProject, subject), "RESTRICTED");
    check(
      "but not over another supervisor on it — working beside is not managing",
      await audienceFor(onProject, { id: peer.id, directSupervisorId: peer.directSupervisorId, baseRole: peer.baseRole }),
      "FEDERATED",
    );
    await db.project.update({ where: { id: project.id }, data: { status: "CLOSED" } });
    const others = await db.project.count({
      where: {
        id: { in: sup.scopedProjectIds },
        status: { not: "CLOSED" },
        OR: [{ members: { some: { userId: tech.id } } }, { jobs: { some: { assignments: { some: { userId: tech.id } } } } }],
      },
    });
    if (others === 0) {
      check("but not once the project has closed", await audienceFor(onProject, subject), "FEDERATED");
    }
  } finally {
    await db.project.delete({ where: { id: project.id } });
  }

  // A supervisor link that outlived the supervisor: the person it points at
  // was moved to a role that cannot supervise.
  await db.user.update({ where: { id: tech.id }, data: { directSupervisorId: peer.id } });
  try {
    const stale = await sessionOf(peer.email);
    check(
      "a supervisor link to somebody who can no longer supervise opens no pay rate",
      await seesPayOf({ ...stale, grants: new Map([["pay.view_rates", "PROJECT"]]) as SessionUser["grants"] }, tech.id),
      false,
    );
    const sent = await fileProfileRequest({
      subject: { id: tech.id, name: tech.name, directSupervisorId: peer.id },
      requesterId: tech.id,
      field: "LEGAL_NAME",
      value: "Terrence Stale Tech",
    });
    check("and a request goes to the managers instead", sent.reviewer, null);
    check(
      "without telling them what was asked",
      await db.notification.count({ where: { userId: peer.id, kind: "profile_request" } }),
      0,
    );
    await db.profileRequest.deleteMany({ where: { id: sent.id } });
  } finally {
    await db.user.update({ where: { id: tech.id }, data: { directSupervisorId: tech.directSupervisorId } });
  }

  const guest = await db.user.upsert({
    where: { email: "guest-profile@example.com" },
    update: { active: true, baseRole: "GUEST" },
    create: {
      email: "guest-profile@example.com",
      name: "Gus Guest",
      baseRole: "GUEST",
      signInMethod: "LOCAL",
    },
  });
  check("a guest sees the Public lines alone", await audienceFor(await sessionOf(guest.email), subject), "PUBLIC");
  check(
    "an account held here is not a guest for that — a tech without NextCloud is still a tech",
    await audienceFor(await sessionOf(peer.email), subject),
    "FEDERATED",
  );

  console.log("\n— what goes to clients —");
  await db.user.update({
    where: { id: tech.id },
    data: { phone: "559-555-0142", workPhone: "559-555-0110", voipPhone: "559-555-0199", preferredPhone: "WORK" },
  });
  const settings = privacySettings([]);
  let card = contactCard((await loadProfile(tech.id))!, settings);
  check("the preferred work phone and the VoIP line beside it", phonesLine(card), "559-555-0110, VoIP 559-555-0199");
  check("never the personal one", card.phones.some((phone) => phone.kind === "PERSONAL"), false);
  check("the work email", card.email, tech.email);

  await db.user.update({ where: { id: tech.id }, data: { preferredPhone: "VOIP" } });
  card = contactCard((await loadProfile(tech.id))!, settings);
  check("a preferred VoIP line goes alone", phonesLine(card), "VoIP 559-555-0199");
  check("and says it is VoIP", preferredPhoneLine(card), "559-555-0199 (VoIP)");

  await db.user.update({
    where: { id: tech.id },
    data: { workPhone: null, voipPhone: null, preferredPhone: null },
  });
  card = (await loadContactCards([tech.id])).get(tech.id)!;
  check("a personal phone nobody chose stays off the paperwork", card.phones.length, 0);

  await db.user.update({ where: { id: tech.id }, data: { preferredPhone: "PERSONAL" } });
  card = (await loadContactCards([tech.id])).get(tech.id)!;
  check("a preferred personal phone goes out once it may", preferredPhoneLine(card), "559-555-0142");

  const source = formSource("tech.leadPhone")!;
  const value = source.resolve!(
    {
      data: { job: { assignments: [{ userId: tech.id }] }, contacts: new Map([[tech.id, card]]) } as never,
      now: new Date(),
    },
    0,
  );
  check("the paperwork's lead tech phone is the same line", value, "559-555-0142");
}

async function requests() {
  console.log("\n— asking and answering —");
  const tech = await db.user.findUniqueOrThrow({ where: { email: "tech@417group.org" } });
  const boss = await db.user.findUniqueOrThrow({ where: { email: "boss@417group.org" } });
  const subject = { id: tech.id, name: tech.name, directSupervisorId: tech.directSupervisorId };

  await db.notification.deleteMany({ where: { userId: { in: [tech.id, boss.id] }, kind: { startsWith: "profile_" } } });

  const first = await fileProfileRequest({ subject, requesterId: tech.id, field: "LEGAL_NAME", value: "Terrence Q Tech" });
  const second = await fileProfileRequest({ subject, requesterId: tech.id, field: "LEGAL_NAME", value: "Terrence Allen Tech" });
  check(
    "a second ask replaces the first",
    await db.profileRequest.count({ where: { userId: tech.id, status: "PENDING", field: "LEGAL_NAME" } }),
    1,
  );
  check("and the first is gone", await db.profileRequest.count({ where: { id: first.id } }), 0);
  check(
    "their direct supervisor hears about it",
    await db.notification.count({ where: { userId: boss.id, kind: "profile_request" } }),
    2,
  );

  const answered = await answerProfileRequest({
    requestId: second.id,
    reviewerId: boss.id,
    reviewerName: boss.name,
    approve: true,
    note: null,
    warned: false,
  });
  check("approving works", answered.ok, true);
  check(
    "and puts the new legal name in place",
    (await db.user.findUniqueOrThrow({ where: { id: tech.id } })).legalName,
    "Terrence Allen Tech",
  );
  check(
    "the person who asked is told",
    await db.notification.count({ where: { userId: tech.id, kind: "profile_request_answered" } }),
    1,
  );
  const again = await answerProfileRequest({
    requestId: second.id,
    reviewerId: boss.id,
    reviewerName: boss.name,
    approve: false,
    note: "late",
    warned: false,
  });
  check("an answered request cannot be answered twice", again.ok, false);

  const history = await profileHistory(tech.id, "legalName");
  check("an approved request is one entry", history[0].action, "Legal name updated");
  check("by whoever asked", history[0].by, tech.name);
  check("approved by whoever answered", history[0].approvedBy, boss.name);
  check("with the value asked for", history[0].to, "Terrence Allen Tech");
  check(
    "and asking, by itself, is not history",
    history.filter((entry) => entry.action.includes("request") && !entry.action.endsWith("denied")).length,
    0,
  );

  // Turned down, it is an entry of its own, with the reason.
  const third = await fileProfileRequest({ subject, requesterId: tech.id, field: "LEGAL_NAME", value: "Terry Q Tech" });
  await answerProfileRequest({
    requestId: third.id,
    reviewerId: boss.id,
    reviewerName: boss.name,
    approve: false,
    note: "Use the name on your ID",
    warned: false,
  });
  const denied = (await profileHistory(tech.id, "legalName"))[0];
  check("a request turned down is its own entry", denied.action, "Legal name update request denied");
  check("with who turned it down", denied.approvedBy, boss.name);
  check("and why", denied.reason, "Use the name on your ID");
  check("saying what was asked for", denied.requested, "Terry Q Tech");
  check("with no value line, since nothing changed", `${denied.from}|${denied.to}`, "null|null");
}

async function nextcloudPicture() {
  console.log("\n— the NextCloud picture —");
  const tech2 = await db.user.findUniqueOrThrow({ where: { email: "tech2@417group.org" } });
  if (tech2.avatarPath) await deleteFile(tech2.avatarPath);
  await db.user.update({ where: { id: tech2.id }, data: { avatarPath: null, pictureSetAt: null } });
  // A fresh start: the copy is once in a profile's life, and earlier runs
  // have already had theirs.
  await db.auditEvent.deleteMany({
    where: { entityType: "User", entityId: tech2.id, action: { startsWith: "profile." } },
  });
  for (const kept of await db.profilePicture.findMany({ where: { userId: tech2.id } })) {
    await deleteFile(kept.path);
  }
  await db.profilePicture.deleteMany({ where: { userId: tech2.id } });

  const picture = await jpeg("#336699");
  const server = createServer((request, response) => {
    response.setHeader("Content-Type", "image/jpeg");
    if (request.url?.includes("drawn")) response.setHeader("X-NC-IsCustomAvatar", "0");
    else if (!request.url?.includes("unmarked")) response.setHeader("X-NC-IsCustomAvatar", "1");
    response.end(picture);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const issuer = process.env.NEXTCLOUD_ISSUER;
  process.env.NEXTCLOUD_ISSUER = `http://127.0.0.1:${port}`;
  try {
    await importNextcloudPicture(tech2.id, `http://127.0.0.1:${port + 1}/elsewhere`);
    check(
      "nothing is fetched from anywhere but NextCloud",
      (await db.user.findUniqueOrThrow({ where: { id: tech2.id } })).avatarPath,
      null,
    );
    await importNextcloudPicture(tech2.id, `http://127.0.0.1:${port}/unmarked`);
    check(
      "a picture NextCloud does not say was chosen is not copied",
      (await db.user.findUniqueOrThrow({ where: { id: tech2.id } })).avatarPath,
      null,
    );
    await importNextcloudPicture(tech2.id, `http://127.0.0.1:${port}/drawn`);
    check(
      "a drawn initial is not copied",
      (await db.user.findUniqueOrThrow({ where: { id: tech2.id } })).avatarPath,
      null,
    );
    await importNextcloudPicture(tech2.id, `http://127.0.0.1:${port}/chosen`);
    const copied = (await db.user.findUniqueOrThrow({ where: { id: tech2.id } })).avatarPath;
    check("a picture they chose is", Boolean(copied), true);
    const imported = (await profileHistory(tech2.id, "picture"))[0];
    check(
      "and the history says QuickTec copied it from NextCloud",
      `${imported?.action} · ${imported?.by} · ${imported?.source}`,
      "Profile picture added · System · Auto-Import: NC",
    );
    check(
      "kept as approved by QuickTec, for putting back later",
      (await db.profilePicture.findFirst({ where: { userId: tech2.id, path: copied ?? "" } }))?.approvedBySystem,
      true,
    );
    await importNextcloudPicture(tech2.id, `http://127.0.0.1:${port}/again`);
    check(
      "and only the once",
      (await db.user.findUniqueOrThrow({ where: { id: tech2.id } })).avatarPath,
      copied,
    );
    check(
      "and it counts as their picture having been set",
      Boolean((await db.user.findUniqueOrThrow({ where: { id: tech2.id } })).pictureSetAt),
      true,
    );
    // A manager takes it down; the next sign-in must not put it back.
    await db.user.update({ where: { id: tech2.id }, data: { avatarPath: null } });
    if (copied) await deleteFile(copied);
    await importNextcloudPicture(tech2.id, `http://127.0.0.1:${port}/chosen`);
    check(
      "not even after it has been taken down",
      (await db.user.findUniqueOrThrow({ where: { id: tech2.id } })).avatarPath,
      null,
    );
  } finally {
    server.close();
    process.env.NEXTCLOUD_ISSUER = issuer;
  }
}

async function pages() {
  console.log("\n— the pages —");
  const tech = await db.user.findUniqueOrThrow({ where: { email: "tech@417group.org" } });
  const boss = await db.user.findUniqueOrThrow({ where: { email: "boss@417group.org" } });
  await db.user.update({
    where: { id: tech.id },
    data: {
      legalName: "Terrence A. Tech",
      legalNameSetAt: new Date(),
      phone: "559-555-0142",
      workPhone: null,
      voipPhone: null,
      preferredPhone: null,
      addressLine1: "412 Oak Ave",
      city: "Visalia",
      state: "CA",
      postalCode: "93291",
      serviceStartDate: new Date("2019-03-04T00:00:00Z"),
      avatarVisibility: "FEDERATED", // kept to the company, to start
    },
  });
  await db.profileRequest.deleteMany({ where: { userId: tech.id } });
  await db.profilePrivacy.deleteMany({});
  await db.notification.deleteMany({ where: { userId: boss.id, kind: "profile_changed" } });

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  try {
    // --- their own ---------------------------------------------------------
    const own = await pageAs(browser, "tech@417group.org");
    await own.goto(`${BASE}/account`, { waitUntil: "load" });
    check("the account page is the profile", await own.getByRole("heading", { name: "Your profile" }).isVisible(), true);
    check(
      "the legal name is read-only once set",
      await own.getByText("Terrence A. Tech").first().isVisible(),
      true,
    );
    check("and says so", (await own.getByText("(read-only)").count()) > 0, true);
    check("the theme control is still here", await own.getByRole("radiogroup", { name: "Theme" }).isVisible(), true);

    await own.locator("#own-work").fill("559-555-0110");
    check(
      "a work phone takes the personal one off the preferred list",
      await own.locator('#own-preferred option[value="PERSONAL"]').isDisabled(),
      true,
    );
    await own.locator("#own-voip").fill("559-555-0199");
    await own.locator("#own-preferred").selectOption("VOIP");
    check(
      "a preferred VoIP line says it goes alone",
      await own.getByText("Clients get only your VoIP line, marked as VoIP.").isVisible(),
      true,
    );
    await own.getByRole("button", { name: "Save changes" }).click();
    await own.getByRole("status").filter({ hasText: "Saved." }).waitFor({ timeout: 15_000 });
    const saved = await db.user.findUniqueOrThrow({ where: { id: tech.id } });
    check("the phones are saved", `${saved.workPhone} ${saved.voipPhone} ${saved.preferredPhone}`, "559-555-0110 559-555-0199 VOIP");

    // Their supervisor sets the work phone while the page sits open; the next
    // save, of something else, must not put the old one back.
    await db.user.update({ where: { id: tech.id }, data: { workPhone: "559-555-0177" } });
    await own.locator("#own-city").fill("Tulare");
    await own.getByRole("button", { name: "Save changes" }).click();
    let city: string | null = null;
    for (let attempt = 0; attempt < 60 && city !== "Tulare"; attempt++) {
      city = (await db.user.findUniqueOrThrow({ where: { id: tech.id } })).city;
      if (city !== "Tulare") await own.waitForTimeout(250);
    }
    check("a later save keeps what it did not touch", (await db.user.findUniqueOrThrow({ where: { id: tech.id } })).workPhone, "559-555-0177");
    await db.user.update({ where: { id: tech.id }, data: { city: "Visalia", workPhone: "559-555-0110" } });

    await own.getByRole("button", { name: "Request a change" }).click();
    await own.locator("#own-legal-new").fill("terrence allen tech");
    await own.getByRole("button", { name: "Send to your supervisor" }).click();
    await own.getByText("waiting on Bo Ross").waitFor({ timeout: 15_000 });
    check("a request for a new legal name waits on the supervisor", true, true);
    check(
      "capitalised as it was typed",
      (await db.profileRequest.findFirstOrThrow({ where: { userId: tech.id, status: "PENDING" } })).value,
      "Terrence Allen Tech",
    );

    // --- the supervisor answers ---------------------------------------------
    const bossPage = await pageAs(browser, "boss@417group.org");
    await bossPage.goto(`${BASE}/approvals`, { waitUntil: "load" });
    check("it is on the supervisor's approvals", await bossPage.getByText("Profile requests").isVisible(), true);
    await bossPage.goto(`${BASE}/people/${tech.id}`, { waitUntil: "load" });
    check("their own employee, said so", await bossPage.getByText("You are their direct supervisor").isVisible(), true);
    await bossPage.getByRole("button", { name: "Approve" }).click();
    await bossPage.getByRole("status").filter({ hasText: "Approved." }).waitFor({ timeout: 15_000 });
    check(
      "approved, the legal name changes",
      (await db.user.findUniqueOrThrow({ where: { id: tech.id } })).legalName,
      "Terrence Allen Tech",
    );
    // The panel opens afresh on what is stored once the answer comes back.
    let shownName = "";
    for (let attempt = 0; attempt < 40 && shownName !== "Terrence Allen Tech"; attempt++) {
      shownName = await bossPage.locator("#m-legal").inputValue();
      if (shownName !== "Terrence Allen Tech") await bossPage.waitForTimeout(250);
    }
    check("and the box shows it", shownName, "Terrence Allen Tech");
    // Saving something else from the same page must not put the old name back.
    await bossPage.locator("#m-start").fill("2019-03-05");
    await bossPage.getByRole("button", { name: "Save", exact: true }).click();
    await bossPage.getByRole("status").filter({ hasText: "Saved." }).waitFor({ timeout: 15_000 });
    const afterSave = await db.user.findUniqueOrThrow({ where: { id: tech.id } });
    check(
      "a save after approving keeps the approved legal name",
      `${afterSave.legalName} ${afterSave.serviceStartDate?.toISOString().slice(0, 10)}`,
      "Terrence Allen Tech 2019-03-05",
    );

    // --- another manager is warned ------------------------------------------
    const admin = await pageAs(browser, "admin@417group.org");
    await admin.goto(`${BASE}/people/${tech.id}`, { waitUntil: "load" });
    await admin.locator("#m-legal").fill("Terrence Alan Tech");
    await admin.getByRole("button", { name: "Save", exact: true }).click();
    const dialog = admin.getByRole("alertdialog");
    await dialog.waitFor({ timeout: 15_000 });
    check("another manager is told this is not their employee", await dialog.getByText("Terry Tech isn't your employee").isVisible(), true);
    check(
      "and nothing has changed yet",
      (await db.user.findUniqueOrThrow({ where: { id: tech.id } })).legalName,
      "Terrence Allen Tech",
    );
    await dialog.getByRole("button", { name: "Change anyway" }).click();
    await admin.getByRole("status").filter({ hasText: "Saved." }).waitFor({ timeout: 15_000 });
    check(
      "past the warning it changes",
      (await db.user.findUniqueOrThrow({ where: { id: tech.id } })).legalName,
      "Terrence Alan Tech",
    );
    check(
      "and the direct supervisor is told",
      await db.notification.count({ where: { userId: boss.id, kind: "profile_changed" } }),
      1,
    );
    const latest = (await profileHistory(tech.id, "legalName"))[0];
    check(
      "the history says it was past the warning",
      latest.reason,
      "Not their direct supervisor — changed past the warning",
    );

    // --- pictures -----------------------------------------------------------
    await bossPage.goto(`${BASE}/people/${tech.id}`, { waitUntil: "load" });
    await bossPage.locator('input[aria-label="Upload"]').setInputFiles({
      name: "face.jpg",
      mimeType: "image/jpeg",
      buffer: await jpeg("#aa3344"),
    });
    await bossPage.getByRole("status").filter({ hasText: "Picture set." }).waitFor({ timeout: 15_000 });
    const withPicture = await db.user.findUniqueOrThrow({ where: { id: tech.id } });
    check("the supervisor sets the picture", Boolean(withPicture.avatarPath), true);

    const colleague = await pageAs(browser, "tech2@417group.org");
    const seen = await colleague.request.get(`${BASE}/api/avatars/${tech.id}`);
    check("a picture kept to the company is there for anybody signed in", seen.status(), 200);
    const guest = await pageAs(browser, "guest-profile@example.com");
    const hidden = await guest.request.get(`${BASE}/api/avatars/${tech.id}`);
    check("but not, kept to the company, for a guest", hidden.status(), 404);
    const directory = await guest.goto(`${BASE}/people`, { waitUntil: "load" });
    check("who has no people directory either", directory?.status(), 404);
    await guest.goto(`${BASE}/dashboard`, { waitUntil: "load" });
    check(
      "and no way to jobs, approvals or people from the menu",
      await guest
        .locator("nav")
        .first()
        .getByRole("link", { name: /^(Jobs|Approvals|People)$/ })
        .count(),
      0,
    );
    const jobs = await guest.goto(`${BASE}/jobs`, { waitUntil: "load" });
    check("nor to the jobs list by its address", guest.url().includes("/jobs") && jobs?.status() === 200, false);

    await own.goto(`${BASE}/account`, { waitUntil: "load" });
    check(
      "their picture is in the header",
      (await own.locator('button[aria-label="Account"] img').getAttribute("src"))?.startsWith(`/api/avatars/${tech.id}`),
      true,
    );
    await own.locator('input[aria-label="Choose a picture"]').setInputFiles({
      name: "new.jpg",
      mimeType: "image/jpeg",
      buffer: await jpeg("#33aa44"),
    });
    await own.getByText("New picture waiting on Bo Ross").waitFor({ timeout: 15_000 });
    check(
      "a new picture is a request once there is one",
      await db.profileRequest.count({ where: { userId: tech.id, field: "PICTURE", status: "PENDING" } }),
      1,
    );
    check(
      "and the picture in use stays until it is answered",
      (await db.user.findUniqueOrThrow({ where: { id: tech.id } })).avatarPath,
      withPicture.avatarPath,
    );

    await own.getByRole("button", { name: "Picture settings" }).click();
    await own.getByRole("menuitemradio", { name: /^Public/ }).click();
    let visibility: string | null = null;
    for (let attempt = 0; attempt < 40 && visibility !== "PUBLIC"; attempt++) {
      visibility = (await db.user.findUniqueOrThrow({ where: { id: tech.id } })).avatarVisibility;
      if (visibility !== "PUBLIC") await own.waitForTimeout(250);
    }
    check("who sees the picture is theirs to choose", visibility, "PUBLIC");
    const shown = (await profileHistory(tech.id, "picture"))[0];
    check(
      "and the change is in the picture's history by level",
      `${shown?.action}: ${shown?.from} → ${shown?.to}`,
      "Profile picture visibility changed: Federated → Public",
    );
    check(
      "and a Public picture is there for a guest",
      (await guest.request.get(`${BASE}/api/avatars/${tech.id}`)).status(),
      200,
    );

    // --- what another tech sees ---------------------------------------------
    await colleague.goto(`${BASE}/people/${tech.id}`, { waitUntil: "load" });
    check("another tech does not see the legal name", await colleague.getByText("Terrence Alan Tech").count(), 0);
    check("nor the street", await colleague.getByText("412 Oak Ave").count(), 0);
    check("and is told what is kept from them", await colleague.getByText("Not shown to you").isVisible(), true);
    check("but sees the home region", await colleague.getByText("Visalia, CA 93291").first().isVisible(), true);
    check(
      "and has no history to read",
      await colleague.getByRole("button", { name: /^History of / }).count(),
      0,
    );

    // --- a line's history opens under the line --------------------------------
    await own.goto(`${BASE}/account`, { waitUntil: "load" });
    await own.getByRole("button", { name: "History of legal name" }).first().click();
    await own.getByText("Legal name updated").first().waitFor({ timeout: 15_000 });
    check("a line's history opens under it", await own.getByText("Approved By:").first().isVisible(), true);
    const turnedDown = own.locator("li", { hasText: "Legal name update request denied" }).first();
    check(
      "a request turned down says what was asked for, not a change",
      (await turnedDown.innerText()).replace(/\s+/g, " ").includes("Requested: Terry Q Tech"),
      true,
    );
    check("and draws no value line", await turnedDown.locator("s").count(), 0);

    // --- a supervisor takes a picture down, saying why -------------------------
    await bossPage.goto(`${BASE}/people/${tech.id}`, { waitUntil: "load" });
    await bossPage.getByRole("button", { name: "Remove", exact: true }).click();
    await bossPage.locator("#m-remove-reason").fill("Not a clear photo");
    await bossPage.getByRole("button", { name: "Take it down" }).click();
    await bossPage.getByRole("status").filter({ hasText: "Picture removed." }).waitFor({ timeout: 15_000 });
    const removed = (await profileHistory(tech.id, "picture"))[0];
    check(
      "a picture taken down says who and why",
      `${removed?.action} · ${removed?.by} · ${removed?.reason}`,
      `Profile picture removed · ${boss.name} · Not a clear photo`,
    );
    const kept = await db.profilePicture.findFirst({ where: { userId: tech.id, path: withPicture.avatarPath ?? "" } });
    check("and it stays among their earlier pictures", Boolean(kept), true);
    check("marked as taken down, so it is not theirs to put back", Boolean(kept?.takenDownAt), true);

    // --- the company's levels -------------------------------------------------
    await bossPage.goto(`${BASE}/settings/roles?tab=privacy`, { waitUntil: "load" });
    await bossPage.getByLabel("Who sees voip").selectOption("FEDERATED");
    await bossPage.getByText("One field differs").waitFor({ timeout: 15_000 });
    // The page says so as the choice is made; the row follows the server.
    let stored: string | undefined;
    for (let attempt = 0; attempt < 20 && !stored; attempt++) {
      stored = (await db.profilePrivacy.findUnique({ where: { field: "voipPhone" } }))?.level;
      if (!stored) await bossPage.waitForTimeout(250);
    }
    check("a change is saved", stored, "FEDERATED");
    await bossPage.getByRole("button", { name: "Restore optimized defaults" }).click();
    await bossPage.getByRole("alertdialog").getByRole("button", { name: "Restore" }).click();
    await bossPage.getByText("Every field is on its optimized default.").waitFor({ timeout: 15_000 });
    check("restoring forgets every change", await db.profilePrivacy.count(), 0);
  } finally {
    await browser.close();
  }
}

/** A picture's whole life on somebody's own page: asked for, approved, taken down, put back. */
async function pictureFlows() {
  console.log("\n— pictures, from the person's own page —");
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  try {
    // Nobody to approve it: QuickTec does, at once.
    const guest = await db.user.findUniqueOrThrow({ where: { email: "guest-profile@example.com" } });
    await db.user.update({
      where: { id: guest.id },
      data: { active: true, avatarPath: null, pictureSetAt: null, directSupervisorId: null },
    });
    await db.profilePicture.deleteMany({ where: { userId: guest.id } });
    const page = await pageAs(browser, guest.email);
    await page.goto(`${BASE}/account`, { waitUntil: "load" });
    await page.getByRole("button", { name: "Picture settings" }).click();
    await page.getByRole("menuitem", { name: "Add a picture" }).click();
    await page.getByRole("radio", { name: "Hire", exact: true }).check();
    await page.locator('input[aria-label="Choose a picture"]').setInputFiles({
      name: "me.jpg",
      mimeType: "image/jpeg",
      buffer: await jpeg("#448866"),
    });
    await page.getByRole("status").filter({ hasText: "Your picture is set." }).waitFor({ timeout: 15_000 });
    const first = (await profileHistory(guest.id, "picture"))[0];
    check(
      "with no supervisor, a first picture is approved by QuickTec at once",
      `${first?.action} · ${first?.by} · ${first?.approvedBy} · ${first?.source} · ${first?.reason}`,
      `Profile picture added · ${guest.name} · System · Manual Import: ${guest.name} · Hire`,
    );
    const firstPath = (await db.user.findUniqueOrThrow({ where: { id: guest.id } })).avatarPath;

    await page.getByRole("button", { name: "Picture settings" }).click();
    await page.getByRole("menuitem", { name: "Take my picture down" }).click();
    await page.getByRole("button", { name: "Take it down" }).click();
    await page.getByRole("status").filter({ hasText: "taken down" }).waitFor({ timeout: 15_000 });
    check("the person may take their own picture down", (await db.user.findUniqueOrThrow({ where: { id: guest.id } })).avatarPath, null);
    check("and the history says so", (await profileHistory(guest.id, "picture"))[0]?.action, "Profile picture removed");

    await page.getByRole("button", { name: "Picture settings" }).click();
    await page.getByRole("menuitem", { name: "Put back an earlier picture" }).click();
    await page.getByRole("button", { name: "Put back" }).first().click();
    await page.getByRole("status").filter({ hasText: "earlier picture is back" }).waitFor({ timeout: 15_000 });
    check("and put an earlier one back", (await db.user.findUniqueOrThrow({ where: { id: guest.id } })).avatarPath, firstPath);
    const restored = (await profileHistory(guest.id, "picture"))[0];
    check(
      "which names who approved it then, and where it came from",
      `${restored?.action} · ${restored?.approvedBy} · ${restored?.source}`,
      `Profile picture restored · System · Manual Import: ${guest.name}`,
    );

    // A supervisor to approve it: asked for, with the reason, and approved.
    const tech2 = await db.user.findUniqueOrThrow({ where: { email: "tech2@417group.org" } });
    const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@417group.org" } });
    await db.user.update({ where: { id: tech2.id }, data: { avatarPath: null } });
    await db.profileRequest.deleteMany({ where: { userId: tech2.id } });
    const own = await pageAs(browser, tech2.email);
    await own.goto(`${BASE}/account`, { waitUntil: "load" });
    await own.getByRole("button", { name: "Picture settings" }).click();
    await own.getByRole("menuitem", { name: "Add a picture" }).click();
    await own.getByRole("radio", { name: "Pre-hire", exact: true }).check();
    await own.locator('input[aria-label="Choose a picture"]').setInputFiles({
      name: "me.jpg",
      mimeType: "image/jpeg",
      buffer: await jpeg("#884466"),
    });
    await own.getByText(`waiting on ${admin.name}`).waitFor({ timeout: 15_000 });
    const asked = await db.profileRequest.findFirstOrThrow({
      where: { userId: tech2.id, field: "PICTURE", status: "PENDING" },
    });
    check("a first picture is asked for, with why", asked.reason, "Pre-hire");
    await answerProfileRequest({
      requestId: asked.id,
      reviewerId: admin.id,
      reviewerName: admin.name,
      approve: true,
      note: null,
      warned: false,
    });
    const approved = (await profileHistory(tech2.id, "picture"))[0];
    check(
      "approved, it is one entry: by them, approved by their supervisor",
      `${approved?.action} · ${approved?.by} · ${approved?.approvedBy} · ${approved?.source} · ${approved?.reason}`,
      `Profile picture added · ${tech2.name} · ${admin.name} · Manual Import: ${tech2.name} · Pre-hire`,
    );
  } finally {
    await browser.close();
  }
}

/** Saves the person's own profile and waits until what it should have done is there. */
async function saveOwn(page: Page, done: () => Promise<boolean>): Promise<boolean> {
  await page.getByRole("button", { name: "Save changes" }).click();
  for (let attempt = 0; attempt < 60; attempt++) {
    if (await done()) return true;
    await page.waitForTimeout(250);
  }
  return false;
}

async function lineEntries() {
  console.log("\n— how lines read in the history —");
  const stateName = (code: string) => stateText(code) ?? code;

  const states = statesChange(["NV", "CA"], ["CA", "AZ"], stateName)[0];
  check("states keep the whole list on each side", `${states?.from} | ${states?.to}`, "California, Nevada | Arizona, California");
  check("the same states in another order are no change", statesChange(["CA", "NV"], ["NV", "CA"], stateName).length, 0);

  check(
    "a new number for the preferred phone is not a preferred-phone change",
    preferredPhoneChange(
      { chosen: "WORK", personal: null, work: "559-555-0110", voip: null },
      { chosen: "WORK", personal: null, work: "559-555-0111", voip: null },
    ).length,
    0,
  );
  const moved = preferredPhoneChange(
    { chosen: "PERSONAL", personal: "559-555-0100", work: null, voip: null },
    { chosen: "PERSONAL", personal: "559-555-0100", work: "559-555-0110", voip: null },
  )[0];
  check("another phone is", `${moved?.from} ➔ ${moved?.to}`, "Personal: 559-555-0100 ➔ Work: 559-555-0110");

  check("a zone picked by hand says so", zoneLine("America/Denver", true, "93291"), "Manual: Mountain");
  check("one that follows the ZIP says so", zoneLine("America/Los_Angeles", false, "93291"), "Auto (ZIP): Pacific");
  check("the starting zone with no ZIP is the default", zoneLine("America/Los_Angeles", false, null), "Default: Pacific");
  check("and so beside a ZIP on another clock", zoneLine("America/Los_Angeles", false, "80202"), "Default: Pacific");
  const handPicked = (timeZone: string, postalCode: string | null) =>
    zonePickedByHand({ timeZone, timeZoneManual: false, postalCode });
  check("the starting zone beside another ZIP was never picked", handPicked("America/Los_Angeles", "80202"), false);
  check("another zone beside another ZIP was", handPicked("America/Chicago", "80202"), true);
  check("as was a zone other than the starting one with no ZIP", handPicked("America/New_York", null), true);
  check("the ZIP's own zone was not", handPicked("America/Denver", "80202"), false);

  if (process.env.SKIP_PAGES === "1") return;
  const tech = await db.user.findUniqueOrThrow({ where: { email: "tech@417group.org" } });
  const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@417group.org" } });
  const following = { postalCode: "93291", timeZone: "America/Los_Angeles", timeZoneManual: false };
  await db.user.update({
    where: { id: tech.id },
    data: {
      ...following,
      phone: "559-555-0142",
      workPhone: "559-555-0110",
      voipPhone: null,
      preferredPhone: "WORK",
    },
  });
  // The newest entry of a line, and whether a newer one has come since: a
  // count would stop growing once the history reads only its newest events.
  const latest = async (field: HistoryField) => (await profileHistory(tech.id, field))[0];
  const newest = async (field: HistoryField) => (await latest(field))?.id ?? null;
  const movedOn = (field: HistoryField, since: string | null) => async () => (await newest(field)) !== since;
  const stored = () => db.user.findUniqueOrThrow({ where: { id: tech.id } });

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  try {
    const own = await pageAs(browser, "tech@417group.org");

    // --- a zone picked, then handed back to the ZIP ----------------------------
    let zone = await newest("timeZone");
    await own.goto(`${BASE}/account`, { waitUntil: "load" });
    await own.locator("#own-zone").selectOption("America/Denver");
    check("a zone picked is saved", await saveOwn(own, movedOn("timeZone", zone)), true);
    const picked = await latest("timeZone");
    check(
      "a zone picked by hand reads as one",
      `${picked?.from} ➔ ${picked?.to} · ${picked?.by}`,
      `Auto (ZIP): Pacific ➔ Manual: Mountain · ${tech.name}`,
    );

    zone = await newest("timeZone");
    await own.goto(`${BASE}/account`, { waitUntil: "load" });
    await own.locator("#own-zone").selectOption("auto");
    check("handing it back is saved", await saveOwn(own, movedOn("timeZone", zone)), true);
    const handedBack = await latest("timeZone");
    check(
      "and handed back to the ZIP, as theirs",
      `${handedBack?.from} ➔ ${handedBack?.to} · ${handedBack?.by}`,
      `Manual: Mountain ➔ Auto (ZIP): Pacific · ${tech.name}`,
    );

    // A zone set before profiles existed, not its ZIP's: a save of something
    // else is not a change of zone.
    await db.user.update({ where: { id: tech.id }, data: { timeZone: "America/Denver", timeZoneManual: false } });
    zone = await newest("timeZone");
    const street = await newest("street");
    await own.goto(`${BASE}/account`, { waitUntil: "load" });
    await own.locator("#own-street").fill("9 Elm St");
    check("a street is saved", await saveOwn(own, movedOn("street", street)), true);
    check("saving something else writes nothing about the zone", await newest("timeZone"), zone);

    // The page opened while the zone followed the ZIP; an administrator picks
    // one meanwhile. A new ZIP from the stale page keeps their pick, and is
    // not the person handing it back.
    await db.user.update({ where: { id: tech.id }, data: following });
    await own.goto(`${BASE}/account`, { waitUntil: "load" });
    await db.user.update({ where: { id: tech.id }, data: { timeZone: "America/Chicago", timeZoneManual: true } });
    zone = await newest("timeZone");
    const region = await newest("homeRegion");
    await own.getByRole("textbox", { name: "ZIP" }).fill("93292");
    check("a new ZIP is saved", await saveOwn(own, movedOn("homeRegion", region)), true);
    const kept = await stored();
    check("a zone picked meanwhile is kept", `${kept.timeZone} ${kept.timeZoneManual}`, "America/Chicago true");
    check("and nothing says the person handed it back", await newest("timeZone"), zone);

    // --- the users page ---------------------------------------------------------
    const adminPage = await pageAs(browser, "admin@417group.org");
    const row = () =>
      adminPage.locator("form").filter({ has: adminPage.locator(`input[name="userId"][value="${tech.id}"]`) });
    const saveRow = async (done: () => Promise<boolean>) => {
      await row().getByRole("button", { name: "Save", exact: true }).click();
      for (let attempt = 0; attempt < 60; attempt++) {
        if (await done()) return true;
        await adminPage.waitForTimeout(250);
      }
      return false;
    };

    // Following the ZIP, it moves with a new one, as QuickTec's doing.
    await db.user.update({ where: { id: tech.id }, data: following });
    await adminPage.goto(`${BASE}/settings/users`, { waitUntil: "load" });
    await adminPage.locator(`#zip-${tech.id}`).fill("80202");
    check(
      "the users page says a following zone moves with the ZIP",
      await row().getByText("Their zone follows the ZIP: saved, it moves to Mountain.").isVisible(),
      true,
    );
    check("and offers nothing to click", await row().getByRole("button", { name: /^Use the zone for/ }).count(), 0);
    zone = await newest("timeZone");
    check("a new ZIP there is saved", await saveRow(movedOn("timeZone", zone)), true);
    const followed = await latest("timeZone");
    check(
      "the zone that followed it is QuickTec's",
      `${followed?.from} ➔ ${followed?.to} · ${followed?.by} · ${followed?.source}`,
      "Auto (ZIP): Pacific ➔ Auto (ZIP): Mountain · System · Auto: ZIP 80202",
    );
    check("and still follows the ZIP", (await stored()).timeZoneManual, false);

    // Picked by hand, the ZIP's own zone hands it back to the ZIP.
    await db.user.update({ where: { id: tech.id }, data: { timeZone: "America/Chicago", timeZoneManual: true } });
    await adminPage.goto(`${BASE}/settings/users`, { waitUntil: "load" });
    await row().getByRole("button", { name: "Use the zone for 80202" }).click();
    zone = await newest("timeZone");
    check("the ZIP's zone is saved", await saveRow(movedOn("timeZone", zone)), true);
    const backToZip = await latest("timeZone");
    check(
      "the ZIP's own zone, clicked, follows the ZIP again",
      `${backToZip?.from} ➔ ${backToZip?.to} · ${backToZip?.by}`,
      `Manual: Central ➔ Auto (ZIP): Mountain · ${admin.name}`,
    );
    check("and is not a pick", (await stored()).timeZoneManual, false);

    // Set before profiles existed and not its ZIP's: a new ZIP keeps it, and
    // from then on it is flagged as the pick it was.
    await db.user.update({ where: { id: tech.id }, data: { timeZone: "America/Chicago", timeZoneManual: false } });
    await adminPage.goto(`${BASE}/settings/users`, { waitUntil: "load" });
    await adminPage.locator(`#zip-${tech.id}`).fill("93291");
    zone = await newest("timeZone");
    const regionThere = await newest("homeRegion");
    check("a new ZIP for it is saved", await saveRow(movedOn("homeRegion", regionThere)), true);
    const legacy = await stored();
    check("an old pick is kept and flagged", `${legacy.timeZone} ${legacy.timeZoneManual}`, "America/Chicago true");
    check("with nothing written about the zone", await newest("timeZone"), zone);
    await db.user.update({ where: { id: tech.id }, data: following });

    // --- a new number for the preferred phone ----------------------------------
    const preferred = await newest("preferredPhone");
    const work = await newest("workPhone");
    await own.goto(`${BASE}/account`, { waitUntil: "load" });
    await own.locator("#own-work").fill("559-555-0111");
    check("a new work number is saved", await saveOwn(own, movedOn("workPhone", work)), true);
    check("the work phone's new number is its own entry", (await latest("workPhone"))?.action, "Work phone updated");
    check("and not a change of preferred phone", await newest("preferredPhone"), preferred);

    // --- states, whole lists, what went and what came marked -------------------
    await recordProfileEvents({
      actorId: tech.id,
      userId: tech.id,
      changes: statesChange(["CA", "NV"], ["CA", "AZ"], stateName),
    });
    await own.goto(`${BASE}/account`, { waitUntil: "load" });
    await own.getByRole("button", { name: "History of states of operation" }).first().click();
    const entry = own.locator("li", { hasText: "States of operation updated" }).first();
    await entry.waitFor({ timeout: 15_000 });
    check("the state taken off is struck through", await entry.locator("s").allTextContents(), "Nevada (removed)");
    check("the state added is in bold", await entry.locator("strong").allTextContents(), "Arizona (added)");
    const entryText = await entry.textContent();
    check(
      "and every state is on each side",
      ["California, Nevada (removed)", "Arizona (added), California"].every((side) =>
        (entryText ?? "").includes(side),
      ),
      true,
    );
  } finally {
    await browser.close();
  }
}

async function main() {
  await rules();
  await audienceAndCards();
  await requests();
  await nextcloudPicture();
  if (process.env.SKIP_PAGES !== "1") {
    await pages();
    await pictureFlows();
  }
  await lineEntries();

  // What this left waiting would sit in every other suite's approvals inbox.
  const tech = await db.user.findUniqueOrThrow({ where: { email: "tech@417group.org" } });
  for (const request of await db.profileRequest.findMany({ where: { status: "PENDING" } })) {
    if (request.picturePath) await deleteFile(request.picturePath);
  }
  await db.profileRequest.deleteMany({ where: { status: "PENDING" } });
  await db.user.update({ where: { id: tech.id }, data: { avatarVisibility: "PUBLIC" } });
  await db.user.updateMany({
    where: { email: { in: ["guest-profile@example.com", "peer-profile@example.com"] } },
    data: { active: false },
  });

  console.log(failures === 0 ? "\nAll profile checks passed." : `\n${failures} profile check(s) failed.`);
  await db.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});
