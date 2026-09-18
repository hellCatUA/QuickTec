import "dotenv/config";
import { db } from "@/lib/db";

/**
 * The people, company and job the verification suites run against.
 *
 * Split out from the seed because these are not real: the seed sets up a
 * deployment somebody is about to use, and this sets up a database somebody is
 * about to test. Mixing them puts "tech@417group.org" into a live directory.
 *
 * Written to be run repeatedly — everything is upserted on a natural key, so a
 * second run changes nothing and no suite has to care whether it is the first.
 *
 * DESTRUCTIVE by intent: it creates users and a job. It refuses to run unless
 * the same opt-in the domain suite needs is set.
 *
 *   QUICKTEC_ALLOW_DESTRUCTIVE_VERIFY=1 npm run fixtures
 */
if (process.env.QUICKTEC_ALLOW_DESTRUCTIVE_VERIFY !== "1") {
  console.error(
    "Refusing to run: this writes test users and a test job.\n" +
      "Set QUICKTEC_ALLOW_DESTRUCTIVE_VERIFY=1 on a development database to proceed.",
  );
  process.exit(1);
}

const TZ = "America/Los_Angeles";

async function main() {
  const boss = await db.user.upsert({
    where: { email: "boss@417group.org" },
    update: {},
    create: {
      email: "boss@417group.org",
      name: "Bo Ross",
      nextcloudSub: "sub-boss",
      baseRole: "MANAGER",
      timeZone: TZ,
    },
  });

  const sup = await db.user.upsert({
    where: { email: "sup@417group.org" },
    update: { directSupervisorId: boss.id },
    create: {
      email: "sup@417group.org",
      name: "Sam Super",
      nextcloudSub: "sub-sup",
      baseRole: "SUPERVISOR",
      timeZone: TZ,
      directSupervisorId: boss.id,
    },
  });

  // The tech reports to the manager, not to Sam Super: only somebody who can
  // approve payroll may be a Direct Supervisor, and a SUPERVISOR no longer can.
  // Sam still runs the projects the tech works on, which is a different job.
  const tech = await db.user.upsert({
    where: { email: "tech@417group.org" },
    update: { directSupervisorId: boss.id },
    create: {
      email: "tech@417group.org",
      name: "Terry Tech",
      nextcloudSub: "sub-tech",
      baseRole: "TECH",
      timeZone: TZ,
      directSupervisorId: boss.id,
      defaultPayType: "HOURLY",
      defaultPayRate: "45.00",
    },
  });

  // An administrator with somebody under them. The role runs the money, so the
  // suites need one to prove it can actually build, approve and record a week
  // rather than only read them — which is what it could do before.
  const admin = await db.user.upsert({
    where: { email: "admin@417group.org" },
    update: {},
    create: {
      email: "admin@417group.org",
      name: "Ada Minns",
      nextcloudSub: "sub-admin",
      baseRole: "ADMINISTRATOR",
      timeZone: TZ,
    },
  });

  await db.user.upsert({
    where: { email: "tech2@417group.org" },
    update: { directSupervisorId: admin.id },
    create: {
      email: "tech2@417group.org",
      name: "Tina Two",
      nextcloudSub: "sub-tech2",
      baseRole: "TECH",
      timeZone: TZ,
      directSupervisorId: admin.id,
      defaultPayType: "HOURLY",
      defaultPayRate: "52.00",
    },
  });

  const client = await db.client.upsert({
    where: { name: "Mettel" },
    update: {},
    create: { name: "Mettel", code: "MTL" },
  });

  // A second paying company, so the planner has one to search for.
  // Named exactly as the domain suite names its own: two rows both matching
  // "netcom" make the picker ambiguous and the search test fails on a
  // collision rather than on anything real.
  await db.client.upsert({
    where: { name: "NetCom Sub" },
    update: {},
    create: { name: "NetCom Sub" },
  });

  // One link above the paying company. Jobs are left without one on purpose
  // as well, because that is the common case and the screens have to survive
  // it — every job raised before this existed has none.
  const repCompany = await db.repCompany.upsert({
    where: { name: "Federated Service Systems" },
    update: {},
    create: { name: "Federated Service Systems", code: "FSS" },
  });
  // A number held against the company, offered on every job raised for them.
  const netcom = await db.client.findUniqueOrThrow({
    where: { name: "NetCom Sub" },
    select: { id: true },
  });
  const existingDispatch = await db.dispatchContact.findFirst({
    where: { clientId: netcom.id, label: "NOC" },
  });
  if (!existingDispatch) {
    await db.dispatchContact.create({
      data: {
        clientId: netcom.id,
        label: "NOC",
        name: "Night desk",
        phone: "800-555-0100",
        order: 0,
      },
    });
  }

  const customer = await db.customer.upsert({
    where: { code: "TSA" },
    update: {},
    create: { name: "TSA Housing", code: "TSA" },
  });

  let site = await db.site.findFirst({
    where: { customerId: customer.id, siteNumber: "4471" },
  });
  site ??= await db.site.create({
    data: {
      customerId: customer.id,
      siteNumber: "4471",
      name: "Covina Tower",
      addressLine1: "200 W Rowland St",
      city: "Covina",
      state: "CA",
      postalCode: "91723",
      country: "USA",
      timeZone: TZ,
    },
  });

  let project = await db.project.findFirst({
    where: { name: "Mettel elevator lines" },
  });
  project ??= await db.project.create({
    data: {
      name: "Mettel elevator lines",
      externalProjectId: "P-9",
      clientId: client.id,
      managerId: boss.id,
    },
  });

  await db.projectMember.upsert({
    where: { projectId_userId: { projectId: project.id, userId: sup.id } },
    update: {},
    create: { projectId: project.id, userId: sup.id, role: "SUPERVISOR" },
  });

  let job = await db.job.findFirst({ where: { title: "Elevator phone line" } });
  if (!job) {
    const { allocateIntWo } = await import("@/lib/int-wo");
    const allocated = await db.$transaction((tx) =>
      allocateIntWo(tx, {
        projectId: project!.id,
        externalProjectId: project!.externalProjectId,
        effectiveDate: new Date("2026-06-25T15:00:00Z"),
        timeZone: TZ,
      }),
    );
    job = await db.job.create({
      data: {
        intWoId: allocated.intWoId,
        intWoSequence: allocated.sequence,
        title: "Elevator phone line",
        clientId: client.id,
        repCompanyId: repCompany.id,
        customerId: customer.id,
        siteId: site.id,
        projectId: project.id,
        createdById: boss.id,
        externalAssignmentId: "A-88231",
        ticketNumber: "6682752",
        scheduledStart: new Date("2026-06-25T15:00:00Z"),
        estimateMinutes: 240,
        lifecycle: "SCHEDULED",
        scopeOfWork: "Trace and repair the elevator emergency line.",
      },
    });
  }

  await db.jobAssignment.upsert({
    where: { jobId_userId: { jobId: job.id, userId: tech.id } },
    update: {},
    create: {
      jobId: job.id,
      userId: tech.id,
      isLead: true,
      supervisorId: sup.id,
      payType: "HOURLY",
      payRate: "45.00",
    },
  });

  console.log(
    `fixtures ready — ${[boss, sup, admin, tech].map((u) => u.email).join(", ")}\n` +
      `  client ${client.name}, customer ${customer.code} #${site.siteNumber}\n` +
      `  project ${project.name}\n` +
      `  job ${job.intWoId} (${job.id})`,
  );
  await db.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});
