import "dotenv/config";
import { recordAudit } from "@/lib/audit";
import { roundToInterval, zonedParts, zonedWallTime } from "@/lib/datetime";
import { db } from "@/lib/db";
import { allocateIntWo, allocateRevisitIntWo, revisitAssignmentId } from "@/lib/int-wo";
import { notify } from "@/lib/notifications";
import { buildPayrollPeriod, weekRange } from "@/lib/payroll";
import type { JobLifecycle, JobOutcome, PayType } from "@prisma-client";

/**
 * A company's worth of believable work for looking at the interface with:
 * several customers and paying companies, three projects, a crew of six, and
 * jobs at every stage from a tech's ad-hoc request to a week that was paid.
 *
 * Runs on a database that already has the seed and the fixtures in it, and
 * refuses to run on any other than the audit one.
 */

if (!/quicktec_audit/.test(process.env.DATABASE_URL ?? "")) {
  console.error("Refusing to run: DATABASE_URL is not the audit database.");
  process.exit(1);
}

const TZ = "America/Los_Angeles";
const NOW = new Date();

/** A wall-clock time on the day `offset` days from today, in a zone. */
function at(offset: number, time: string, zone = TZ): Date {
  const today = zonedParts(NOW, zone);
  const [hour, minute] = time.split(":").map(Number);
  // Date.UTC normalises a day past the end of the month.
  const proxy = new Date(Date.UTC(today.year, today.month - 1, today.day + offset));
  return zonedWallTime(
    proxy.getUTCFullYear(),
    proxy.getUTCMonth() + 1,
    proxy.getUTCDate(),
    hour,
    minute,
    zone,
  );
}

type Person = { id: string; name: string; email: string };

