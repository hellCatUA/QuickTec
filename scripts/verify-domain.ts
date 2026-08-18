import "dotenv/config";
import { db } from "@/lib/db";
import {
  allocateIntWo,
  allocateRevisitIntWo,
  revisitAssignmentId,
} from "@/lib/int-wo";
import {
  startOfWeekMonday,
  roundToInterval,
  decimalHours,
  isoDateInZone,
  parseDatetimeLocalInZone,
  toDatetimeLocalInZone,
  zonedMidnight,
} from "@/lib/datetime";

/**
 * Integration check for the numbering, date and scope rules.
 *
 * DESTRUCTIVE: wipes jobs, assignments and INT WO counters, so it needs an
 * explicit opt-in. Never point it at the live database.
 *
 *   QUICKTEC_ALLOW_DESTRUCTIVE_VERIFY=1 npm run verify
 */
if (process.env.QUICKTEC_ALLOW_DESTRUCTIVE_VERIFY !== "1") {
  console.error(
    "Refusing to run: this deletes all jobs and counters.\n" +
      "Set QUICKTEC_ALLOW_DESTRUCTIVE_VERIFY=1 on a development database to proceed.",
  );
  process.exit(1);
}

const TZ = "America/Los_Angeles";
let failures = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}\n      got ${actual}${ok ? "" : `  want ${expected}`}`);
}

async function main() {
  // --- fixtures -----------------------------------------------------------
  const boss = await db.user.findUniqueOrThrow({
    where: { email: "boss@417group.org" },
  });
  const sup = await db.user.findUniqueOrThrow({
    where: { email: "sup@417group.org" },
  });
  const tech = await db.user.findUniqueOrThrow({
    where: { email: "tech@417group.org" },
  });

  const client = await db.client.upsert({
    where: { name: "NetCom Sub" },
    update: {},
    create: { name: "NetCom Sub" },
  });
  const customer = await db.customer.upsert({
    where: { code: "SBUX" },
    update: {},
    create: { name: "Starbucks", code: "SBUX" },
  });
  const site = await db.site.upsert({
    where: { customerId_siteNumber: { customerId: customer.id, siteNumber: "24541" } },
    update: {},
    create: {
      customerId: customer.id,
      siteNumber: "24541",
      addressLine1: "1912 Pike Pl",
      city: "Seattle",
      state: "WA",
      postalCode: "98101",
    },
  });
  const project = await db.project.upsert({
    where: { id: "seed-project-prj12" },
    update: { intWoCounter: 0 },
    create: {
      id: "seed-project-prj12",
      name: "Register Refresh",
      externalProjectId: "PRJ12",
      clientId: client.id,
      managerId: sup.id,
    },
  });

  await db.job.deleteMany({});
  await db.intWoCounter.deleteMany({});

  const base = {
    title: "t",
    clientId: client.id,
    customerId: customer.id,
    siteId: site.id,
    createdById: boss.id,
  };

  // --- global yearly counter ---------------------------------------------
  const july = new Date("2026-07-15T17:00:00Z");
  const noProject = [];
  for (let i = 0; i < 2; i++) {
    const job = await db.$transaction(async (tx) => {
      const { intWoId, sequence } = await allocateIntWo(tx, {
        projectId: null,
        externalProjectId: null,
        effectiveDate: july,
        timeZone: TZ,
      });
      return tx.job.create({
        data: { ...base, intWoId, intWoSequence: sequence, scheduledStart: july },
      });
    });
    noProject.push(job);
  }
  check("no-project job 1", noProject[0].intWoId, "2026-07-0000-0001");
  check("no-project job 2", noProject[1].intWoId, "2026-07-0000-0002");

  // A job in a different month draws from the same yearly counter.
  const december = new Date("2026-12-03T18:00:00Z");
  const decJob = await db.$transaction(async (tx) => {
    const { intWoId, sequence } = await allocateIntWo(tx, {
      projectId: null,
      externalProjectId: null,
      effectiveDate: december,
      timeZone: TZ,
    });
    return tx.job.create({
      data: { ...base, intWoId, intWoSequence: sequence, scheduledStart: december },
    });
  });
  check("counter does not reset monthly", decJob.intWoId, "2026-12-0000-0003");

  // A new year restarts it.
  const nextYear = new Date("2027-01-06T18:00:00Z");
  const nyJob = await db.$transaction(async (tx) => {
    const { intWoId, sequence } = await allocateIntWo(tx, {
      projectId: null,
      externalProjectId: null,
      effectiveDate: nextYear,
      timeZone: TZ,
    });
    return tx.job.create({
      data: { ...base, intWoId, intWoSequence: sequence, scheduledStart: nextYear },
    });
  });
  check("counter resets in January", nyJob.intWoId, "2027-01-0000-0001");

  // --- project counter ----------------------------------------------------
  const projJobs = [];
  for (let i = 0; i < 2; i++) {
    const job = await db.$transaction(async (tx) => {
      const { intWoId, sequence } = await allocateIntWo(tx, {
        projectId: project.id,
        externalProjectId: project.externalProjectId,
        effectiveDate: july,
        timeZone: TZ,
      });
      return tx.job.create({
        data: {
          ...base,
          projectId: project.id,
          intWoId,
          intWoSequence: sequence,
          scheduledStart: july,
          externalAssignmentId: i === 0 ? "887766" : null,
        },
      });
    });
    projJobs.push(job);
  }
  check("project job 1", projJobs[0].intWoId, "2026-07-PRJ12-0001");
  check("project job 2", projJobs[1].intWoId, "2026-07-PRJ12-0002");

  // Project counters are independent of the global one.
  check(
    "global counter untouched by project jobs",
    (await db.intWoCounter.findUnique({ where: { scope: "global:2026" } }))?.value,
    3,
  );

  // --- revisits -----------------------------------------------------------
  const parent = projJobs[0];
  const august = new Date("2026-08-20T17:00:00Z");
  const september = new Date("2026-09-02T17:00:00Z");

  const r1 = await db.$transaction(async (tx) => {
    const alloc = await allocateRevisitIntWo(tx, {
      parentJobId: parent.id,
      effectiveDate: august,
      timeZone: TZ,
    });
    return tx.job.create({
      data: {
        ...base,
        projectId: project.id,
        parentJobId: parent.id,
        intWoId: alloc.intWoId,
        intWoSequence: alloc.sequence,
        revisitNumber: alloc.revisitNumber,
        externalAssignmentId: revisitAssignmentId(parent.externalAssignmentId),
      },
    });
  });
  check("revisit 1 number", r1.intWoId, "2026-08-PRJ12-0001-R1");
  check("revisit 1 assignment id", r1.externalAssignmentId, "R-887766");

  const r2 = await db.$transaction(async (tx) => {
    const alloc = await allocateRevisitIntWo(tx, {
      parentJobId: r1.id, // revisit of a revisit still chains off the original
      effectiveDate: september,
      timeZone: TZ,
    });
    return tx.job.create({
      data: {
        ...base,
        projectId: project.id,
        parentJobId: parent.id,
        intWoId: alloc.intWoId,
        intWoSequence: alloc.sequence,
        revisitNumber: alloc.revisitNumber,
        externalAssignmentId: revisitAssignmentId(r1.externalAssignmentId),
      },
    });
  });
  check("revisit 2 number", r2.intWoId, "2026-09-PRJ12-0001-R2");
  check("R- prefix is not doubled", r2.externalAssignmentId, "R-887766");

  check(
    "revisits consume no project counter",
    (await db.project.findUniqueOrThrow({ where: { id: project.id } })).intWoCounter,
    2,
  );

  // --- time zone boundary -------------------------------------------------
  // 31 July 23:00 Los Angeles is 1 August in UTC. The WO must file under July.
  const lateJuly = new Date("2026-08-01T06:00:00Z");
  const tzJob = await db.$transaction(async (tx) => {
    const { intWoId, sequence } = await allocateIntWo(tx, {
      projectId: project.id,
      externalProjectId: project.externalProjectId,
      effectiveDate: lateJuly,
      timeZone: TZ,
    });
    return tx.job.create({
      data: { ...base, projectId: project.id, intWoId, intWoSequence: sequence },
    });
  });
  check("late-evening job files under local month", tzJob.intWoId, "2026-07-PRJ12-0003");

  // --- concurrency --------------------------------------------------------
  const concurrent = await Promise.all(
    Array.from({ length: 10 }, () =>
      db.$transaction(async (tx) => {
        const { intWoId, sequence } = await allocateIntWo(tx, {
          projectId: null,
          externalProjectId: null,
          effectiveDate: july,
          timeZone: TZ,
        });
        return tx.job.create({
          data: { ...base, intWoId, intWoSequence: sequence },
        });
      }),
    ),
  );
  check(
    "10 concurrent allocations are all distinct",
    new Set(concurrent.map((job) => job.intWoId)).size,
    10,
  );

  // --- date helpers -------------------------------------------------------
  check(
    "week starts Monday",
    startOfWeekMonday(new Date("2026-07-30T12:00:00Z"), TZ).toISOString(),
    new Date("2026-07-27T07:00:00.000Z").toISOString(),
  );
  const round = (hhmm: string) =>
    roundToInterval(new Date(`2026-07-28T${hhmm}:00Z`), 5)
      .toISOString()
      .slice(11, 16);

  // The stated window is [target - 3, target + 2).
  check("rounding 09:56 -> 09:55", round("09:56"), "09:55");
  check("rounding 09:57 -> 10:00", round("09:57"), "10:00");
  check("rounding 10:00 -> 10:00", round("10:00"), "10:00");
  check("rounding 10:01 -> 10:00", round("10:01"), "10:00");
  check("rounding 10:02 -> 10:05", round("10:02"), "10:05");
  check("rounding 10:03 -> 10:05", round("10:03"), "10:05");
  check("rounding 10:06 -> 10:05", round("10:06"), "10:05");
  check("rounding 10:07 -> 10:10", round("10:07"), "10:10");
  check("2h35m as decimal hours", decimalHours(155), "2.58");

  // A datetime-local input is rendered in the site's zone and submitted back
  // with no offset at all. Reading it with `new Date` took it as the server's
  // zone — UTC here — so opening a job and pressing Save without touching
  // anything moved it by the site's offset, every time, and dragged the crew's
  // calendars along.
  const roundTrip = (iso: string, zone: string) =>
    parseDatetimeLocalInZone(
      toDatetimeLocalInZone(new Date(iso), zone),
      zone,
    )?.toISOString();

  check(
    "a scheduled time survives being rendered and saved again",
    roundTrip("2026-07-28T16:30:00.000Z", TZ),
    "2026-07-28T16:30:00.000Z",
  );
  check(
    "and in winter, when the offset is different",
    roundTrip("2026-01-15T17:00:00.000Z", TZ),
    "2026-01-15T17:00:00.000Z",
  );
  check(
    "9am on site is 9am on site, not 9am UTC",
    parseDatetimeLocalInZone("2026-07-28T09:00", TZ)?.toISOString(),
    "2026-07-28T16:00:00.000Z",
  );
  check(
    "an hour after the clocks go back is still that hour",
    roundTrip("2026-11-01T10:30:00.000Z", TZ),
    "2026-11-01T10:30:00.000Z",
  );
  check(
    "a value that already carries an offset is left alone",
    parseDatetimeLocalInZone("2026-07-28T16:30:00.000Z", TZ)?.toISOString(),
    "2026-07-28T16:30:00.000Z",
  );
  check(
    "and nonsense is still rejected",
    parseDatetimeLocalInZone("not a date", TZ),
    null,
  );

  // The drift correction underneath all of this used to count a month as a
  // flat 30 days, so the 31st and the 1st of the next month cancelled out and
  // came back as the same instant.
  check(
    "the first of a month is not the last of the one before",
    zonedMidnight(2026, 11, 1, TZ).toISOString(),
    "2026-11-01T07:00:00.000Z",
  );
  check(
    "nor after a 31-day month in summer",
    zonedMidnight(2026, 6, 1, TZ).toISOString(),
    "2026-06-01T07:00:00.000Z",
  );
  check(
    "and a new year is a new year",
    zonedMidnight(2027, 1, 1, TZ).toISOString(),
    "2027-01-01T08:00:00.000Z",
  );
  check(
    "a pay week over a month boundary starts on the right Monday",
    startOfWeekMonday(new Date("2026-11-01T12:00:00Z"), TZ).toISOString(),
    "2026-10-26T07:00:00.000Z",
  );

  // --- scope filtering ----------------------------------------------------
  const { jobScopeWhere } = await import("@/lib/scope");
  const { getSessionUser } = await import("@/lib/session");
  void getSessionUser;

  // Assign the tech to one job so OWN scope has something to find.
  await db.jobAssignment.create({
    data: {
      jobId: noProject[0].id,
      userId: tech.id,
      payType: "HOURLY",
      payRate: "45",
      supervisorId: sup.id,
      isLead: true,
    },
  });

  async function countFor(userId: string, scope: "OWN" | "REPORTS" | "PROJECT" | "ALL") {
    const user = {
      id: userId,
      grants: new Map([["job.view", scope]]),
      projectGrants: new Map(),
      scopedProjectIds: userId === sup.id ? [project.id] : [],
    } as never;
    const where = await jobScopeWhere(user, "job.view");
    return where ? db.job.count({ where }) : 0;
  }

  const total = await db.job.count();
  check("tech OWN sees only their own", await countFor(tech.id, "OWN"), 1);
  check("supervisor REPORTS sees the tech's job", await countFor(sup.id, "REPORTS"), 1);
  check(
    "supervisor PROJECT also sees project jobs",
    await countFor(sup.id, "PROJECT"),
    // 1 tech job + 5 project jobs (2 originals, 2 revisits, 1 tz job)
    6,
  );
  check("manager ALL sees everything", await countFor(boss.id, "ALL"), total);

  // --- how far a clock may be moved ----------------------------------------
  //
  // Every branch here is somebody's money, so every boundary is checked from
  // both sides rather than sampled in the middle.
  const { CLOCK_GRACE_MINUTES, clockAuthority, judgeClockEdit } = await import(
    "@/lib/clock-limits"
  );

  const clockAt = (hhmm: string) => new Date(`2026-08-10T${hhmm}:00.000Z`);
  const verdict = (
    authority: Parameters<typeof judgeClockEdit>[0],
    field: "clockIn" | "clockOut",
    from: string,
    to: string,
  ) =>
    judgeClockEdit(authority, {
      field,
      from: clockAt(from),
      to: clockAt(to),
    }).outcome;

  check("an hour is the grace", CLOCK_GRACE_MINUTES, 60);

  check("nobody without the right may touch a clock", verdict("none", "clockOut", "17:00", "16:00"), "refuse");
  check("a tech's change is a request", verdict("suggest", "clockOut", "17:00", "16:55"), "approval");
  check("whoever pays for the time has no limits", verdict("unbounded", "clockOut", "17:00", "23:00"), "allow");

  // The case this exists for: a crew that forgot to clock out and noticed the
  // next morning. Pulling it back can only ever give time away.
  check(
    "the lead may pull a clock-out back as far as it takes",
    verdict("bounded", "clockOut", "23:59", "17:00"),
    "allow",
  );
  check(
    "and further still",
    verdict("bounded", "clockOut", "23:59", "09:00"),
    "allow",
  );

  // Adding is the direction somebody would invent, so it is bounded.
  check("an hour added is allowed", verdict("bounded", "clockOut", "17:00", "18:00"), "allow");
  check("a minute past the hour is not", verdict("bounded", "clockOut", "17:00", "18:01"), "approval");
  check("59 minutes is", verdict("bounded", "clockOut", "17:00", "17:59"), "allow");

  // A clock-in moves either way — arrived earlier than logged, logged on the
  // drive over — so the hour applies in both directions.
  check("an hour earlier on a clock-in", verdict("bounded", "clockIn", "09:00", "08:00"), "allow");
  check("an hour later", verdict("bounded", "clockIn", "09:00", "10:00"), "allow");
  check("further back needs approval", verdict("bounded", "clockIn", "09:00", "07:59"), "approval");
  check("and further forward", verdict("bounded", "clockIn", "09:00", "10:01"), "approval");

  // Saving a form without touching the time must never ask anybody anything.
  check("no change is no question", verdict("suggest", "clockIn", "09:00", "09:00"), "allow");

  // Rank alone does not answer it.
  check(
    "a manager is unbounded",
    clockAuthority({ scope: "ALL", isDirectSupervisor: false, isProjectManager: false, isLead: false, isSupervisor: true }),
    "unbounded",
  );
  check(
    "a supervisor is bounded like the lead",
    clockAuthority({ scope: "PROJECT", isDirectSupervisor: false, isProjectManager: false, isLead: false, isSupervisor: true }),
    "bounded",
  );
  check(
    "until it is their own report's clock, and their own payroll",
    clockAuthority({ scope: "PROJECT", isDirectSupervisor: true, isProjectManager: false, isLead: false, isSupervisor: true }),
    "unbounded",
  );
  check(
    "the project's manager is unbounded on it",
    clockAuthority({ scope: "PROJECT", isDirectSupervisor: false, isProjectManager: true, isLead: false, isSupervisor: false }),
    "unbounded",
  );
  check(
    "a tech leading the job is bounded rather than merely asking",
    clockAuthority({ scope: "OWN", isDirectSupervisor: false, isProjectManager: false, isLead: true, isSupervisor: false }),
    "bounded",
  );
  check(
    "a tech who is not leading asks",
    clockAuthority({ scope: "OWN", isDirectSupervisor: false, isProjectManager: false, isLead: false, isSupervisor: false }),
    "suggest",
  );
  check(
    "and somebody with no right at all cannot",
    clockAuthority({ scope: null, isDirectSupervisor: true, isProjectManager: true, isLead: true, isSupervisor: true }),
    "none",
  );

  // --- what a reviewer is shown --------------------------------------------
  // A single Approve button asks somebody to vouch for a day they did not see,
  // and the only possible answer is yes. These are the things that make it a
  // real question.
  const {
    reviewTimes,
    reviewDeliverables,
    reviewReimbursements,
    reviewWork,
    worst,
  } = await import("@/lib/job-review");

  const nine = new Date("2026-08-11T16:00:00Z");
  const onTime = {
    who: "Terry Tech",
    clockInAt: nine,
    clockOutAt: new Date("2026-08-11T22:00:00Z"),
    paidMinutes: 360,
  };

  check(
    "a job that ran to plan has nothing to say",
    reviewTimes({
      scheduledStart: nine,
      estimateMinutes: 360,
      visits: [onTime],
    }).length,
    0,
  );

  check(
    "arriving half an hour late is worth saying",
    reviewTimes({
      scheduledStart: nine,
      estimateMinutes: 360,
      visits: [{ ...onTime, clockInAt: new Date("2026-08-11T16:35:00Z") }],
    })[0]?.text,
    "Terry Tech checked in 35 minutes after the scheduled start.",
  );
  check(
    "ten minutes is not",
    reviewTimes({
      scheduledStart: nine,
      estimateMinutes: 360,
      visits: [{ ...onTime, clockInAt: new Date("2026-08-11T16:10:00Z") }],
    }).length,
    0,
  );

  check(
    "a day well past the estimate is flagged",
    reviewTimes({
      scheduledStart: nine,
      estimateMinutes: 360,
      visits: [{ ...onTime, paidMinutes: 540 }],
    }).some((flag) => flag.text.includes("against an estimate")),
    true,
  );
  // Averaging would hide this one: 600 and 120 average to exactly the estimate.
  check(
    "one tech well over is not hidden by a colleague who finished early",
    reviewTimes({
      scheduledStart: nine,
      estimateMinutes: 360,
      visits: [
        { ...onTime, paidMinutes: 600 },
        { ...onTime, who: "Sam Super", paidMinutes: 120 },
      ],
    }).filter((flag) => flag.text.includes("against an estimate")).length,
    1,
  );
  // The trap: two techs on a six-hour job book twelve hours between them, and
  // summing them would report every two-hander as overrunning.
  check(
    "two techs on a six-hour job are not over it",
    reviewTimes({
      scheduledStart: nine,
      estimateMinutes: 360,
      visits: [onTime, { ...onTime, who: "Sam Super" }],
    }).length,
    0,
  );

  check(
    "somebody still clocked in is the reviewer's problem now",
    reviewTimes({
      scheduledStart: nine,
      estimateMinutes: 360,
      visits: [{ ...onTime, clockOutAt: null }],
    })[0]?.text,
    "Terry Tech is still clocked in.",
  );
  check(
    "and a job nobody worked cannot be signed off blind",
    reviewTimes({ scheduledStart: nine, estimateMinutes: 360, visits: [] })[0]
      ?.level,
    "warn",
  );

  check(
    "a required section left empty is a warning",
    worst(
      reviewDeliverables({
        sections: [{ label: "Post Install", required: true, filled: false }],
        photoCount: 3,
        hasSignOff: true,
      }),
    ),
    "warn",
  );
  check(
    "an optional one is worth mentioning and no more",
    worst(
      reviewDeliverables({
        sections: [{ label: "Old Serials", required: false, filled: false }],
        photoCount: 3,
        hasSignOff: true,
      }),
    ),
    "note",
  );
  check(
    "a job with no photos at all is a warning",
    reviewDeliverables({
      sections: [{ label: "Post Install", required: true, filled: true }],
      photoCount: 0,
      hasSignOff: true,
    }).some((flag) => flag.level === "warn"),
    true,
  );

  check(
    "money claimed with no receipt is named",
    reviewReimbursements({
      entries: [
        { label: "Parking", amount: 12, hasReceipt: false },
        { label: "Cat 6A", amount: 3, hasReceipt: true },
      ],
    })[0]?.text,
    "No receipt: Parking.",
  );

  check(
    "an empty report is the one thing that must not go out",
    reviewWork({ merged: null, entries: [{ who: "Terry Tech", text: "  " }] })[0]
      ?.text,
    "Nothing written. The client report would go out empty.",
  );
  check(
    "one tech writing nothing is mentioned once the others have",
    worst(
      reviewWork({
        merged: null,
        entries: [
          { who: "Terry Tech", text: "Swapped the switch." },
          { who: "Sam Super", text: null },
        ],
      }),
    ),
    "note",
  );
  check(
    "and a merged summary settles it",
    reviewWork({
      merged: "Swapped the switch and relabelled the leads.",
      entries: [{ who: "Sam Super", text: null }],
    }).length,
    0,
  );

  // --- passwords for the people who are not in NextCloud -------------------
  const {
    hashPassword,
    verifyPassword,
    needsRehash,
    passwordProblem,
    newSetupToken,
    hashSetupToken,
    lockoutUntil,
    lockRemaining,
    MAX_FAILED_SIGN_INS,
  } = await import("@/lib/password");

  const secret = "correct horse battery staple";
  const hashed = await hashPassword(secret);

  check("a hash carries its own parameters", hashed.startsWith("scrypt$32768$8$1$"), true);
  check("the right password verifies", await verifyPassword(secret, hashed), true);
  check(
    "a wrong one does not",
    await verifyPassword("correct horse battery stapl", hashed),
    false,
  );
  check("and neither does nothing at all", await verifyPassword(secret, null), false);
  // Two people choosing the same password must not be visible as such in the
  // database, which is what the salt is for.
  check(
    "the same password hashes differently every time",
    (await hashPassword(secret)) === hashed,
    false,
  );
  check("today's parameters need no rehash", needsRehash(hashed), false);
  check(
    "yesterday's do",
    needsRehash(hashed.replace("scrypt$32768", "scrypt$16384")),
    true,
  );
  check(
    "a hash from something else entirely is refused rather than trusted",
    await verifyPassword(secret, "$2b$10$notascrypthashatall"),
    false,
  );

  check("a short password is refused", passwordProblem("hunter2") !== null, true);
  check("a long one is not", passwordProblem(secret), null);

  const issued = newSetupToken();
  check(
    "a link is stored only as its hash",
    issued.tokenHash === hashSetupToken(issued.token) && issued.tokenHash !== issued.token,
    true,
  );
  check(
    "and the hash gives nothing back",
    issued.tokenHash.includes(issued.token.slice(0, 8)),
    false,
  );

  check(
    "a few wrong answers do not lock anybody out",
    lockoutUntil(MAX_FAILED_SIGN_INS - 1),
    null,
  );
  check(
    "enough of them do",
    lockRemaining(lockoutUntil(MAX_FAILED_SIGN_INS)) > 0,
    true,
  );
  check(
    "and a lock that has passed is not a lock",
    lockRemaining(new Date(Date.now() - 60_000)),
    0,
  );

  // --- a clock-out cannot land before its clock-in --------------------------
  const { clockOrderProblem } = await import("@/lib/clock-limits");

  check(
    "an ordinary day is fine",
    clockOrderProblem(
      new Date("2026-08-11T16:00:00Z"),
      new Date("2026-08-11T23:00:00Z"),
    ),
    null,
  );
  check(
    "a still-open visit is fine too",
    clockOrderProblem(new Date("2026-08-11T16:00:00Z"), null),
    null,
  );
  // visitTotals clamps a negative span to zero, so this pays nothing and says
  // nothing — the failure is entirely silent without a guard.
  check(
    "a clock-out before the clock-in is refused",
    clockOrderProblem(
      new Date("2026-08-11T16:00:00Z"),
      new Date("2026-08-11T15:00:00Z"),
    ) !== null,
    true,
  );
  check(
    "and so is one exactly on it",
    clockOrderProblem(
      new Date("2026-08-11T16:00:00Z"),
      new Date("2026-08-11T16:00:00Z"),
    ) !== null,
    true,
  );

  // --- why a punch was touched ---------------------------------------------
  // Free text produced "fixed", "per John", and forty spellings of "forgot to
  // clock out": unreadable a month later and unaddable-up ever.
  const {
    reasonsFor,
    punchReasonProblem,
    noteRequired,
    describeReason,
    reasonLabel,
  } = await import("@/lib/punch-reasons");

  check("adjusting offers twelve reasons", reasonsFor("adjust").length, 12);
  check("removing offers eighteen", reasonsFor("remove").length, 18);
  check("and adding offers four", reasonsFor("add").length, 4);
  check(
    "the lists are not the same one three times",
    reasonsFor("add").some((entry) => entry.code.includes("Job Cancelled")),
    false,
  );

  check(
    "a reason from the right list is accepted",
    punchReasonProblem("adjust", "QuickTec/Forgot to punch", null),
    null,
  );
  check(
    "one from another list is not",
    punchReasonProblem("adjust", "QuickTec/Job Cancelled", null) !== null,
    true,
  );
  check(
    "and neither is something somebody made up",
    punchReasonProblem("remove", "because", null) !== null,
    true,
  );
  check(
    "no reason at all is refused",
    punchReasonProblem("adjust", "", "a note"),
    "Choose a reason.",
  );

  // Other says none of the reasons fit, so the note is the only record of what
  // did — without it the list has bought nothing.
  check("Other needs a note", noteRequired("Client/Other"), true);
  check("and the named ones do not", noteRequired("Client/Unapproved OE"), false);
  check(
    "Other without one is refused",
    punchReasonProblem("remove", "Client/Other", "   ") !== null,
    true,
  );
  check(
    "Other with one is fine",
    punchReasonProblem("remove", "Client/Other", "Site flooded"),
    null,
  );

  check(
    "a reason and its note read as one line",
    describeReason("Client/Other", "Site flooded"),
    "Client/Other — Site flooded",
  );
  check(
    "and a reason on its own reads as itself",
    describeReason("QuickTec/Forgot to punch", null),
    "QuickTec/Forgot to punch",
  );
  // The company renames itself; the stored codes must not follow.
  check(
    "the picker shows the company's own name",
    reasonLabel(reasonsFor("adjust")[0], "417 Group"),
    "417 Group · Adjust to time worked",
  );

  // --- what happened to one punch ------------------------------------------
  // The job's timeline answers "what happened on this job"; this answers "why
  // does this clock say what it says", which is what payroll asks.
  const { buildPunchHistory } = await import("@/lib/punch-history");

  const fmt = {
    time: (value: string | Date) =>
      new Intl.DateTimeFormat("en-US", {
        timeZone: "UTC",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      }).format(value instanceof Date ? value : new Date(value)),
    minutes: (from: string | Date, to: string | Date) =>
      Math.round(
        ((to instanceof Date ? to : new Date(to)).getTime() -
          (from instanceof Date ? from : new Date(from)).getTime()) /
          60_000,
      ),
  };

  const acted = new Date("2026-08-11T15:27:00Z");
  const rows = buildPunchHistory(
    [
      {
        id: "a",
        action: "clock_in",
        createdAt: acted,
        actorName: "Anton Kyshnar",
        detail: { at: "2026-08-11T16:30:00Z" },
      },
      {
        id: "b",
        action: "break_end",
        createdAt: acted,
        actorName: "Anton Kyshnar",
        detail: { at: "2026-08-11T18:00:00Z", minutes: 30 },
      },
      {
        id: "c",
        action: "punch_changed",
        createdAt: acted,
        actorName: "Volodymyr Knyazev",
        detail: {
          reason: "QuickTec/Adjust to time worked",
          fromIn: "2026-08-11T16:30:00Z",
          toIn: "2026-08-11T16:45:00Z",
          fromOut: "2026-08-11T22:10:00Z",
          toOut: "2026-08-11T22:10:00Z",
        },
      },
      {
        id: "d",
        action: "time_added",
        createdAt: acted,
        actorName: "Anton Kyshnar",
        detail: {
          reason: "QuickTec/Forgot to punch",
          from: "2026-08-11T16:30:00Z",
          to: "2026-08-11T18:30:00Z",
        },
      },
    ],
    fmt,
  );

  check("a clock-in reads as the time it records", rows[0].suffix, "4:30 PM");
  // The moment somebody acted is not the time being written about, and a
  // history that shows only one of them cannot answer what it exists for.
  check("with who did it and when", `by ${rows[0].by} @ ${rows[0].at}`,
    "by Anton Kyshnar @ 3:27 PM");
  check("a break carries how long it ran", rows[1].suffix, "6:00 PM · 30 min");

  check("a change reads as before and after", rows[2].changes.length, 1);
  check(
    "naming the clock that moved",
    `${rows[2].changes[0].label} ${rows[2].changes[0].from} → ${rows[2].changes[0].to}`,
    "Clock In 4:30 PM → 4:45 PM",
  );
  // Listing the clock that did not move is noise dressed as detail.
  check(
    "and not the one that did not",
    rows[2].changes.some((change) => change.label === "Clock Out"),
    false,
  );
  check("carrying the reason", rows[2].reason, "QuickTec/Adjust to time worked");

  check(
    "an added punch reads as a span with its length",
    rows[3].suffix,
    "4:30 PM → 6:30 PM (2.00 hrs)",
  );

  // Every line gets a picture, and none of them falls through to the shrug.
  check(
    "every line names its own icon",
    rows.map((row) => row.icon).join(","),
    "in,breakEnd,changed,added",
  );

  // The day in the order it was lived, whichever order the rows arrived in.
  const shuffled = buildPunchHistory(
    [
      {
        id: "out",
        action: "clock_out",
        createdAt: new Date("2026-08-11T22:10:00Z"),
        actorName: "Anton Kyshnar",
        detail: { at: "2026-08-11T22:10:00Z" },
      },
      {
        id: "bs",
        action: "break_start",
        createdAt: new Date("2026-08-11T17:30:00Z"),
        actorName: "Anton Kyshnar",
        detail: { at: "2026-08-11T17:30:00Z" },
      },
      {
        id: "in",
        action: "clock_in",
        createdAt: new Date("2026-08-11T16:30:00Z"),
        actorName: "Anton Kyshnar",
        detail: { at: "2026-08-11T16:30:00Z" },
      },
      {
        id: "be",
        action: "break_end",
        createdAt: new Date("2026-08-11T18:00:00Z"),
        actorName: "Anton Kyshnar",
        detail: { at: "2026-08-11T18:00:00Z", minutes: 30 },
      },
    ],
    fmt,
  );
  check(
    "the history reads in the order the day happened",
    shuffled.map((row) => row.id).join(","),
    "in,bs,be,out",
  );
  // How long a break ran is only known when it ends, so the line that says it
  // started can only carry it by looking forward — and that is the line
  // somebody reads first.
  check("a break says how long it ran from the moment it starts",
    shuffled[1].suffix, "5:30 PM · 30 min");

  // A removal is recorded about a punch that has stopped existing; if it is
  // filed under the dead row nobody can ever look it up again.
  const removed = buildPunchHistory(
    [
      {
        id: "r",
        action: "time_removed",
        createdAt: acted,
        actorName: "Volodymyr Knyazev",
        detail: {
          reason: "RepCompany/Job Cancelled",
          from: "2026-08-11T16:30:00Z",
          to: "2026-08-11T22:10:00Z",
        },
      },
    ],
    fmt,
  );
  check("a removal says so plainly", removed[0].title, "Punch Removed");
  check("with the day it took away", removed[0].suffix, "4:30 PM → 10:10 PM");
  check("and why", removed[0].reason, "RepCompany/Job Cancelled");

  // An edit that moved one end and one that moved both are different events,
  // and a record that prints all four times either way cannot tell them apart.
  const oneEnd = buildPunchHistory(
    [
      {
        id: "one",
        action: "punch_changed",
        createdAt: acted,
        actorName: "Volodymyr Knyazev",
        detail: {
          reason: "QuickTec/Adjust to time worked",
          fromOut: "2026-08-11T22:10:00Z",
          toOut: "2026-08-11T22:30:00Z",
        },
      },
    ],
    fmt,
  )[0];
  check("moving one end lists that end alone", oneEnd.changes.length, 1);
  check(
    "and names it",
    `${oneEnd.changes[0].label} ${oneEnd.changes[0].from} → ${oneEnd.changes[0].to}`,
    "Clock Out 10:10 PM → 10:30 PM",
  );

  const bothEnds = buildPunchHistory(
    [
      {
        id: "both",
        action: "punch_changed",
        createdAt: acted,
        actorName: "Volodymyr Knyazev",
        detail: {
          reason: "QuickTec/Adjust to time worked",
          fromIn: "2026-08-11T16:30:00Z",
          toIn: "2026-08-11T16:45:00Z",
          fromOut: "2026-08-11T22:10:00Z",
          toOut: "2026-08-11T22:30:00Z",
        },
      },
    ],
    fmt,
  )[0];
  check("moving both lists both", bothEnds.changes.length, 2);
  // A punch is read arrival first, so it is written that way too.
  check(
    "arrival first",
    bothEnds.changes.map((change) => change.label).join(","),
    "Clock In,Clock Out",
  );

  // Breaks are pay as much as the clocks are. An edit that rewrote somebody's
  // unpaid half hour and left the clocks alone used to leave a heading with
  // nothing under it.
  const breakEdit = buildPunchHistory(
    [
      {
        id: "brk",
        action: "punch_changed",
        createdAt: acted,
        actorName: "Volodymyr Knyazev",
        detail: {
          reason: "QuickTec/Error/App",
          fromBreaks: 2,
          toBreaks: 1,
        },
      },
    ],
    fmt,
  )[0];
  check("a break-only edit still says what it did", breakEdit.changes.length, 1);
  check(
    "counted rather than listed",
    `${breakEdit.changes[0].label} ${breakEdit.changes[0].from} → ${breakEdit.changes[0].to}`,
    "Breaks 2 breaks → 1 break",
  );
  check(
    "and the same number rewritten reads as that",
    buildPunchHistory(
      [
        {
          id: "brk2",
          action: "punch_changed",
          createdAt: acted,
          actorName: "V",
          detail: { fromBreaks: 1, toBreaks: 1 },
        },
      ],
      fmt,
    )[0].changes[0].to,
    "rewritten",
  );

  // Rows written before any of that was kept. A heading with nothing beneath
  // it reads as a bug rather than as an old record.
  check(
    "an adjustment with nothing recorded says so",
    buildPunchHistory(
      [
        {
          id: "bare",
          action: "punch_changed",
          createdAt: acted,
          actorName: "V",
          detail: { reason: "QuickTec/Other — checked" },
        },
      ],
      fmt,
    )[0].suffix,
    "details not recorded",
  );

  // A request and the answer to it are one event seen from both ends.
  const pair = buildPunchHistory(
    [
      {
        id: "e",
        action: "punch_change_requested",
        createdAt: acted,
        actorName: "Anton Kyshnar",
        detail: { fromIn: "2026-08-11T16:30:00Z", toIn: "2026-08-11T16:45:00Z" },
      },
      {
        id: "f",
        action: "punch_change_denied",
        createdAt: acted,
        actorName: "Volodymyr Knyazev",
        detail: {
          denial: "The site opened on time that day",
          fromIn: "2026-08-11T16:30:00Z",
          toIn: "2026-08-11T16:45:00Z",
        },
      },
    ],
    fmt,
  );
  check("a request and its answer are marked as one thing", pair.every((row) => row.paired), true);
  check("a denial carries the sentence somebody wrote", pair[1].denial,
    "The site opened on time that day");
  check("and a request on its own is not", 
    buildPunchHistory([{ id: "g", action: "punch_change_requested", createdAt: acted, actorName: "A", detail: {} }], fmt)[0].paired,
    false);

  // --- phone numbers -------------------------------------------------------
  const { formatPhone, formatPhoneAsTyped, telHref } = await import("@/lib/phone");

  check("ten digits get their dashes", formatPhone("5551234567"), "555-123-4567");
  check(
    "however they were typed",
    formatPhone(" (555) 123 4567 "),
    "555-123-4567",
  );
  check(
    "a country code survives in front",
    formatPhone("15551234567"),
    "1-555-123-4567",
  );
  // Reshaping these would lose something. An extension is not punctuation.
  check("an extension is left alone", formatPhone("555-123-4567 x203"), "555-123-4567 x203");
  check("an international number is left alone", formatPhone("+380671234567"), "+380671234567");
  check("and so is anything too short to be a number", formatPhone("911"), "911");
  check("nothing is nothing", formatPhone(null), "");

  // Typing: the dashes appear once there is enough to place them, so they do
  // not fight the thumb on the first three digits.
  check("no dashes until there are enough digits", formatPhoneAsTyped("55512"), "55512");
  check("then they appear", formatPhoneAsTyped("5551234567"), "555-123-4567");

  check("a phone dials the digits, not the dashes", telHref("555-123-4567"), "tel:5551234567");
  check("and keeps a plus where there is one", telHref("+380671234567"), "tel:+380671234567");

  // --- ticket numbers ------------------------------------------------------
  const { jobTickets, ticketList, ticketRole } = await import("@/lib/tickets");

  check("no ticket at all reads as nothing", ticketList({ ticketNumber: null }), null);
  check(
    "one ticket is just itself",
    ticketList({ ticketNumber: "S-1", extraTickets: [] }),
    "S-1",
  );
  check(
    "two are comma separated, primary first",
    ticketList({
      ticketNumber: "S-1",
      extraTickets: [{ number: "S-2", order: 0 }],
    }),
    "S-1, S-2",
  );
  check(
    "and they keep the order they were added in, not the order they arrive",
    ticketList({
      ticketNumber: "S-1",
      extraTickets: [
        { number: "S-3", order: 1 },
        { number: "S-2", order: 0 },
      ],
    }),
    "S-1, S-2, S-3",
  );
  check(
    "a blank primary does not leave a leading comma",
    ticketList({
      ticketNumber: "   ",
      extraTickets: [{ number: "S-2", order: 0 }],
    }),
    "S-2",
  );
  check(
    "the secondary is the second one",
    jobTickets({ ticketNumber: "S-1", extraTickets: [{ number: "S-2", order: 0 }] })[1],
    "S-2",
  );
  check("what they are called", `${ticketRole(0)}/${ticketRole(1)}/${ticketRole(2)}`, "Primary/Secondary/Ticket 3");


  // --- what a job has to produce -------------------------------------------
  const { effectiveRules, resolveDeliverableRules, ruleKey, ruleSheet } =
    await import("@/lib/deliverables");

  const sectionsOn = (rules: { category: string }[]) =>
    rules.map((rule) => rule.category).join(",");

  check(
    "a job with no rules of its own follows its project",
    sectionsOn(
      resolveDeliverableRules(
        [],
        [
          {
            category: "PRE_INSTALL",
            customLabel: null,
            enabled: true,
            required: true,
            requiresPhoto: true,
            requiresText: false,
            order: 0,
          },
          {
            category: "OLD_SERIALS",
            customLabel: null,
            enabled: true,
            required: false,
            requiresPhoto: false,
            requiresText: true,
            order: 5,
          },
        ],
      ),
    ),
    "PRE_INSTALL,OLD_SERIALS",
  );
  check(
    "a job with nothing anywhere still asks for the two that always apply",
    sectionsOn(resolveDeliverableRules([], [])),
    "PRE_INSTALL,POST_INSTALL",
  );
  // Nine fixed sections are always offered; a custom one exists only once
  // somebody has made it, and a job may hold several.
  check(
    "every fixed section is offered for editing, not just the saved ones",
    ruleSheet([]).length,
    9,
  );

  const twoCustom = ruleSheet([
    {
      category: "CUSTOM",
      customLabel: "Rack elevation",
      enabled: true,
      required: false,
      requiresPhoto: true,
      requiresText: false,
    },
    {
      category: "CUSTOM",
      customLabel: "Cable route",
      enabled: true,
      required: true,
      requiresPhoto: true,
      requiresText: false,
    },
  ]);
  // The bug this fixes: there was room for one, so the second name overwrote
  // the first and a job could never ask for both.
  check("a job can hold several custom sections", twoCustom.length, 11);
  check(
    "each keeping its own name and its own settings",
    twoCustom
      .filter((rule) => rule.category === "CUSTOM")
      .map((rule) => `${rule.customLabel}:${rule.required}`)
      .join(", "),
    "Cable route:true, Rack elevation:false",
  );
  check(
    "and they are told apart by name, not by category",
    ruleKey({ category: "CUSTOM", customLabel: "Cable route" }),
    "CUSTOM:Cable route",
  );
  check(
    "an untouched section is off, and carries the settings it would get",
    (() => {
      const serials = ruleSheet([]).find(
        (rule) => rule.category === "NEW_SERIALS",
      )!;
      return `${serials.enabled}/${serials.requiresText}/${serials.requiresPhoto}`;
    })(),
    "false/true/false",
  );

  // The trap this guards: job rows win outright over the project's, so saving
  // one section on its own would leave the job asking for that section and
  // nothing else. Which is why the whole sheet is written before the first
  // edit lands, and why this checks the sheet rather than the one row.
  const jobSheet = ruleSheet(
    effectiveRules(
      [],
      [
        {
          category: "PRE_INSTALL",
          customLabel: null,
          enabled: true,
          required: true,
          requiresPhoto: true,
          requiresText: false,
          order: 0,
        },
      ],
    ).map((rule) =>
      rule.category === "ISSUES" ? { ...rule, enabled: true } : rule,
    ),
  );
  check(
    "switching a section on for one job keeps what the project already asked for",
    sectionsOn(resolveDeliverableRules(jobSheet, [])),
    "PRE_INSTALL,ISSUES",
  );

  // --- who may raise a job, and who may wave their own through -------------
  //
  // The rule lives in one line of createJob: a job needs approval when its
  // author cannot approve reports. That reads as an implementation detail and
  // is in fact the whole policy — a tech's ad-hoc job waits for a supervisor,
  // and anybody who could approve it afterwards may as well raise it approved.
  const { DEFAULT_ROLE_GRANTS } = await import("@/lib/permissions");
  const { can } = await import("@/lib/session");

  function asRole(role: keyof typeof DEFAULT_ROLE_GRANTS) {
    return {
      id: "who",
      grants: new Map(Object.entries(DEFAULT_ROLE_GRANTS[role])),
      projectGrants: new Map(),
      scopedProjectIds: [],
    } as never;
  }

  const roles = ["TECH", "SUPERVISOR", "MANAGER", "ADMINISTRATOR"] as const;
  for (const role of roles) {
    const user = asRole(role);
    const raises = can(user, "job.create");
    const approves = can(user, "job.approve_report");
    console.log(
      `      ${role.padEnd(14)} create=${raises} approve=${approves} ` +
        `-> ${approves ? "SCHEDULED" : "PENDING_APPROVAL"}`,
    );
  }

  check("a tech may raise a job", can(asRole("TECH"), "job.create"), true);
  check(
    "but not wave it through — it waits for somebody",
    can(asRole("TECH"), "job.approve_report"),
    false,
  );

  check("a supervisor may raise a job", can(asRole("SUPERVISOR"), "job.create"), true);
  check(
    "and it needs no approval, because they could give it",
    can(asRole("SUPERVISOR"), "job.approve_report"),
    true,
  );

  check("a manager may raise a job", can(asRole("MANAGER"), "job.create"), true);

  // Deliberate, and worth stating so it does not read as an oversight: the
  // administrator role manages accounts, settings and integrations, and sees
  // everything, but does not run work. Whoever hands out the logins is not
  // thereby the person who dispatches the crew.
  check(
    "an administrator does not raise jobs",
    can(asRole("ADMINISTRATOR"), "job.create"),
    false,
  );
  check(
    "though they can see every one",
    can(asRole("ADMINISTRATOR"), "job.view"),
    true,
  );
  check(
    "and approve one, including their own",
    can(asRole("MANAGER"), "job.approve_report"),
    true,
  );

  // The same, through the rule as createJob computes it, so the two cannot
  // drift apart without this failing.
  const needsApproval = (role: (typeof roles)[number]) =>
    !can(asRole(role), "job.approve_report");
  check("a tech's job lands pending", needsApproval("TECH"), true);
  check("a supervisor's does not", needsApproval("SUPERVISOR"), false);
  check("nor a manager's", needsApproval("MANAGER"), false);

  // Approval is of a job, not of a person: nothing stops the author being the
  // approver, which is exactly what a manager raising their own job needs.
  const selfApproved = await db.job.create({
    data: {
      intWoId: `SELF-${Date.now()}`,
      intWoSequence: 8888,
      title: "Raised and approved by the same person",
      clientId: client.id,
      customerId: customer.id,
      siteId: site.id,
      createdById: boss.id,
      lifecycle: "PENDING_APPROVAL",
    },
    select: { id: true },
  });
  await db.job.update({
    where: { id: selfApproved.id },
    data: { lifecycle: "SCHEDULED", approvedById: boss.id, approvedAt: new Date() },
  });
  const reread = await db.job.findUniqueOrThrow({
    where: { id: selfApproved.id },
    select: { createdById: true, approvedById: true, lifecycle: true },
  });
  check(
    "a manager can be both author and approver",
    reread.createdById === reread.approvedById && reread.lifecycle === "SCHEDULED",
    true,
  );

  // --- time and earnings --------------------------------------------------
  const {
    assignmentTotals,
    earnings,
    jobSpan,
    visitTotals,
    clockOptions,
  } = await import("@/lib/time-tracking");

  const at = (hhmm: string) => `2026-07-28T${hhmm}:00Z`;

  const withUnpaidBreak = visitTotals({
    clockInAt: at("09:00"),
    clockOutAt: at("17:00"),
    breaks: [{ startAt: at("12:00"), endAt: at("12:30"), paid: false }],
  });
  check("8h visit is 480 onsite minutes", withUnpaidBreak.onsiteMinutes, 480);
  check("unpaid break comes off pay", withUnpaidBreak.paidMinutes, 450);

  const withPaidBreak = visitTotals({
    clockInAt: at("09:00"),
    clockOutAt: at("17:00"),
    breaks: [{ startAt: at("12:00"), endAt: at("12:30"), paid: true }],
  });
  check("paid break does not reduce pay", withPaidBreak.paidMinutes, 480);

  // A break left running is clipped at the clock-out, not left to grow.
  const openBreak = visitTotals(
    {
      clockInAt: at("09:00"),
      clockOutAt: at("10:00"),
      breaks: [{ startAt: at("09:30"), endAt: null, paid: false }],
    },
    new Date(at("23:00")),
  );
  check("open break is clipped to the visit", openBreak.paidMinutes, 30);

  const twoVisits = assignmentTotals([
    { clockInAt: at("08:00"), clockOutAt: at("10:00"), breaks: [] },
    { clockInAt: at("13:00"), clockOutAt: at("15:30"), breaks: [] },
  ]);
  check("visits add up", twoVisits.paidMinutes, 270);

  // The client is billed earliest-in to latest-out across the whole crew, even
  // though each tech is paid only for their own hours.
  const crew = jobSpan([
    { clockInAt: at("08:00"), clockOutAt: at("12:00"), breaks: [] },
    { clockInAt: at("09:00"), clockOutAt: at("16:00"), breaks: [] },
  ]);
  check("job span starts at the earliest arrival", crew.onsiteAt?.toISOString(), at("08:00").replace("Z", ".000Z"));
  check("job span ends at the latest departure", crew.offsiteAt?.toISOString(), at("16:00").replace("Z", ".000Z"));
  check("job span is 8.00 hrs", (crew.totalMinutes / 60).toFixed(2), "8.00");

  check("hourly earnings", earnings("HOURLY", 45, 450).toFixed(2), "337.50");
  check("flat pays once", earnings("FLAT", 250, 450).toFixed(2), "250.00");
  check("non-billable pays nothing", earnings("NON_BILLABLE", 45, 450), 0);

  // Offsets hang off the snapped time, not the raw clock.
  const options = clockOptions(new Date(at("09:57")), 5);
  check(
    "clock options are snapped",
    options.map((option) => option.at.toISOString().slice(11, 16)).join(" "),
    "09:50 09:55 10:00 10:05 10:10",
  );

  // --- scope of work ------------------------------------------------------
  const { parseMarkdown, checklistKeys } = await import("@/lib/markdown");

  const scope = "- [ ] Swap the switch\n- [x] Label the leads\n- Plain item";
  const keys = checklistKeys(scope);
  check("only checklist lines get keys", keys.length, 2);
  check(
    "keys survive an edit elsewhere in the document",
    checklistKeys(`## Heading\n\n${scope}\n\nSome trailing note.`).join(","),
    keys.join(","),
  );

  const blocks = parseMarkdown(
    '<script>alert(1)</script> **bold** <b>ok</b> <span style="color:red">red</span> <span style="color:url(x)">bad</span>',
  );
  const rendered = blocks.map((block) => ("html" in block ? block.html : "")).join("");
  check("script tags are inert", rendered.includes("<script"), false);
  check("escaped script is visible as text", rendered.includes("&lt;script&gt;"), true);
  check("markdown emphasis works", rendered.includes("<strong>bold</strong>"), true);
  check("allowlisted tags survive", rendered.includes("<b>ok</b>"), true);
  check("safe colour survives", rendered.includes('<span style="color:red">'), true);
  check("unsafe colour is refused", rendered.includes("url(x)") && !rendered.includes('style="color:url'), true);

  const link = parseMarkdown(
    "[ok](https://example.com) [bad](javascript:alert(1)) [worse](data:text/html,x)",
  );
  const linkHtml = link.map((block) => ("html" in block ? block.html : "")).join("");
  check("http links render", linkHtml.includes('href="https://example.com"'), true);

  // A refused scheme must not become an href at all. The bracket syntax is
  // left as visible text, which is inert.
  const hrefs = [...linkHtml.matchAll(/href="([^"]*)"/g)].map((match) => match[1]);
  check(
    "every href uses an allowed scheme",
    hrefs.every((href) => /^(https?:\/\/|mailto:|tel:)/i.test(href)),
    true,
  );
  check("refused links stay as plain text", linkHtml.includes("[bad]("), true);

  // --- photo pipeline -----------------------------------------------------
  const sharpLib = (await import("sharp")).default;
  const { processImage, isHeic, isPdf, watermarkText } = await import(
    "@/lib/images"
  );

  const bigJpeg = await sharpLib({
    create: { width: 4032, height: 3024, channels: 3, background: "#224466" },
  })
    .jpeg()
    .toBuffer();

  const plain = await processImage(bigJpeg, "image/jpeg", null);
  check("output is always JPEG", plain.mimeType, "image/jpeg");
  check("oversized photo is scaled to the long edge", plain.width, 2400);
  check("aspect ratio is kept", plain.height, 1800);
  check("no stamp when none is asked for", plain.watermarked, false);

  const stamp = watermarkText({
    date: "2026-07-28",
    assignmentId: "887766",
    customerCode: "SBUX",
    siteNumber: "24541",
  });
  check("stamp text", stamp, "2026-07-28-887766-SBUX-#24541");

  const stamped = await processImage(bigJpeg, "image/jpeg", stamp);
  check("stamp is recorded", stamped.watermarked, true);

  // The stamp sits bottom-right, so that corner must differ from the flat
  // original while the top-left is untouched.
  const corner = async (image: Buffer, left: number, top: number) =>
    (
      await sharpLib(image)
        .extract({ left, top, width: 60, height: 30 })
        .raw()
        .toBuffer()
    ).toString("hex");

  check(
    "bottom-right corner changed",
    (await corner(stamped.data, 2400 - 200, 1800 - 60)) !==
      (await corner(plain.data, 2400 - 200, 1800 - 60)),
    true,
  );
  check(
    "top-left corner untouched",
    (await corner(stamped.data, 10, 10)) === (await corner(plain.data, 10, 10)),
    true,
  );

  // HEIF container: what an iPhone sends, minus the HEVC codec this build
  // cannot encode. Exercises detection and the sharp decode path.
  const heif = await sharpLib(bigJpeg).heif({ compression: "av1" }).toBuffer();
  check("HEIF is detected from its magic bytes", isHeic("application/octet-stream", heif), true);
  check("JPEG is not mistaken for HEIF", isHeic("image/jpeg", bigJpeg), false);

  const fromHeif = await processImage(heif, "image/heic", null);
  check("HEIF converts to JPEG", fromHeif.mimeType, "image/jpeg");
  check("converted image keeps its size", fromHeif.width, 2400);

  const pdf = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n");
  check("PDF is recognised", isPdf("application/pdf", pdf), true);
  const passthrough = await processImage(pdf, "application/pdf", stamp);
  check("PDF passes through untouched", passthrough.data.equals(pdf), true);
  check("PDF is never stamped", passthrough.watermarked, false);

  // EXIF is read before conversion strips it — the timestamp and fix are the
  // only evidence a photo was taken on site. sharp cannot write a GPS IFD, so
  // the conversion is tested directly and the pipeline is checked for not
  // inventing coordinates.
  const { gpsToDecimal } = await import("@/lib/images");

  check(
    "north latitude is positive",
    gpsToDecimal([47, 36, 55.8], "N")?.toFixed(4),
    "47.6155",
  );
  check(
    "west longitude is negative",
    gpsToDecimal([122, 20, 15.6], "W")?.toFixed(4),
    "-122.3377",
  );
  check("south latitude is negative", gpsToDecimal([33, 51, 54], "S")?.toFixed(2), "-33.87");
  check("missing GPS gives null", gpsToDecimal(undefined, "N"), null);
  check("malformed GPS gives null", gpsToDecimal([47], "N"), null);

  check("a photo with no GPS reports none", plain.gpsLat, null);
  check("a photo with no timestamp reports none", plain.capturedAt, null);

  // --- storage ------------------------------------------------------------
  const { storeFile, deleteFile, fileExists, absolutePath } = await import(
    "@/lib/storage"
  );

  const stored = await storeFile("test-job", Buffer.from("hello"), "image/jpeg");
  check("stored under the job", stored.storagePath.startsWith("jobs/test-job/"), true);
  check("stored with a jpg extension", stored.storagePath.endsWith(".jpg"), true);
  check("file is on disk", await fileExists(stored.storagePath), true);
  await deleteFile(stored.storagePath);
  check("file is gone", await fileExists(stored.storagePath), false);

  let escaped = false;
  try {
    absolutePath("../../etc/passwd");
  } catch {
    escaped = true;
  }
  check("path traversal is refused", escaped, true);

  // --- exports ------------------------------------------------------------
  const { loadJobForExport } = await import("@/lib/exports/job-data");
  const { buildTextReport } = await import("@/lib/exports/text-report");
  const { buildJobZip, zipFileName, reportFileName } = await import(
    "@/lib/exports/job-zip"
  );
  const { buildWorkOrderPdf } = await import("@/lib/exports/work-order-pdf");

  // A job with everything the template can carry, so the golden output below
  // exercises every branch rather than a happy path.
  const exportJob = await db.job.create({
    data: {
      ...base,
      intWoId: "2026-07-PRJ12-9001",
      intWoSequence: 9001,
      title: "Register Refresh",
      projectId: project.id,
      externalAssignmentId: "887766",
      ticketNumber: "INC0099123",
      incNumber: "SECRET-INTERNAL",
      releaseCode: "RLS-4417",
      outcome: "COMPLETED",
      internalStatus: "REVISIT_REQUIRED",
      scopeOfWork: "- [ ] Swap the switch",
    },
  });

  const leadAssignment = await db.jobAssignment.create({
    data: {
      jobId: exportJob.id,
      userId: sup.id,
      isLead: true,
      payType: "HOURLY",
      payRate: "65",
      workPerformed: "Ran the crew, verified uplinks.",
    },
  });
  const techAssignment = await db.jobAssignment.create({
    data: {
      jobId: exportJob.id,
      userId: tech.id,
      payType: "HOURLY",
      payRate: "45",
      workPerformed: "Swapped the switch and relabelled the leads.",
    },
  });

  // Supervisor 08:00-16:00, tech 09:00-12:00: the client is billed the outer
  // span, 08:00 to 16:00.
  await db.visit.create({
    data: {
      assignmentId: leadAssignment.id,
      clockInAt: new Date("2026-07-28T15:00:00Z"),
      clockOutAt: new Date("2026-07-28T23:00:00Z"),
    },
  });
  await db.visit.create({
    data: {
      assignmentId: techAssignment.id,
      clockInAt: new Date("2026-07-28T16:00:00Z"),
      clockOutAt: new Date("2026-07-28T19:00:00Z"),
    },
  });

  await db.pointOfContact.createMany({
    data: [
      { jobId: exportJob.id, type: "MOD", name: "Dana Reyes", order: 0 },
      { jobId: exportJob.id, type: "MOD", name: "Chris Vale", order: 1 },
      { jobId: exportJob.id, type: "NOC", name: "Priya Anand" },
    ],
  });

  await db.reimbursement.createMany({
    data: [
      { jobId: exportJob.id, type: "MATERIAL", label: "Cat 6A 3Ft", amount: "3.00" },
      { jobId: exportJob.id, type: "MATERIAL", label: "Wall Plate", amount: "8.99" },
      { jobId: exportJob.id, type: "PARKING", amount: "12.00" },
      { jobId: exportJob.id, type: "TOLL", amount: "6.50" },
      // Internal only: this must not reach the client-facing report.
      { jobId: exportJob.id, type: "HOTEL", label: "Holiday Inn", amount: "154.00" },
    ],
  });

  await db.deliverableItem.create({
    data: {
      jobId: exportJob.id,
      assignmentId: techAssignment.id,
      category: "RETURN_LABELS",
      textValue: "1Z999AA10123456784",
    },
  });

  const exportData = (await loadJobForExport(exportJob.id))!;
  const report = buildTextReport(exportData);

  const expected = [
    "Tech name: Sam Super, Terry Tech",
    "Assignment ID: 887766",
    "Site name & ID: SBUX #24541",
    "Address: 1912 Pike Pl, Seattle, WA 98101",
    "Buyer/Representing company: NetCom Sub",
    "Onsite (Check in): 8:00 AM",
    "Offsite (Check out): 4:00 PM",
    "Total time: 8.00 hrs",
    "Parking/Tolls: ",
    "- Parking $12.00",
    "- Toll $6.50",
    "PM/PC name: N/a",
    "MOD name: Dana Reyes, Chris Vale",
    "NOC name: Priya Anand",
    "Ticket #: INC0099123",
    "Release code: RLS-4417",
    "Return track #: 1Z999AA10123456784",
    "Materials used: ",
    "- Cat 6A 3Ft $3.00",
    "- Wall Plate $8.99",
    "Work summary: Sam Super: Ran the crew, verified uplinks.",
    "",
    "Terry Tech: Swapped the switch and relabelled the leads.",
    "",
  ].join("\n");

  check("text report matches the template exactly", report, expected);

  // A second ticket has to reach the report. Their systems paste one field,
  // and a ticket left off is work nobody gets billed for.
  await db.jobTicket.create({
    data: { jobId: exportJob.id, number: "INC0099124", order: 0 },
  });
  const twoTickets = await loadJobForExport(exportJob.id);
  check(
    "every ticket reaches the report",
    buildTextReport(twoTickets!)
      .split("\n")
      .find((line) => line.startsWith("Ticket #:")),
    "Ticket #: INC0099123, INC0099124",
  );
  await db.jobTicket.deleteMany({ where: { jobId: exportJob.id } });

  // A return goes back in as many boxes as it goes back in, and each box has
  // its own number. They are recorded one per line against Return Labels,
  // beside the photo of the label, and the client reads one list.
  await db.deliverableItem.updateMany({
    where: { jobId: exportJob.id, category: "RETURN_LABELS" },
    data: { textValue: "1Z999AA10123456784\n1Z999AA10123456791" },
  });
  // Still set, and no longer what wins: the numbers beside the label are the
  // ones somebody actually read off the boxes.
  await db.job.update({
    where: { id: exportJob.id },
    data: { returnTrackingNumber: "TYPED-LONG-AGO" },
  });
  check(
    "every box going back reaches the report, comma separated",
    buildTextReport((await loadJobForExport(exportJob.id))!)
      .split("\n")
      .find((line) => line.startsWith("Return track #:")),
    "Return track #: 1Z999AA10123456784, 1Z999AA10123456791",
  );

  // Jobs raised before the numbers moved to the deliverable still have theirs.
  // Emptied rather than deleted: the section itself is what the ZIP export is
  // checked on further down, and a suite that removes it fails there instead.
  await db.deliverableItem.updateMany({
    where: { jobId: exportJob.id, category: "RETURN_LABELS" },
    data: { textValue: null },
  });
  check(
    "and the old job field is still read when nothing was recorded there",
    buildTextReport((await loadJobForExport(exportJob.id))!)
      .split("\n")
      .find((line) => line.startsWith("Return track #:")),
    "Return track #: TYPED-LONG-AGO",
  );

  await db.deliverableItem.updateMany({
    where: { jobId: exportJob.id, category: "RETURN_LABELS" },
    data: { textValue: "1Z999AA10123456784" },
  });
  await db.job.update({
    where: { id: exportJob.id },
    data: { returnTrackingNumber: null },
  });

  check("hotel claims stay out of the client report", report.includes("Holiday Inn"), false);
  check("INC number stays internal", report.includes("SECRET-INTERNAL"), false);
  check(
    "internal status stays internal",
    report.includes("REVISIT") || report.includes("Revisit"),
    false,
  );

  // "No release code" is a decision, not a gap, and reads as a dash.
  await db.job.update({
    where: { id: exportJob.id },
    data: { noReleaseCode: true, releaseCode: null },
  });
  const bypassed = buildTextReport((await loadJobForExport(exportJob.id))!);
  check(
    "a bypassed release code reads as a dash",
    bypassed.includes("Release code: -"),
    true,
  );

  await db.pointOfContact.deleteMany({ where: { jobId: exportJob.id, type: "MOD" } });
  const noMod = buildTextReport((await loadJobForExport(exportJob.id))!);
  check("a site with no MOD says so", noMod.includes("MOD name: No MOD"), true);

  // A merged summary replaces the per-tech entries wholesale.
  await db.job.update({
    where: { id: exportJob.id },
    data: { workPerformedMerged: "Switch replaced, uplinks verified." },
  });
  const merged = buildTextReport((await loadJobForExport(exportJob.id))!);
  check(
    "the merged summary wins once written",
    merged.includes("Work summary: Switch replaced, uplinks verified."),
    true,
  );
  check("merged output drops the per-tech prefixes", merged.includes("Terry Tech:"), false);

  // --- ZIP ----------------------------------------------------------------
  check("zip is named for the work date and assignment", zipFileName(exportData), "2026-07-28-887766.zip");
  check("report file is named for the assignment", reportFileName(exportData), "887766-Report.txt");

  const zipData = (await loadJobForExport(exportJob.id))!;
  const archive = await buildJobZip(zipData);
  const zipChunks: Buffer[] = [];
  for await (const chunk of archive) zipChunks.push(Buffer.from(chunk));
  const zip = Buffer.concat(zipChunks);

  // Read the names straight out of the central directory rather than pulling
  // in an unzip dependency for a handful of assertions.
  const names: string[] = [];
  for (let i = 0; i < zip.length - 46; i++) {
    if (zip.readUInt32LE(i) !== 0x02014b50) continue;
    const nameLength = zip.readUInt16LE(i + 28);
    names.push(zip.subarray(i + 46, i + 46 + nameLength).toString("utf8"));
  }

  check("zip is a real archive", zip.subarray(0, 2).toString(), "PK");
  check("zip contains the report", names.includes("887766-Report.txt"), true);
  // The folder follows the company name, so read it rather than assuming it.
  const companyName = (await db.companySettings.findUniqueOrThrow({
    where: { id: "singleton" },
    select: { name: true },
  })).name;

  check(
    "zip contains the internal work order",
    names.some(
      (name) =>
        name.startsWith(`${companyName} INT WO/`) && name.endsWith(".pdf"),
    ),
    true,
  );
  check(
    "the work order folder is named for the document, not the field label",
    names.some((name) => name.includes("INT WO ID/")),
    false,
  );
  check(
    "return label text is preserved as a file",
    names.some((name) => name === "Return Labels/Terry Tech/notes.txt"),
    true,
  );

  const workOrder = await buildWorkOrderPdf(zipData);
  check("work order is a PDF", workOrder.subarray(0, 5).toString(), "%PDF-");
  check("work order has real content", workOrder.byteLength > 2000, true);

  await db.job.delete({ where: { id: exportJob.id } });

  // --- pay ----------------------------------------------------------------
  const {
    labourCents,
    fromCents,
    toCents,
    weekRange,
    weekMonth,
    weeksInMonth,
    expectedPayDate,
    buildPayrollPeriod,
  } = await import("@/lib/payroll");

  check("hourly pay to the cent", labourCents("HOURLY", "45.00", 450), 33750);
  check("flat pays once, whatever the hours", labourCents("FLAT", "250", 450), 25000);
  check("non-billable pays nothing", labourCents("NON_BILLABLE", "45", 450), 0);
  // Cents throughout: a third of an hour at $45 must not drift.
  check("odd minutes round to the cent", labourCents("HOURLY", "45", 20), 1500);
  check("cents render back cleanly", fromCents(33750), "337.50");
  check("decimal strings convert to cents", toCents("12.34"), 1234);

  // A week is filed under the month its Monday falls in, so a straddling week
  // is counted once and by its start.
  const straddling = weekRange(new Date("2026-10-01T12:00:00Z"), TZ);
  const filed = weekMonth(straddling.start, TZ);
  check("a week starting 28 Sep files under September", `${filed.year}-${filed.month}`, "2026-9");

  const septemberWeeks = weeksInMonth(2026, 9, TZ);
  const octoberWeeks = weeksInMonth(2026, 10, TZ);
  const overlap = septemberWeeks.filter((week) =>
    octoberWeeks.some((other) => other.start.getTime() === week.start.getTime()),
  );
  check("no week is counted in two months", overlap.length, 0);
  check("September has its weeks", septemberWeeks.length > 0, true);

  // The bug this guards: new Date("2026-06-15") is UTC midnight, which is the
  // afternoon of the 14th in Los Angeles, so the selector landed a week early.
  const { parseZonedDate } = await import("@/lib/datetime");
  const reparsed = weekRange(parseZonedDate("2026-06-15", TZ)!, TZ);
  check(
    "a date string round-trips to the same week",
    isoDateInZone(reparsed.start, TZ),
    "2026-06-15",
  );
  check(
    "the naive parse would have been a week early",
    isoDateInZone(weekRange(new Date("2026-06-15"), TZ).start, TZ),
    "2026-06-08",
  );

  check(
    "expected pay date is the lag after the week ends",
    expectedPayDate(new Date("2026-08-03T07:00:00Z"), 3).toISOString().slice(0, 10),
    "2026-08-24",
  );

  // --- a real week --------------------------------------------------------
  await db.payrollPeriod.deleteMany({ where: { userId: tech.id } });

  const payWeek = weekRange(new Date("2026-07-29T12:00:00Z"), TZ);

  const payJob = await db.job.create({
    data: {
      ...base,
      intWoId: "2026-07-PRJ12-9500",
      intWoSequence: 9500,
      title: "Pay week job",
      projectId: project.id,
    },
  });
  const payAssignment = await db.jobAssignment.create({
    data: {
      jobId: payJob.id,
      userId: tech.id,
      payType: "HOURLY",
      payRate: "45",
      travelReimbursement: "40",
    },
  });
  await db.visit.create({
    data: {
      assignmentId: payAssignment.id,
      // Wednesday 08:00-16:00 local, with a 30 minute unpaid break.
      clockInAt: new Date("2026-07-29T15:00:00Z"),
      clockOutAt: new Date("2026-07-29T23:00:00Z"),
      breaks: {
        create: {
          startAt: new Date("2026-07-29T19:00:00Z"),
          endAt: new Date("2026-07-29T19:30:00Z"),
          paid: false,
        },
      },
    },
  });
  await db.reimbursement.createMany({
    data: [
      { jobId: payJob.id, assignmentId: payAssignment.id, type: "PARKING", amount: "12.00" },
      { jobId: payJob.id, assignmentId: payAssignment.id, type: "MATERIAL", amount: "3.00" },
      { jobId: payJob.id, assignmentId: payAssignment.id, type: "HOTEL", amount: "154.00" },
    ],
  });

  const periodId = await buildPayrollPeriod({
    userId: tech.id,
    week: payWeek,
    timeZone: TZ,
    payLagWeeks: 3,
  });

  const built = await db.payrollPeriod.findUniqueOrThrow({
    where: { id: periodId },
    include: { lines: true },
  });

  check("the week has one line", built.lines.length, 1);
  // 7.5 paid hours at $45 = 337.50, plus 40 travel + 12 parking + 3 materials
  // + 154 hotel = 546.50.
  check("unpaid break comes off the labour", built.lines[0].laborAmount.toString(), "337.5");
  check("travel is carried per job", built.lines[0].travelReimb.toString(), "40");
  check("hotel is carried too", built.lines[0].hotelReimb.toString(), "154");
  check("line total adds up", built.lines[0].totalExpected.toString(), "546.5");
  check("week total matches the line", built.expectedAmount.toString(), "546.5");
  check(
    "the week routes to the tech's direct supervisor",
    built.supervisorId,
    sup.id,
  );

  // An override is a decision; rebuilding recomputes hours but leaves it alone.
  await db.payrollLine.update({
    where: { id: built.lines[0].id },
    data: { overrideAmount: "500.00", overrideNote: "Client short-paid travel" },
  });
  await buildPayrollPeriod({
    userId: tech.id,
    week: payWeek,
    timeZone: TZ,
    payLagWeeks: 3,
  });
  const afterRebuild = await db.payrollLine.findUniqueOrThrow({
    where: { id: built.lines[0].id },
  });
  check(
    "rebuilding preserves an override",
    afterRebuild.overrideAmount?.toString(),
    "500",
  );
  check(
    "rebuilding still refreshes the computed total",
    afterRebuild.totalExpected.toString(),
    "546.5",
  );

  // Work that moves out of the week must not leave a line claiming money.
  await db.visit.updateMany({
    where: { assignmentId: payAssignment.id },
    data: { clockInAt: new Date("2026-08-05T15:00:00Z"), clockOutAt: new Date("2026-08-05T23:00:00Z") },
  });
  await buildPayrollPeriod({
    userId: tech.id,
    week: payWeek,
    timeZone: TZ,
    payLagWeeks: 3,
  });
  check(
    "a job moved out of the week drops its line",
    await db.payrollLine.count({ where: { payrollPeriodId: periodId } }),
    0,
  );

  // --- mileage ------------------------------------------------------------
  const { availableCategories, milesBetween, mileageAmount, MILEAGE_META } =
    await import("@/lib/mileage");

  check(
    "off-clock supply runs are hidden while clocked in",
    availableCategories(true).includes("OFFCLOCK_TOOLS_SUPPLIES"),
    false,
  );
  check(
    "on-clock supply runs are hidden while clocked out",
    availableCategories(false).includes("ONCLOCK_TOOLS_SUPPLIES"),
    false,
  );
  check(
    "the drive home is always available",
    availableCategories(false).includes("RETURNING_HOME") &&
      availableCategories(true).includes("RETURNING_HOME"),
    true,
  );
  check("returning home needs no reference", MILEAGE_META.RETURNING_HOME.requiresJob, false);
  check("other demands a note", MILEAGE_META.OTHER.requiresNote, true);
  check("miles to one decimal", milesBetween(10432.4, 10467.9), 35.5);
  check("mileage value at the stored rate", mileageAmount(35.5, "0.70"), "24.85");

  // --- pay journal --------------------------------------------------------
  const { buildPayWorkbook, payExportFileName } = await import(
    "@/lib/exports/pay-export"
  );

  check(
    "weekly export is named for the week",
    payExportFileName({ kind: "week", week: payWeek }, TZ),
    "Pay-07272026.xlsx",
  );
  check(
    "monthly export is named for the month",
    payExportFileName({ kind: "month", year: 2026, month: 7 }, TZ),
    "Pay-2026-07.xlsx",
  );

  const workbookBuffer = await buildPayWorkbook({
    userIds: [tech.id, sup.id],
    range: { kind: "week", week: payWeek },
    timeZone: TZ,
  });
  check("workbook is a real xlsx", workbookBuffer.subarray(0, 2).toString(), "PK");

  const ExcelJS = (await import("exceljs")).default;
  const readBack = new ExcelJS.Workbook();
  await readBack.xlsx.load(workbookBuffer as unknown as ArrayBuffer);

  check("one sheet per tech", readBack.worksheets.length, 2);
  const headers = readBack.worksheets[0].getRow(1).values as string[];
  check(
    "received pay is carried for both the job and the week",
    headers.includes("Received (job)") && headers.includes("Received (week)"),
    true,
  );
  check("column order starts with the date", headers[1], "Date");
  check("column order ends with the note", headers[headers.length - 1], "Pay Note");

  await db.job.delete({ where: { id: payJob.id } });

  // --- form coercion ------------------------------------------------------
  // Both of these presented as "I pressed the button and nothing happened".
  const { flag, optionalInt, optionalMoney, optionalText } = await import(
    "@/lib/form"
  );

  check("a missing field is nothing, not a failure", optionalText.parse(undefined), null);
  check("so is a blank one", optionalText.parse(""), null);
  check("padding is trimmed", optionalText.parse("  887766  "), "887766");
  check("null is nothing too", optionalText.parse(null), null);

  check("a ticked checkbox is true", flag.parse("on"), true);
  check("an absent one is false", flag.parse(undefined), false);
  // z.coerce.boolean() gets this wrong: Boolean("false") is true, so switching
  // something off switched it back on.
  check('the string "false" is false', flag.parse("false"), false);
  check('and "true" is true', flag.parse("true"), true);
  check("an empty string is false", flag.parse(""), false);
  check("a real boolean passes through", flag.parse(false), false);

  const minutes = optionalInt({ min: 1, max: 100 });
  check("a missing number is nothing", minutes.parse(undefined), null);
  check("a given one is a number", minutes.parse("90"), 90);
  check(
    "out of range is refused",
    minutes.safeParse("0").success,
    false,
  );
  check("so is nonsense", minutes.safeParse("later").success, false);

  check("blank money is nothing", optionalMoney.parse(""), null);
  check("negative money is refused", optionalMoney.safeParse("-5").success, false);

  // The regression itself: the Lead radio only exists in the DOM once somebody
  // is assigned, so creating a job with no crew submitted no leadId at all.
  const { jobFormSchema } = await import("@/app/(app)/jobs/schema");
  const noCrew = jobFormSchema.safeParse({
    title: "Switch swap",
    clientId: "c1",
    siteId: "s1",
    projectId: "",
    techsRequired: "1",
  });
  if (!noCrew.success) console.log(`      ${noCrew.error.issues[0]?.message}`);
  check("a job with no crew and no lead validates", noCrew.success, true);
  check("and its lead is simply nobody", noCrew.data?.leadId ?? null, null);

  // --- timeline grouping --------------------------------------------------
  const { groupTimeline, timelineMeta } = await import("@/lib/timeline");

  function event(id: string, action: string, actorName: string | null) {
    return {
      id,
      action,
      actorName,
      createdAt: new Date(),
      detail: null,
    };
  }

  check(
    "a run of the same bulk action collapses into one row",
    groupTimeline([
      event("1", "project_job_created", "Boss"),
      event("2", "project_job_created", "Boss"),
      event("3", "project_job_created", "Boss"),
    ]).length,
    1,
  );
  check(
    "and keeps every event inside it",
    groupTimeline([
      event("1", "project_job_created", "Boss"),
      event("2", "project_job_created", "Boss"),
    ])[0].events.length,
    2,
  );
  check(
    "a lone bulk event stays a plain row rather than an empty block",
    groupTimeline([event("1", "project_job_created", "Boss")])[0].events.length,
    1,
  );
  check(
    "a different person breaks the run — who did it is part of the story",
    groupTimeline([
      event("1", "tech_assigned", "Boss"),
      event("2", "tech_assigned", "Sup"),
    ]).length,
    2,
  );
  check(
    "so does something happening in between",
    groupTimeline([
      event("1", "tech_assigned", "Boss"),
      event("2", "clock_in", "Boss"),
      event("3", "tech_assigned", "Boss"),
    ]).length,
    3,
  );
  check(
    "actions that never arrive in bulk do not collapse",
    groupTimeline([
      event("1", "project_created", "Boss"),
      event("2", "project_created", "Boss"),
    ]).length,
    2,
  );
  check(
    "an action nobody registered still reads as something",
    timelineMeta("some_new_thing_happened").label,
    "Some new thing happened",
  );

  // --- branding -----------------------------------------------------------
  const { brandLine } = await import("@/lib/company");

  check(
    "the header names the company and the app",
    brandLine("417 Group"),
    "417 Group | QuickTec",
  );
  check(
    "a fresh install does not read QuickTec twice",
    brandLine("QuickTec"),
    "QuickTec",
  );
  check("nor when the name is blank", brandLine("  "), "QuickTec");

  // --- NextCloud groups ---------------------------------------------------
  const { extractGroups, resolveBaseRole } = await import(
    "@/lib/nextcloud-groups"
  );

  check(
    "groups arrive in the roles claim",
    extractGroups({ roles: ["quicktec-tech", "other"] }).join(","),
    "quicktec-tech,other",
  );
  check(
    "or in a groups claim",
    extractGroups({ groups: ["quicktec-manager"] }).join(","),
    "quicktec-manager",
  );
  check(
    "a space separated string is a list too",
    extractGroups({ roles: "quicktec-tech admin" }).join(","),
    "quicktec-tech,admin",
  );
  check(
    "so is a comma separated one",
    extractGroups({ groups: "quicktec-tech,admin" }).join(","),
    "quicktec-tech,admin",
  );
  check(
    "a namespaced claim is found rather than refused",
    extractGroups({ "nextcloud.groups": ["quicktec-supervisor"] }).join(","),
    "quicktec-supervisor",
  );
  check(
    "nothing group-shaped means no groups",
    extractGroups({ sub: "abc", email: "a@b.c", name: "A" }).length,
    0,
  );

  check(
    "the group maps to a role",
    resolveBaseRole(["quicktec-supervisor"]),
    "SUPERVISOR",
  );
  check(
    "case does not matter — NextCloud keeps the id as typed",
    resolveBaseRole(["QuickTec-Tech"]),
    "TECH",
  );
  check(
    "manager outranks the rest",
    resolveBaseRole(["quicktec-tech", "quicktec-manager", "quicktec-admin"]),
    "MANAGER",
  );
  check(
    "an unrelated group grants nothing",
    resolveBaseRole(["admin", "users"]),
    null,
  );

  // --- iCalendar ----------------------------------------------------------
  const { buildVEvent, eventFileName, eventUid } = await import(
    "@/lib/calendar/ical"
  );

  check(
    "an event id is stable for a job and a tech",
    eventUid("job1", "user1"),
    "job-job1-user1@quicktec",
  );
  check(
    "the file name is the id with an extension",
    eventFileName("job1", "user1"),
    "job-job1-user1@quicktec.ics",
  );

  // DTSTAMP is "now" by definition, so it is masked rather than pinned.
  const golden = buildVEvent({
    uid: "job-abc-def@quicktec",
    start: new Date("2026-07-28T17:00:00Z"),
    end: new Date("2026-07-28T19:30:00Z"),
    summary: "Register swap; lane 3",
    location: "1912 Pike Pl, Seattle, WA 98101",
    description: "Line one\nLine two",
    url: "https://quicktec.417group.org/jobs/abc",
    sequence: 2,
    createdAt: new Date("2026-07-20T08:00:00Z"),
    updatedAt: new Date("2026-07-27T22:15:00Z"),
  }).replace(/^DTSTAMP:.*$/m, "DTSTAMP:*");

  const goldenExpected = [
    "BEGIN:VEVENT",
    "UID:job-abc-def@quicktec",
    "DTSTAMP:*",
    "DTSTART:20260728T170000Z",
    "DTEND:20260728T193000Z",
    "SUMMARY:Register swap\\; lane 3",
    "SEQUENCE:2",
    "CREATED:20260720T080000Z",
    "LAST-MODIFIED:20260727T221500Z",
    "TRANSP:OPAQUE",
    "LOCATION:1912 Pike Pl\\, Seattle\\, WA 98101",
    "DESCRIPTION:Line one\\nLine two",
    "URL:https://quicktec.417group.org/jobs/abc",
    "END:VEVENT",
  ].join("\r\n");

  if (golden !== goldenExpected) console.log(`\n${golden}\n`);
  check("VEVENT matches the golden output", golden === goldenExpected, true);

  // A backslash in the source must survive as one escaped backslash, not as
  // an escape of whatever followed it.
  const escapedText = buildVEvent({
    uid: "u",
    start: new Date("2026-07-28T17:00:00Z"),
    end: new Date("2026-07-28T18:00:00Z"),
    summary: "A\\B;C,D",
    sequence: 1,
    createdAt: new Date("2026-07-28T00:00:00Z"),
    updatedAt: new Date("2026-07-28T00:00:00Z"),
  });
  check(
    "TEXT escaping does backslash first",
    /^SUMMARY:.*$/m.exec(escapedText)?.[0],
    "SUMMARY:A\\\\B\\;C\\,D",
  );

  // Cyrillic measures short in JavaScript and long on the wire; NextCloud
  // rejects the over-long line, so folding counts octets.
  const longSummary = "Заміна касового обладнання та перевірка мережі на об'єкті";
  const folded = buildVEvent({
    uid: "u",
    start: new Date("2026-07-28T17:00:00Z"),
    end: new Date("2026-07-28T18:00:00Z"),
    summary: longSummary,
    sequence: 1,
    createdAt: new Date("2026-07-28T00:00:00Z"),
    updatedAt: new Date("2026-07-28T00:00:00Z"),
  });
  const encoder = new TextEncoder();
  const overLong = folded
    .split("\r\n")
    .filter((row) => encoder.encode(row).length > 75);
  check("no line exceeds 75 octets", overLong.length, 0);
  check(
    "the summary folded at all",
    folded.split("\r\n").some((row) => row.startsWith(" ")),
    true,
  );
  check(
    "unfolding restores the summary",
    /^SUMMARY:(.*)$/m.exec(folded.replace(/\r\n /g, ""))?.[1],
    longSummary,
  );

  // --- CalDAV against a local server --------------------------------------
  const { createServer } = await import("node:http");
  const {
    calendarSlug,
    deleteEvent,
    describeFailure,
    ensureCalendar,
    putEvent,
  } = await import("@/lib/calendar/caldav");

  type Recorded = {
    method: string;
    url: string;
    body: string;
    authorized: boolean;
  };
  const recorded: Recorded[] = [];
  let mkcalendarCalls = 0;
  /** Paths this pretend NextCloud has actually been asked to create. */
  const calendars = new Set<string>();

  const CALDAV_USER = "417-sys";
  const CALDAV_PASS = "app-password";
  const expectedAuth = `Basic ${Buffer.from(`${CALDAV_USER}:${CALDAV_PASS}`).toString("base64")}`;

  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const authorized = req.headers.authorization === expectedAuth;
      recorded.push({
        method: req.method ?? "",
        url: req.url ?? "",
        body: Buffer.concat(chunks).toString("utf8"),
        authorized,
      });

      if (!authorized) {
        res.writeHead(401).end();
        return;
      }
      const path = req.url ?? "";
      if (req.method === "MKCALENDAR") {
        mkcalendarCalls += 1;
        // NextCloud answers 405 for a collection that already exists.
        if (calendars.has(path)) {
          res.writeHead(405).end();
          return;
        }
        calendars.add(path);
        res.writeHead(201).end();
        return;
      }
      if (req.method === "PROPFIND") {
        // The calendar home always answers; a calendar only once it is made.
        const found = calendars.has(path) || path.endsWith("/");
        if (!found) {
          res.writeHead(404).end();
          return;
        }
        res.writeHead(207).end("<d:multistatus xmlns:d='DAV:'/>");
        return;
      }
      if (req.method === "DELETE") {
        res.writeHead(path.includes("missing") ? 404 : 204).end();
        return;
      }
      res.writeHead(204).end();
    });
  });

  const port = await new Promise<number>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    });
  });

  const previousIssuer = process.env.NEXTCLOUD_ISSUER;
  const previousAuthUrl = process.env.AUTH_URL;
  process.env.NEXTCLOUD_ISSUER = `http://127.0.0.1:${port}`;
  process.env.CALDAV_USERNAME = CALDAV_USER;
  process.env.CALDAV_PASSWORD = CALDAV_PASS;
  process.env.AUTH_URL = "https://quicktec.417group.org";

  const config = {
    baseUrl: `http://127.0.0.1:${port}`,
    username: CALDAV_USER,
    password: CALDAV_PASS,
  };

  const first = await ensureCalendar(config, "quicktec-probe", "Probe");
  check("MKCALENDAR creates the calendar", `${first.ok} ${first.status}`, "true 201");
  const second = await ensureCalendar(config, "quicktec-probe", "Probe");
  check(
    "a calendar that already exists is success",
    `${second.ok} ${second.status}`,
    "true 405",
  );
  check(
    "the system account authenticates with basic auth",
    recorded.every((entry) => entry.authorized),
    true,
  );
  check(
    "MKCALENDAR targets the system account's calendar home",
    recorded[0].url,
    "/remote.php/dav/calendars/417-sys/quicktec-probe",
  );

  const missing = await deleteEvent(config, "quicktec-probe", "missing.ics");
  check("deleting an event that is already gone is success", missing.ok, true);

  const wrongPassword = await putEvent(
    { ...config, password: "wrong" },
    "quicktec-probe",
    "x.ics",
    "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n",
  );
  check("a bad app password is reported, not thrown", wrongPassword.status, 401);

  check(
    "the calendar id is derived from the email",
    calendarSlug("A.Rubayko@417group.org"),
    "quicktec-a-rubayko-417group-org",
  );

  // A proxy that has never heard of MKCALENDAR answers 405 on its own account
  // — the same status CalDAV uses for "that already exists". Believing it is
  // how every event afterwards is written to a calendar that was never made,
  // which looks from the outside like a sync that does nothing at all.
  const liar = createServer((req, res) => {
    res.writeHead(req.method === "MKCALENDAR" ? 405 : 404).end();
  });
  const liarPort = await new Promise<number>((resolve) => {
    liar.listen(0, "127.0.0.1", () => {
      const address = liar.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    });
  });
  const liarResult = await ensureCalendar(
    { ...config, baseUrl: `http://127.0.0.1:${liarPort}` },
    "quicktec-probe",
    "Probe",
  );
  liar.close();
  check(
    "a 405 is not taken for granted when the calendar is not there",
    liarResult.ok,
    false,
  );
  check(
    "and the reason names MKCALENDAR rather than the event that failed later",
    describeFailure(liarResult).includes("MKCALENDAR"),
    true,
  );

  // --- job sync -----------------------------------------------------------
  const { calendarDisplayName, describeJob, syncAll, syncJob } = await import(
    "@/lib/calendar/sync"
  );

  check(
    "the calendar is named for the system account and the tech",
    calendarDisplayName("a.rubayko@417group.org"),
    "417-SYS: QuickTec (a.rubayko@417group.org)",
  );

  // syncAll sweeps everything scheduled from a week ago onwards, so the slate
  // is cleared to keep its counts about this fixture alone.
  await db.job.deleteMany({});

  const calStart = new Date(Date.now() + 24 * 60 * 60_000);
  const calJob = await db.job.create({
    data: {
      ...base,
      title: "Register swap",
      intWoId: "2026-07-0000-9001",
      intWoSequence: 9001,
      projectId: project.id,
      scheduledStart: calStart,
      estimateMinutes: 90,
      scopeOfWork: "Swap register 3; test the lane.",
      dispatchContacts: {
        create: {
          label: "NOC",
          name: "Dana",
          phone: "555-0100",
          order: 0,
        },
      },
    },
  });
  const calAssignment = await db.jobAssignment.create({
    data: { jobId: calJob.id, userId: tech.id, payType: "HOURLY", payRate: "45" },
  });

  // Only the traffic this job causes, not the probes above.
  recorded.length = 0;

  const puts = () => recorded.filter((entry) => entry.method === "PUT");
  const lastPutBody = () => puts()[puts().length - 1]?.body ?? "";
  const icsProp = (body: string, name: string) =>
    new RegExp(`^${name}:(.*)$`, "m")
      .exec(body.replace(/\r\n /g, ""))?.[1]
      ?.trim() ?? "";
  const icalStamp = (date: Date) =>
    `${date.toISOString().replace(/[-:]/g, "").split(".")[0]}Z`;

  const firstSync = await syncJob(calJob.id);
  check(
    "a scheduled job is pushed to the assigned tech",
    `${firstSync.pushed}/${firstSync.removed}/${firstSync.skipped}/${firstSync.failures.length}`,
    "1/0/0/0",
  );
  check("one event was uploaded", puts().length, 1);
  check(
    "the event lands in the tech's calendar",
    puts()[0].url,
    `/remote.php/dav/calendars/417-sys/quicktec-tech-417group-org/${encodeURIComponent(eventFileName(calJob.id, tech.id))}`,
  );
  check(
    "the event starts when the job is scheduled",
    icsProp(lastPutBody(), "DTSTART"),
    icalStamp(calStart),
  );
  check(
    "the event runs for the estimate until the tech clocks out",
    icsProp(lastPutBody(), "DTEND"),
    icalStamp(new Date(calStart.getTime() + 90 * 60_000)),
  );
  check(
    "the event links back to the job",
    icsProp(lastPutBody(), "URL"),
    `https://quicktec.417group.org/jobs/${calJob.id}`,
  );

  const storedEvent = await db.calendarEvent.findUniqueOrThrow({
    where: { jobId_userId: { jobId: calJob.id, userId: tech.id } },
  });
  check("the push is recorded", storedEvent.sequence, 1);
  check(
    "the recorded path is where the event was written",
    storedEvent.calendarPath.endsWith(eventFileName(calJob.id, tech.id)),
    true,
  );
  check(
    "the tech's calendar is remembered on their account",
    (await db.user.findUniqueOrThrow({ where: { id: tech.id } })).calendarName,
    calendarDisplayName(tech.email),
  );
  check(
    "the calendar is shared with the tech and their supervisor",
    recorded.filter(
      (entry) => entry.method === "POST" && entry.body.includes("<O:read/>"),
    ).length,
    2,
  );

  const unchanged = await syncJob(calJob.id);
  check(
    "an unchanged job is not re-uploaded",
    `${unchanged.pushed}/${unchanged.skipped}`,
    "0/1",
  );
  check("still only one upload", puts().length, 1);

  // Once the tech has clocked out the event tells the truth about the day.
  const realIn = new Date(calStart.getTime() + 15 * 60_000);
  const realOut = new Date(calStart.getTime() + 5 * 60 * 60_000);
  await db.visit.create({
    data: {
      assignmentId: calAssignment.id,
      clockInAt: realIn,
      clockOutAt: realOut,
    },
  });

  const afterClockOut = await syncJob(calJob.id);
  check("clocking out re-pushes the event", afterClockOut.pushed, 1);
  check(
    "the event now runs for the real time",
    `${icsProp(lastPutBody(), "DTSTART")} ${icsProp(lastPutBody(), "DTEND")}`,
    `${icalStamp(realIn)} ${icalStamp(realOut)}`,
  );
  check(
    "the sequence is bumped so clients see an update",
    (
      await db.calendarEvent.findUniqueOrThrow({
        where: { jobId_userId: { jobId: calJob.id, userId: tech.id } },
      })
    ).sequence,
    2,
  );

  const describedJob = await db.job.findUniqueOrThrow({
    where: { id: calJob.id },
    select: {
      id: true,
      title: true,
      scheduledStart: true,
      estimateMinutes: true,
      scopeOfWork: true,
      createdAt: true,
      updatedAt: true,
      client: { select: { name: true } },
      customer: { select: { name: true, code: true } },
      site: {
        select: {
          siteNumber: true,
          addressLine1: true,
          addressLine2: true,
          city: true,
          state: true,
          postalCode: true,
          country: true,
        },
      },
      project: { select: { name: true, generalScopeOfWork: true } },
      dispatchContacts: {
        orderBy: { order: "asc" },
        select: { label: true, name: true, phone: true, email: true, note: true },
      },
    },
  });
  const description = describeJob(describedJob);
  check(
    "the description opens with the customer",
    description.split("\n")[0],
    "Customer: Starbucks",
  );
  check(
    "the site is written the way it is everywhere else",
    description.includes("Site: SBUX #24541"),
    true,
  );
  check(
    "dispatch numbers travel with the event",
    description.includes("NOC · Dana · 555-0100"),
    true,
  );
  check(
    "the scope is in the description",
    description.includes("Swap register 3; test the lane."),
    true,
  );

  // A job nobody has scheduled has nothing to put in a calendar.
  const unscheduled = await db.job.create({
    data: {
      ...base,
      title: "Unscheduled",
      intWoId: "2026-07-0000-9002",
      intWoSequence: 9002,
    },
  });
  await db.jobAssignment.create({
    data: { jobId: unscheduled.id, userId: tech.id, payType: "HOURLY" },
  });
  const noDate = await syncJob(unscheduled.id);
  check(
    "a job with no date is skipped rather than guessed at",
    `${noDate.pushed}/${noDate.skipped}`,
    "0/1",
  );
  check(
    "and the sweep says why, so nothing pushed is never a mystery",
    noDate.reasons["no date and nobody on site yet"],
    1,
  );

  // A job planned but not crewed produces nothing and used not to say so,
  // which is the commonest reason a calendar looks empty.
  const uncrewed = await db.job.create({
    data: {
      ...base,
      title: "Nobody on it",
      intWoId: "2026-07-0000-9003",
      intWoSequence: 9003,
      scheduledStart: new Date(Date.now() + 3 * 24 * 60 * 60_000),
    },
  });
  const uncrewedSync = await syncJob(uncrewed.id);
  check(
    "a job with nobody on it is reported as such",
    uncrewedSync.reasons["nobody assigned"],
    1,
  );

  // No estimate falls back to two hours: a zero-length event is invisible in
  // most clients, which is worse than a rough one.
  await db.visit.deleteMany({ where: { assignmentId: calAssignment.id } });
  await db.job.update({
    where: { id: calJob.id },
    data: { estimateMinutes: null },
  });
  await syncJob(calJob.id);
  check(
    "no estimate falls back to two hours",
    icsProp(lastPutBody(), "DTEND"),
    icalStamp(new Date(calStart.getTime() + 120 * 60_000)),
  );

  // Taking someone off a job must take it out of their calendar.
  await db.jobAssignment.delete({ where: { id: calAssignment.id } });
  const afterUnassign = await syncJob(calJob.id);
  check("unassigning removes the event", afterUnassign.removed, 1);
  check(
    "a DELETE was issued for that tech's copy",
    recorded.some(
      (entry) =>
        entry.method === "DELETE" &&
        entry.url.includes(encodeURIComponent(eventFileName(calJob.id, tech.id))),
    ),
    true,
  );
  check(
    "the record goes with it",
    await db.calendarEvent.count({ where: { jobId: calJob.id } }),
    0,
  );

  // --- the whole sweep ----------------------------------------------------
  await db.jobAssignment.create({
    data: { jobId: calJob.id, userId: tech.id, payType: "HOURLY", payRate: "45" },
  });
  await db.auditEvent.deleteMany({ where: { action: "calendar_synced" } });

  const sweep = await syncAll(sup.id);
  check(
    "the sweep pushes the scheduled job and skips the ones it cannot place",
    `${sweep.pushed}/${sweep.failures.length}`,
    "1/0",
  );
  check(
    "the sweep is audited",
    await db.auditEvent.count({ where: { action: "calendar_synced" } }),
    1,
  );

  // Work planned two months ago and clocked since was out of reach: the window
  // was measured against the planned date alone, so a job entered late could
  // never be pushed at all and no button in the app could fix it.
  const longAgo = new Date(Date.now() - 60 * 24 * 60 * 60_000);
  const old = await db.job.create({
    data: {
      ...base,
      title: "Finished last quarter",
      intWoId: "2026-07-0000-9004",
      intWoSequence: 9004,
      scheduledStart: longAgo,
      estimateMinutes: 60,
    },
  });
  await db.jobAssignment.create({
    data: { jobId: old.id, userId: tech.id, payType: "HOURLY", payRate: "45" },
  });
  await db.$executeRaw`UPDATE "Job" SET "updatedAt" = ${longAgo} WHERE id = ${old.id}`;

  const recentOnly = await syncAll(sup.id);
  check(
    "a job finished months ago is outside the ordinary sweep",
    await db.calendarEvent.count({ where: { jobId: old.id } }),
    0,
  );
  check("which is not counted as a failure", recentOnly.failures.length, 0);

  const everything = await syncAll(sup.id, "everything");
  check(
    "rebuilding from every job reaches it",
    await db.calendarEvent.count({ where: { jobId: old.id } }),
    1,
  );
  // The fingerprint is of what we last sent, not of what is on the server, so
  // an event somebody deleted in NextCloud reads as up to date from here. A
  // rebuild is the one thing that puts it back.
  check(
    "and writes every event again rather than trusting the fingerprints",
    everything.pushed >= 2 && everything.reasons.unchanged === undefined,
    true,
  );

  // An unreachable server is a failed sync, not a crash — the events are
  // simply a few minutes behind until it comes back.
  server.close();
  await new Promise((resolve) => setTimeout(resolve, 50));
  await db.job.update({
    where: { id: calJob.id },
    data: { title: "Register swap, moved" },
  });
  const offline = await syncJob(calJob.id);
  check(
    "a CalDAV server that is down is reported per tech",
    offline.failures.length > 0 && offline.pushed === 0,
    true,
  );
  // Nobody awaits a background push, so the job is where its answer has to
  // survive — otherwise a calendar rejecting every event is silent.
  check(
    "the reason is kept on the job rather than only in a log",
    Boolean(
      (
        await db.job.findUniqueOrThrow({
          where: { id: calJob.id },
          select: { calendarSyncError: true },
        })
      ).calendarSyncError,
    ),
    true,
  );

  process.env.NEXTCLOUD_ISSUER = previousIssuer;
  process.env.AUTH_URL = previousAuthUrl;
  delete process.env.CALDAV_USERNAME;
  delete process.env.CALDAV_PASSWORD;

  const unconfigured = await syncJob(calJob.id);
  check(
    "sync refuses to run unconfigured",
    unconfigured.failures[0]?.reason,
    "CalDAV is not configured",
  );

  // calJob is left behind on purpose: it is a scheduled job with the tech
  // assigned to it, which is the fixture the browser suites pick up.
  await db.job.delete({ where: { id: unscheduled.id } });
  await db.calendarEvent.deleteMany({ where: { jobId: calJob.id } });
  await db.job.update({
    where: { id: calJob.id },
    data: { estimateMinutes: 90, calendarSyncedAt: null },
  });
  await db.user.update({
    where: { id: tech.id },
    data: { calendarUrl: null, calendarName: null },
  });

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  await db.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
