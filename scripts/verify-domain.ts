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
  check(
    "zip contains the internal work order",
    names.some(
      (name) => name.startsWith("QuickTec INT WO/") && name.endsWith(".pdf"),
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

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  await db.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
