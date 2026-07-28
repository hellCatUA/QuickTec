import "dotenv/config";
import { db } from "@/lib/db";
import {
  allocateIntWo,
  allocateRevisitIntWo,
  revisitAssignmentId,
} from "@/lib/int-wo";
import { startOfWeekMonday, roundToInterval, decimalHours } from "@/lib/datetime";

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

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  await db.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
