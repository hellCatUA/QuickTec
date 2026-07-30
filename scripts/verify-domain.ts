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
  const { calendarSlug, deleteEvent, ensureCalendar, putEvent } = await import(
    "@/lib/calendar/caldav"
  );

  type Recorded = {
    method: string;
    url: string;
    body: string;
    authorized: boolean;
  };
  const recorded: Recorded[] = [];
  let mkcalendarCalls = 0;

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
      if (req.method === "MKCALENDAR") {
        mkcalendarCalls += 1;
        // NextCloud answers 405 for a collection that already exists.
        res.writeHead(mkcalendarCalls === 1 ? 201 : 405).end();
        return;
      }
      if (req.method === "DELETE") {
        res.writeHead(req.url?.includes("missing") ? 404 : 204).end();
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
    "the sweep pushes the scheduled job and skips the undated one",
    `${sweep.pushed}/${sweep.skipped}/${sweep.failures.length}`,
    "1/1/0",
  );
  check(
    "the sweep is audited",
    await db.auditEvent.count({ where: { action: "calendar_synced" } }),
    1,
  );

  // An unreachable server is a failed sync, not a crash — the events are
  // simply a few minutes behind until it comes back.
  server.close();
  await new Promise((resolve) => setTimeout(resolve, 50));
  const offline = await syncJob(calJob.id);
  check(
    "a CalDAV server that is down is reported per tech",
    offline.failures.length > 0 && offline.pushed === 0,
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