async function main() {
  const find = (email: string) => db.user.findUniqueOrThrow({ where: { email } });
  const boss = await find("boss@417group.org");
  const sup = await find("sup@417group.org");
  const admin = await find("admin@417group.org");
  const tech = await find("tech@417group.org");
  const tech2 = await find("tech2@417group.org");

  // --- the company ----------------------------------------------------------
  await db.companySettings.update({
    where: { id: "singleton" },
    data: {
      name: "417 Group",
      addressLine1: "1140 W Main St",
      city: "Visalia",
      state: "CA",
      postalCode: "93291",
      phone: "5595550142",
      email: "office@417group.org",
      website: "https://417group.org",
    },
  });

  // --- people ---------------------------------------------------------------
  await db.user.update({
    where: { id: tech.id },
    data: {
      legalName: "Terrence Allen Tech",
      legalNameSetAt: at(-200, "09:00"),
      phone: "5595550111",
      workPhone: "5595550190",
      addressLine1: "815 S Court St",
      city: "Visalia",
      state: "CA",
      postalCode: "93277",
      primaryRegion: "CA",
      statesOfOperation: ["CA", "NV", "AZ"],
      serviceStartDate: new Date("2023-03-06"),
      lastLoginAt: at(0, "06:40"),
    },
  });
  await db.user.update({
    where: { id: tech2.id },
    data: {
      phone: "5595550122",
      city: "Fresno",
      state: "CA",
      postalCode: "93721",
      primaryRegion: "CA",
      statesOfOperation: ["CA"],
      serviceStartDate: new Date("2025-08-18"),
      lastLoginAt: at(0, "07:05"),
    },
  });
  await db.user.update({
    where: { id: boss.id },
    data: {
      workPhone: "5595550100",
      voipPhone: "5595550101",
      city: "Visalia",
      state: "CA",
      postalCode: "93291",
      primaryRegion: "CA",
      statesOfOperation: ["CA", "NV", "AZ", "OR"],
      serviceStartDate: new Date("2019-01-14"),
      lastLoginAt: at(0, "06:10"),
    },
  });
  await db.user.update({
    where: { id: sup.id },
    data: {
      workPhone: "5595550105",
      city: "Tulare",
      state: "CA",
      postalCode: "93274",
      primaryRegion: "CA",
      serviceStartDate: new Date("2021-06-01"),
      lastLoginAt: at(-1, "17:20"),
    },
  });

  const person = (data: {
    email: string;
    name: string;
    sub: string;
    role: "TECH" | "ACCOUNTANT" | "SUPERVISOR";
    supervisorId?: string;
    rate?: string;
    payType?: PayType;
    city: string;
    state: string;
    zip: string;
    phone: string;
    since: string;
  }) =>
    db.user.create({
      data: {
        email: data.email,
        name: data.name,
        nextcloudSub: data.sub,
        baseRole: data.role,
        timeZone: TZ,
        directSupervisorId: data.supervisorId,
        defaultPayType: data.payType ?? (data.rate ? "HOURLY" : undefined),
        defaultPayRate: data.rate,
        city: data.city,
        state: data.state,
        postalCode: data.zip,
        primaryRegion: data.state,
        statesOfOperation: [data.state],
        phone: data.phone,
        serviceStartDate: new Date(data.since),
        lastLoginAt: at(-1, "08:00"),
      },
    });

  const marcus = await person({
    email: "marcus.delgado@417group.org",
    name: "Marcus Delgado",
    sub: "sub-marcus",
    role: "TECH",
    supervisorId: boss.id,
    rate: "48.00",
    city: "Bakersfield",
    state: "CA",
    zip: "93301",
    phone: "6615550133",
    since: "2024-02-12",
  });
  const priya = await person({
    email: "priya.raman@417group.org",
    name: "Priya Raman",
    sub: "sub-priya",
    role: "TECH",
    supervisorId: admin.id,
    rate: "50.00",
    city: "Sacramento",
    state: "CA",
    zip: "95814",
    phone: "9165550144",
    since: "2022-10-03",
  });
  const oleks = await person({
    email: "oleksandr.kovalenko-whitfield@417group.org",
    name: "Oleksandr Kovalenko-Whitfield",
    sub: "sub-oleks",
    role: "TECH",
    supervisorId: boss.id,
    rate: "46.50",
    city: "Phoenix",
    state: "AZ",
    zip: "85004",
    phone: "6025550155",
    since: "2026-09-21",
  });
  await person({
    email: "nora.pell@417group.org",
    name: "Nora Pell",
    sub: "sub-nora",
    role: "ACCOUNTANT",
    city: "Visalia",
    state: "CA",
    zip: "93291",
    phone: "5595550166",
    since: "2020-04-20",
  });

  // --- who the work is for ---------------------------------------------------
  const mettel = await db.client.findUniqueOrThrow({ where: { name: "Mettel" } });
  const netcom = await db.client.findUniqueOrThrow({ where: { name: "NetCom Sub" } });
  const granite = await db.client.create({
    data: { name: "Granite Telecommunications", code: "GRN" },
  });
  await db.client.create({ data: { name: "TeleSource Field Services", code: "TSF" } });
  const fss = await db.repCompany.findUniqueOrThrow({
    where: { name: "Federated Service Systems" },
  });
  await db.repCompany.create({ data: { name: "Kyndryl", code: "KYN" } });

  const tsa = await db.customer.findUniqueOrThrow({ where: { code: "TSA" } });
  const customer = (name: string, code: string) =>
    db.customer.upsert({ where: { code }, update: {}, create: { name, code } });
  const sbux = await customer("Starbucks", "SBUX");
  const tgt = await customer("Target", "TGT");
  const wag = await customer("Walgreens", "WAG");
  const cmg = await customer("Chipotle Mexican Grill", "CMG");

  const site = (
    customerId: string,
    siteNumber: string,
    name: string | null,
    addressLine1: string,
    city: string,
    state: string,
    postalCode: string,
    timeZone: string,
    extra: { numberPending?: boolean; notes?: string } = {},
  ) =>
    db.site.upsert({
      where: { customerId_siteNumber: { customerId, siteNumber } },
      update: {},
      create: {
        customerId,
        siteNumber,
        name,
        addressLine1,
        city,
        state,
        postalCode,
        timeZone,
        ...extra,
      },
    });

  const covina = await db.site.findFirstOrThrow({ where: { siteNumber: "4471" } });
  const sbuxVisalia = await site(sbux.id, "10542", "Mooney & Walnut", "3515 S Mooney Blvd", "Visalia", "CA", "93277", TZ);
  const sbuxFresno = await site(sbux.id, "8817", "River Park", "7775 N Blackstone Ave", "Fresno", "CA", "93720", TZ, {
    notes: "Loading dock is behind the building. Ask for the shift lead, not the barista on bar.",
  });
  const sbuxPhoenix = await site(sbux.id, "21190", "Camelback & 7th", "702 E Camelback Rd", "Phoenix", "AZ", "85014", "America/Phoenix");
  const sbuxPending = await site(sbux.id, "PENDING-1", null, "1200 Truxtun Ave", "Bakersfield", "CA", "93301", TZ, {
    numberPending: true,
  });
  const tgtClovis = await site(tgt.id, "T-2204", "Clovis Crossing", "1125 Shaw Ave", "Clovis", "CA", "93612", TZ);
  const tgtDenver = await site(tgt.id, "T-1806", "Stapleton", "7930 E 49th Ave", "Denver", "CO", "80238", "America/Denver");
  const wagTulare = await site(wag.id, "06311", null, "1055 E Prosperity Ave", "Tulare", "CA", "93274", TZ);
  const cmgHanford = await site(cmg.id, "3344", "Hanford Mall", "1675 W Lacey Blvd", "Hanford", "CA", "93230", TZ);
  const tsaLong = await site(tsa.id, "5120", "Rancho Cucamonga Senior Apartments — Building C (East Wing)", "9055 Foothill Blvd", "Rancho Cucamonga", "CA", "91730", TZ);

  // --- projects --------------------------------------------------------------
  const elevator = await db.project.findFirstOrThrow({ where: { code: "P-9" } });
  await db.project.update({
    where: { id: elevator.id },
    data: { customerId: tsa.id, repCompanyId: fss.id },
  });

  const coordinator = await db.externalContact.create({
    data: {
      name: "Renee Whitcomb",
      title: "Project Coordinator",
      phone: "8005550175",
      email: "renee.whitcomb@netcomsub.example",
      clientId: netcom.id,
    },
  });

  const pos = await db.project.create({
    data: {
      name: "Starbucks POS refresh 2026",
      code: "SBX-POS",
      clientProjectName: "SBUX Register Refresh Wave 4",
      externalProjectId: "NC-44817",
      clientId: netcom.id,
      customerId: sbux.id,
      repCompanyId: fss.id,
      managerId: boss.id,
      pmContactId: coordinator.id,
      defaultJobTitle: "POS register refresh",
      generalScopeOfWork:
        "Replace each register's POS terminal and receipt printer with the new kit.\n\n" +
        "- [ ] Check in with the MOD and the NOC before touching anything\n" +
        "- [ ] Photograph every register before and after\n" +
        "- [ ] Record old and new serial numbers\n" +
        "- [ ] Box the old terminals and attach the return labels\n" +
        "- [ ] Test a card transaction on every lane with the MOD watching",
      travelReimbursement: "25.00",
      breakPaid: false,
      defaultPayType: "HOURLY",
      defaultPayRate: "45.00",
      members: {
        create: [
          { userId: sup.id, role: "SUPERVISOR" },
          { userId: tech.id, role: "TECH" },
          { userId: tech2.id, role: "TECH" },
          { userId: marcus.id, role: "TECH" },
        ],
      },
      locations: {
        create: [
          { name: "MDF", icon: "server", order: 0 },
          { name: "Register 1", order: 1 },
          { name: "Register 2", order: 2 },
          { name: "Drive-thru", order: 3 },
        ],
      },
      deliverableRules: {
        create: [
          { category: "PRE_INSTALL", required: true, minPhotos: 2, perLocation: true, order: 0, note: "Wide shot and a close-up of the cabling." },
          { category: "POST_INSTALL", required: true, minPhotos: 2, perLocation: true, order: 1 },
          { category: "OLD_SERIALS", required: true, requiresPhoto: false, requiresText: true, order: 2 },
          { category: "NEW_SERIALS", required: true, requiresPhoto: false, requiresText: true, order: 3 },
          { category: "RETURN_LABELS", required: false, order: 4 },
          { category: "SIGN_OFF", required: true, order: 5 },
          { category: "ISSUES", required: false, requiresPhoto: false, requiresText: true, order: 6 },
        ],
      },
      dispatchContacts: {
        create: [
          { label: "NOC", name: "NetCom night desk", phone: "8005550100", order: 0 },
          { label: "Field support", name: "Renee Whitcomb", phone: "8005550175", email: "renee.whitcomb@netcomsub.example", order: 1 },
        ],
      },
    },
  });

  const cameras = await db.project.create({
    data: {
      name: "Target camera cutover",
      code: "TGT-CAM",
      clientId: granite.id,
      customerId: tgt.id,
      managerId: boss.id,
      defaultBudgetType: "FLAT",
      defaultBudgetFlat: "600.00",
      members: {
        create: [
          { userId: sup.id, role: "SUPERVISOR" },
          { userId: priya.id, role: "TECH" },
          { userId: oleks.id, role: "TECH" },
        ],
      },
    },
  });

  await db.project.create({
    data: {
      name: "Walgreens pharmacy phone lines",
      code: "WAG-22",
      clientId: mettel.id,
      customerId: wag.id,
      managerId: boss.id,
      status: "CLOSED",
    },
  });

  // --- jobs -------------------------------------------------------------------
  type Crew = { who: Person; lead?: boolean; rate?: string; payType?: PayType; flat?: string };
  type Worked = {
    /** Clock-in and clock-out as "HH:MM" on the job's day; out omitted = still on site. */
    in: string;
    out?: string;
    breaks?: { start: string; end?: string; paid?: boolean }[];
    manual?: boolean;
  };

  let externalCounter = 90100;

  async function job(input: {
    title: string;
    day: number | null;
    time?: string;
    estimate?: number;
    siteId: string;
    customerId: string;
    clientId: string;
    project?: { id: string; code: string };
    repCompanyId?: string;
    lifecycle: JobLifecycle;
    outcome?: JobOutcome;
    crew: Crew[];
    worked?: Worked;
    scope?: string;
    createdBy?: Person;
    zone?: string;
    ticket?: string;
    inc?: string;
    reviewNote?: string;
    internalStatus?: "REVISIT_REQUIRED" | "RESCHEDULED";
    techsRequired?: number;
    budget?: { type: PayType; flat?: string; hourly?: string };
    workPerformed?: string;
    releaseCode?: string;
  }) {
    const zone = input.zone ?? TZ;
    const scheduledStart = input.day === null ? null : at(input.day, input.time ?? "09:00", zone);
    const creator = input.createdBy ?? boss;

    const allocated = await db.$transaction((tx) =>
      allocateIntWo(tx, {
        projectId: input.project?.id ?? null,
        projectCode: input.project?.code ?? null,
        effectiveDate: scheduledStart ?? NOW,
        timeZone: zone,
      }),
    );

    const worked = input.worked;
    const reviewed: JobLifecycle[] = ["APPROVED", "BILLED", "CLOSED"];
    const createdAt = scheduledStart
      ? new Date(Math.min(scheduledStart.getTime() - 3 * 86_400_000, NOW.getTime() - 3_600_000))
      : new Date(NOW.getTime() - 86_400_000);

    const created = await db.job.create({
      data: {
        intWoId: allocated.intWoId,
        intWoSequence: allocated.sequence,
        title: input.title,
        clientId: input.clientId,
        customerId: input.customerId,
        siteId: input.siteId,
        projectId: input.project?.id,
        repCompanyId: input.repCompanyId,
        createdById: creator.id,
        externalAssignmentId: `A-${externalCounter++}`,
        ticketNumber: input.ticket ?? String(6_682_000 + externalCounter),
        incNumber: input.inc,
        scheduledStart,
        estimateMinutes: input.estimate ?? 120,
        techsRequired: input.techsRequired ?? Math.max(1, input.crew.length),
        lifecycle: input.lifecycle,
        outcome: input.outcome,
        internalStatus: input.internalStatus,
        scopeOfWork: input.scope,
        breakPaid: false,
        travelReimbursement: input.project?.code === "SBX-POS" ? "25.00" : undefined,
        budgetType: input.budget?.type,
        budgetFlat: input.budget?.flat,
        budgetHourly: input.budget?.hourly,
        releaseCode: input.releaseCode,
        workPerformedMerged: input.workPerformed,
        reviewNote: input.reviewNote,
        reviewNoteById: input.reviewNote ? boss.id : undefined,
        reviewNoteAt: input.reviewNote ? new Date(NOW.getTime() - 4 * 3_600_000) : undefined,
        approvedById: reviewed.includes(input.lifecycle) ? boss.id : undefined,
        approvedAt:
          reviewed.includes(input.lifecycle) && scheduledStart
            ? new Date(scheduledStart.getTime() + 30 * 3_600_000)
            : undefined,
        billedAt:
          (input.lifecycle === "BILLED" || input.lifecycle === "CLOSED") && scheduledStart
            ? new Date(scheduledStart.getTime() + 8 * 86_400_000)
            : undefined,
        closedAt:
          input.lifecycle === "CLOSED" && scheduledStart
            ? new Date(scheduledStart.getTime() + 12 * 86_400_000)
            : undefined,
        createdAt,
      },
    });

    await recordAudit({
      actorId: creator.id,
      entityType: "Job",
      entityId: created.id,
      action: "created",
      jobId: created.id,
      projectId: input.project?.id,
    });
    await db.auditEvent.updateMany({
      where: { jobId: created.id, action: "created" },
      data: { createdAt },
    });

    for (const member of input.crew) {
      const user = await db.user.findUniqueOrThrow({
        where: { id: member.who.id },
        select: { defaultPayRate: true, directSupervisorId: true },
      });
      const assignment = await db.jobAssignment.create({
        data: {
          jobId: created.id,
          userId: member.who.id,
          isLead: Boolean(member.lead),
          supervisorId: user.directSupervisorId,
          payType: member.payType ?? (member.flat ? "FLAT" : "HOURLY"),
          payRate: member.flat ?? member.rate ?? user.defaultPayRate ?? "45.00",
          workPerformed: worked?.out && member.lead ? input.workPerformed : undefined,
          createdAt,
        },
      });
      await db.auditEvent.create({
        data: {
          actorId: creator.id,
          entityType: "JobAssignment",
          entityId: assignment.id,
          action: "tech_assigned",
          jobId: created.id,
          detail: { who: member.who.name },
          createdAt: new Date(createdAt.getTime() + 60_000),
        },
      });
      if (member.who.id !== creator.id) {
        await notify({
          userId: member.who.id,
          actorId: creator.id,
          kind: "job_assigned",
          title: `You are on ${input.title}`,
          body: allocated.intWoId,
          href: `/jobs/${created.id}`,
          jobId: created.id,
        });
      }

      if (worked && input.day !== null) {
        const clockIn = roundToInterval(at(input.day, worked.in, zone), 5);
        const clockOut = worked.out ? roundToInterval(at(input.day, worked.out, zone), 5) : null;
        const visit = await db.visit.create({
          data: {
            assignmentId: assignment.id,
            clockInAt: clockIn,
            clockInRawAt: new Date(clockIn.getTime() + 70_000),
            clockInSource: worked.manual ? "MANUAL" : "NOW",
            clockOutAt: clockOut,
            clockOutRawAt: clockOut ? new Date(clockOut.getTime() - 50_000) : null,
            clockOutSource: clockOut ? (worked.manual ? "MANUAL" : "NOW") : null,
            addedManually: Boolean(worked.manual),
            breaks: {
              create: (worked.breaks ?? []).map((pause) => ({
                startAt: at(input.day!, pause.start, zone),
                endAt: pause.end ? at(input.day!, pause.end, zone) : null,
                paid: Boolean(pause.paid),
              })),
            },
          },
        });
        await db.auditEvent.create({
          data: {
            actorId: member.who.id,
            entityType: "Visit",
            entityId: visit.id,
            action: "clock_in",
            jobId: created.id,
            detail: { who: member.who.name },
            createdAt: clockIn,
          },
        });
        if (clockOut) {
          await db.auditEvent.create({
            data: {
              actorId: member.who.id,
              entityType: "Visit",
              entityId: visit.id,
              action: "clock_out",
              jobId: created.id,
              detail: { who: member.who.name },
              createdAt: clockOut,
            },
          });
        }
      }
    }

    if (worked?.out && input.day !== null) {
      const lead = input.crew.find((member) => member.lead) ?? input.crew[0];
      await db.auditEvent.create({
        data: {
          actorId: lead.who.id,
          entityType: "Job",
          entityId: created.id,
          action: "checkout_completed",
          jobId: created.id,
          createdAt: roundToInterval(at(input.day, worked.out, zone), 5),
        },
      });
    }
    if (reviewed.includes(input.lifecycle) && scheduledStart) {
      await db.auditEvent.create({
        data: {
          actorId: boss.id,
          entityType: "Job",
          entityId: created.id,
          action: "report_approved",
          jobId: created.id,
          createdAt: new Date(scheduledStart.getTime() + 30 * 3_600_000),
        },
      });
    }

    return created;
  }

  const posProject = { id: pos.id, code: pos.code };
  const camProject = { id: cameras.id, code: cameras.code };
  const elevatorProject = { id: elevator.id, code: elevator.code };
  const P = (user: { id: string; name: string; email: string }): Person => user;

  const posScope =
    "Registers 1 and 2 only at this store — the drive-thru terminal was replaced in March.\n\n" +
    "- [ ] Confirm the new kit arrived (2 terminals, 2 printers)\n" +
    "- [ ] Swap register 1\n" +
    "- [ ] Swap register 2\n" +
    "- [ ] Return labels on both old terminals";

  // Today, on site right now: two techs, one back from a break.
  const onSite = await job({
    title: "POS register refresh",
    day: 0,
    time: "07:30",
    estimate: 240,
    siteId: sbuxVisalia.id,
    customerId: sbux.id,
    clientId: netcom.id,
    project: posProject,
    repCompanyId: fss.id,
    lifecycle: "IN_PROGRESS",
    crew: [{ who: P(tech), lead: true }, { who: P(tech2) }],
    worked: { in: "07:32", breaks: [{ start: "09:40", end: "09:55" }] },
    scope: posScope,
    inc: "INC0048812",
  });

  await job({
    title: "Elevator emergency line — no dial tone",
    day: 0,
    time: "14:00",
    estimate: 120,
    siteId: tsaLong.id,
    customerId: tsa.id,
    clientId: mettel.id,
    project: elevatorProject,
    repCompanyId: fss.id,
    lifecycle: "SCHEDULED",
    crew: [{ who: P(tech), lead: true }],
    scope: "Trace the elevator emergency line from the MPOE to the car. Customer reports no dial tone since Friday.",
  });

  await job({
    title: "POS register refresh",
    day: 1,
    time: "06:00",
    estimate: 300,
    siteId: sbuxFresno.id,
    customerId: sbux.id,
    clientId: netcom.id,
    project: posProject,
    repCompanyId: fss.id,
    lifecycle: "SCHEDULED",
    crew: [{ who: P(tech), lead: true }, { who: P(marcus) }],
    scope: posScope,
  });

  await job({
    title: "POS register refresh",
    day: 2,
    time: "05:30",
    estimate: 240,
    siteId: sbuxPending.id,
    customerId: sbux.id,
    clientId: netcom.id,
    project: posProject,
    lifecycle: "SCHEDULED",
    crew: [{ who: P(tech), lead: true }],
  });

  await job({
    title: "Replace failed 48-port switch in the back office and re-terminate the patch panel",
    day: 3,
    time: "09:00",
    estimate: 180,
    siteId: cmgHanford.id,
    customerId: cmg.id,
    clientId: granite.id,
    lifecycle: "SCHEDULED",
    crew: [{ who: P(tech), lead: true }],
    budget: { type: "FLAT", flat: "350.00" },
  });

  // Asked for by the tech on site; waits for a supervisor.
  await job({
    title: "Pharmacy fax line down",
    day: 0,
    time: "16:30",
    estimate: 60,
    siteId: wagTulare.id,
    customerId: wag.id,
    clientId: mettel.id,
    lifecycle: "PENDING_APPROVAL",
    crew: [{ who: P(tech), lead: true }],
    createdBy: P(tech),
  });

  // Yesterday: worked, waiting on a review.
  const awaitingReview = await job({
    title: "POS register refresh",
    day: -1,
    time: "07:00",
    estimate: 240,
    siteId: sbuxPhoenix.id,
    customerId: sbux.id,
    clientId: netcom.id,
    project: posProject,
    repCompanyId: fss.id,
    zone: "America/Phoenix",
    lifecycle: "PENDING_REVIEW",
    outcome: "COMPLETED",
    crew: [{ who: P(tech), lead: true }, { who: P(oleks) }],
    worked: { in: "07:04", out: "11:42", breaks: [{ start: "09:30", end: "09:45" }] },
    scope: posScope,
    workPerformed:
      "Swapped both registers. Register 2's old printer cable was zip-tied behind the counter and had to be cut free. Card test passed on both lanes with the MOD.",
    releaseCode: "RLS-20931",
  });

  await job({
    title: "Camera cutover — sales floor",
    day: -1,
    time: "21:00",
    estimate: 360,
    siteId: tgtClovis.id,
    customerId: tgt.id,
    clientId: granite.id,
    project: camProject,
    lifecycle: "PENDING_REVIEW",
    outcome: "INCOMPLETE",
    internalStatus: "REVISIT_REQUIRED",
    crew: [{ who: P(priya), lead: true }, { who: P(oleks) }],
    worked: { in: "21:02", out: "23:55" },
    budget: { type: "FLAT", flat: "600.00" },
    workPerformed:
      "12 of 18 cameras cut over. Lift was not available after 23:30, so the six over electronics are still on the old NVR.",
  });

  // Sent back with a note.
  await job({
    title: "POS register refresh",
    day: -3,
    time: "06:30",
    estimate: 240,
    siteId: sbuxFresno.id,
    customerId: sbux.id,
    clientId: netcom.id,
    project: posProject,
    lifecycle: "CHANGES_REQUESTED",
    outcome: "COMPLETED",
    crew: [{ who: P(tech), lead: true }],
    worked: { in: "06:28", out: "10:15", breaks: [{ start: "08:30", end: "08:45" }] },
    reviewNote:
      "Old serials are missing for register 2, and the post-install photo of register 1 is the pre-install one uploaded twice. Please fix both and resubmit.",
    workPerformed: "Both registers swapped and tested.",
    releaseCode: "RLS-20877",
  });

  // Approved last week.
  for (const [day, timeIn, timeOut, where] of [
    [-6, "07:00", "11:20", sbuxVisalia],
    [-7, "06:02", "10:40", sbuxFresno],
    [-8, "12:00", "15:05", sbuxVisalia],
  ] as const) {
    await job({
      title: "POS register refresh",
      day,
      time: timeIn,
      estimate: 240,
      siteId: where.id,
      customerId: sbux.id,
      clientId: netcom.id,
      project: posProject,
      lifecycle: "APPROVED",
      outcome: "COMPLETED",
      crew: [{ who: P(tech), lead: true }],
      worked: { in: timeIn, out: timeOut, breaks: [{ start: "09:00", end: "09:15" }] },
      workPerformed: "Registers swapped, serials recorded, returns boxed and labelled.",
      releaseCode: `RLS-2${String(8000 + Math.abs(day) * 37)}`,
    });
  }

  // Approved, but somebody has to go back.
  const needsRevisit = await job({
    title: "Elevator emergency line — no dial tone",
    day: -5,
    time: "13:00",
    estimate: 120,
    siteId: covina.id,
    customerId: tsa.id,
    clientId: mettel.id,
    project: elevatorProject,
    repCompanyId: fss.id,
    lifecycle: "APPROVED",
    outcome: "INCOMPLETE",
    internalStatus: "REVISIT_REQUIRED",
    crew: [{ who: P(tech), lead: true }],
    worked: { in: "13:05", out: "15:10" },
    workPerformed:
      "Line is dead at the MPOE. Carrier ticket opened (CR-551902); nothing more to do on site until they restore service.",
  });

  const revisitNumber = await db.$transaction((tx) =>
    allocateRevisitIntWo(tx, {
      parentJobId: needsRevisit.id,
      effectiveDate: at(4, "10:00"),
      timeZone: TZ,
    }),
  );
  const revisit = await db.job.create({
    data: {
      intWoId: revisitNumber.intWoId,
      intWoSequence: revisitNumber.sequence,
      revisitNumber: revisitNumber.revisitNumber,
      parentJobId: needsRevisit.id,
      title: needsRevisit.title,
      clientId: mettel.id,
      customerId: tsa.id,
      siteId: covina.id,
      projectId: elevator.id,
      repCompanyId: fss.id,
      createdById: boss.id,
      externalAssignmentId: revisitAssignmentId(needsRevisit.externalAssignmentId),
      ticketNumber: needsRevisit.ticketNumber,
      scheduledStart: at(4, "10:00"),
      estimateMinutes: 90,
      lifecycle: "SCHEDULED",
      scopeOfWork: "Carrier restored service 11/7. Re-test the line end to end and close out.",
      assignments: {
        create: {
          userId: tech.id,
          isLead: true,
          supervisorId: boss.id,
          payType: "HOURLY",
          payRate: "45.00",
        },
      },
    },
  });
  await recordAudit({
    actorId: boss.id,
    entityType: "Job",
    entityId: revisit.id,
    action: "revisit_created",
    jobId: revisit.id,
    projectId: elevator.id,
  });

  // Older: billed, closed, rejected, cancelled.
  await job({
    title: "POS register refresh",
    day: -13,
    time: "07:00",
    siteId: sbuxVisalia.id,
    customerId: sbux.id,
    clientId: netcom.id,
    project: posProject,
    lifecycle: "BILLED",
    outcome: "COMPLETED",
    crew: [{ who: P(tech), lead: true }, { who: P(tech2) }],
    worked: { in: "07:00", out: "12:10", breaks: [{ start: "09:30", end: "10:00" }] },
    workPerformed: "Three registers swapped including the drive-thru.",
  });
  await job({
    title: "Camera cutover — stockroom",
    day: -14,
    time: "20:00",
    siteId: tgtDenver.id,
    customerId: tgt.id,
    clientId: granite.id,
    project: camProject,
    zone: "America/Denver",
    lifecycle: "BILLED",
    outcome: "COMPLETED",
    crew: [{ who: P(priya), lead: true }],
    worked: { in: "20:00", out: "23:30" },
    budget: { type: "FLAT", flat: "600.00" },
  });
  await job({
    title: "Elevator phone line install",
    day: -21,
    time: "08:00",
    siteId: covina.id,
    customerId: tsa.id,
    clientId: mettel.id,
    project: elevatorProject,
    lifecycle: "CLOSED",
    outcome: "COMPLETED",
    crew: [{ who: P(tech), lead: true }],
    worked: { in: "08:00", out: "12:00", breaks: [{ start: "10:00", end: "10:15", paid: true }] },
  });
  await job({
    title: "Site survey — menu boards",
    day: -9,
    time: "10:00",
    siteId: cmgHanford.id,
    customerId: cmg.id,
    clientId: granite.id,
    lifecycle: "REJECTED",
    outcome: "FAIL",
    crew: [{ who: P(marcus), lead: true }],
    worked: { in: "10:10", out: "10:55" },
    reviewNote: "Wrong store — this was dispatched to #3344 but the work order is for #3434. Not billable.",
  });
  await job({
    title: "Pharmacy fax line down",
    day: -4,
    time: "11:00",
    siteId: wagTulare.id,
    customerId: wag.id,
    clientId: mettel.id,
    lifecycle: "APPROVED",
    outcome: "CANCEL",
    crew: [{ who: P(tech2), lead: true }],
    worked: { in: "11:00", out: "11:25" },
    workPerformed: "Store manager cancelled on arrival: carrier had already fixed it remotely.",
  });

  // The rest of the crew's week, so a manager's dashboard is busy.
  await job({
    title: "Camera cutover — sales floor",
    day: 1,
    time: "21:00",
    estimate: 360,
    siteId: tgtClovis.id,
    customerId: tgt.id,
    clientId: granite.id,
    project: camProject,
    lifecycle: "SCHEDULED",
    crew: [{ who: P(priya), lead: true }, { who: P(oleks) }],
    budget: { type: "FLAT", flat: "600.00" },
  });
  await job({
    title: "POS register refresh",
    day: 2,
    time: "13:00",
    estimate: 240,
    siteId: sbuxPhoenix.id,
    customerId: sbux.id,
    clientId: netcom.id,
    project: posProject,
    zone: "America/Phoenix",
    lifecycle: "SCHEDULED",
    crew: [{ who: P(oleks), lead: true }],
  });
  await job({
    title: "POS register refresh",
    day: 3,
    time: "06:00",
    estimate: 240,
    siteId: sbuxVisalia.id,
    customerId: sbux.id,
    clientId: netcom.id,
    project: posProject,
    lifecycle: "SCHEDULED",
    crew: [],
    techsRequired: 2,
  });
  await job({
    title: "Camera cutover — parking lot",
    day: null,
    siteId: tgtDenver.id,
    customerId: tgt.id,
    clientId: granite.id,
    project: camProject,
    zone: "America/Denver",
    lifecycle: "SCHEDULED",
    crew: [{ who: P(priya), lead: true }],
  });
  await job({
    title: "Pharmacy fax line down",
    day: 0,
    time: "10:00",
    estimate: 60,
    siteId: wagTulare.id,
    customerId: wag.id,
    clientId: mettel.id,
    lifecycle: "IN_PROGRESS",
    crew: [{ who: P(marcus), lead: true }],
    worked: { in: "10:05", breaks: [{ start: "11:30" }] },
  });

  // --- what the day left behind ------------------------------------------------
  const lead = await db.jobAssignment.findFirstOrThrow({
    where: { jobId: awaitingReview.id, userId: tech.id },
  });
  await db.reimbursement.createMany({
    data: [
      { jobId: awaitingReview.id, assignmentId: lead.id, type: "PARKING", amount: "12.00" },
      { jobId: awaitingReview.id, assignmentId: lead.id, type: "MATERIAL", label: "Cat6 Keystone", quantity: 2, amount: "16.00" },
    ],
  });
  await db.pointOfContact.createMany({
    data: [
      { jobId: awaitingReview.id, type: "MOD", name: "Dana O'Reilly", position: "SM/Store Manager", phone: "6025550181", order: 0 },
      { jobId: awaitingReview.id, type: "NOC", name: "Imran", position: "NOC Engineer", order: 0 },
      { jobId: onSite.id, type: "MOD", name: "Jessie Tran", position: "SS/Shift Supervisor", order: 0 },
    ],
  });
  for (const jobId of [awaitingReview.id, onSite.id]) {
    const assignment = await db.jobAssignment.findFirstOrThrow({ where: { jobId, userId: tech.id } });
    await db.deliverableItem.createMany({
      data: [
        { jobId, assignmentId: assignment.id, category: "OLD_SERIALS", textValue: "R1: 5CG9382KXT\nR2: 5CG9382L01" },
        ...(jobId === awaitingReview.id
          ? [{ jobId, assignmentId: assignment.id, category: "NEW_SERIALS" as const, textValue: "R1: 8CC2410PQR\nR2: 8CC2410PQZ" }]
          : []),
      ],
    });
  }

  // A change the tech asked for and nobody has answered.
  const upcoming = await db.job.findFirstOrThrow({
    where: { siteId: sbuxFresno.id, lifecycle: "SCHEDULED" },
  });
  await db.changeRequest.create({
    data: {
      jobId: upcoming.id,
      requestedById: tech.id,
      fieldPath: "scheduledStart",
      oldValue: upcoming.scheduledStart?.toISOString() ?? null,
      newValue: at(1, "07:00").toISOString(),
      reason: "Store does not open the back door before 6:45.",
    },
  });

  // Mileage for the week.
  const mileage = (
    day: number,
    start: string,
    end: string,
    category: "IN_ROUTE_TO_WO" | "RETURNING_HOME" | "OFFCLOCK_TOOLS_SUPPLIES" | "OTHER",
    from: number,
    miles: number,
    extra: { jobId?: string; reference?: string | null; note?: string } = {},
  ) =>
    db.mileageEntry.create({
      data: {
        userId: tech.id,
        category,
        startOdometer: from.toFixed(1),
        endOdometer: (from + miles).toFixed(1),
        miles: miles.toFixed(1),
        rate: "0.7000",
        amount: (miles * 0.7).toFixed(2),
        startedAt: at(day, start),
        endedAt: at(day, end),
        ...extra,
      },
    });
  await mileage(-1, "05:10", "06:55", "IN_ROUTE_TO_WO", 48211.4, 96.2, {
    jobId: awaitingReview.id,
    reference: awaitingReview.externalAssignmentId,
  });
  await mileage(-1, "11:50", "13:40", "RETURNING_HOME", 48307.6, 97.0);
  await mileage(-2, "16:00", "16:25", "OFFCLOCK_TOOLS_SUPPLIES", 48190.0, 11.8, {
    note: "Home Depot — zip ties and a fish tape.",
  });
  await mileage(0, "07:05", "07:25", "IN_ROUTE_TO_WO", 48404.6, 7.3, {
    jobId: onSite.id,
    reference: onSite.externalAssignmentId,
  });

  // --- payroll: last week built and approved, the one before paid ------------
  const settings = await db.companySettings.findUniqueOrThrow({ where: { id: "singleton" } });
  for (const [weeksAgo, status] of [
    [1, "APPROVED"],
    [2, "RECEIVED"],
    [3, "RECEIVED"],
  ] as const) {
    for (const who of [tech, tech2, priya]) {
      const week = weekRange(new Date(NOW.getTime() - weeksAgo * 7 * 86_400_000), TZ);
      const periodId = await buildPayrollPeriod({
        userId: who.id,
        week,
        timeZone: TZ,
        payLagWeeks: settings.payLagWeeks,
      });
      const period = await db.payrollPeriod.findUniqueOrThrow({
        where: { id: periodId },
        include: { lines: true },
      });
      if (period.lines.length === 0) {
        await db.payrollPeriod.delete({ where: { id: periodId } });
        continue;
      }
      if (who.id === priya.id && weeksAgo === 1) continue; // left as a draft
      await db.payrollPeriod.update({
        where: { id: periodId },
        data: {
          status,
          approvedById: boss.id,
          approvedAt: new Date(week.end.getTime() + 2 * 86_400_000),
          approvedAsFallback: who.id === tech2.id,
          receivedAmount: status === "RECEIVED" ? period.expectedAmount : undefined,
          receivedDate: status === "RECEIVED" ? new Date(week.end.getTime() + 20 * 86_400_000) : undefined,
        },
      });
      await db.payrollLine.updateMany({
        where: { payrollPeriodId: periodId },
        data: {
          payStatus: status,
          receivedDate: status === "RECEIVED" ? new Date(week.end.getTime() + 20 * 86_400_000) : undefined,
        },
      });
      if (status === "RECEIVED") {
        for (const line of period.lines) {
          await db.payrollLine.update({
            where: { id: line.id },
            data: { receivedAmount: line.totalExpected },
          });
        }
      }
    }
  }

  const counts = {
    users: await db.user.count(),
    jobs: await db.job.count(),
    visits: await db.visit.count(),
    periods: await db.payrollPeriod.count(),
    notifications: await db.notification.count(),
  };
  console.log("demo data ready", counts);
  await db.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});
