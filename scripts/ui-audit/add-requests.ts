import "dotenv/config";
import { db } from "@/lib/db";

// Writes change requests, so it is kept to the audit database.
if (!/quicktec_audit/.test(process.env.DATABASE_URL ?? "")) {
  console.error(
    "Refusing to run: DATABASE_URL is not the audit database. Source scripts/ui-audit/env.sh first.",
  );
  process.exit(1);
}

/** A site move and a punch correction waiting, so Approvals has every kind. */
async function main() {
  const tech = await db.user.findUniqueOrThrow({ where: { email: "tech@417group.org" } });
  const job = await db.job.findFirstOrThrow({
    where: { lifecycle: "SCHEDULED", assignments: { some: { userId: tech.id } }, title: "POS register refresh" },
    select: { id: true, siteId: true, customerId: true },
  });
  const other = await db.site.findFirstOrThrow({
    where: { customerId: job.customerId, id: { not: job.siteId } },
    select: { id: true },
  });
  await db.changeRequest.deleteMany({ where: { fieldPath: { in: ["siteId", "estimateMinutes"] } } });
  await db.changeRequest.create({
    data: {
      jobId: job.id,
      requestedById: tech.id,
      fieldPath: "siteId",
      oldValue: job.siteId,
      newValue: other.id,
      reason: "Dispatch gave the store across the road.",
    },
  });
  await db.changeRequest.create({
    data: {
      jobId: job.id,
      requestedById: tech.id,
      fieldPath: "estimateMinutes",
      oldValue: "240",
      newValue: "330",
      reason: "Two registers, not one.",
    },
  });

  const visit = await db.visit.findFirst({
    where: { clockOutAt: { not: null }, assignment: { userId: tech.id } },
    orderBy: { clockInAt: "desc" },
    select: { id: true, clockInAt: true, clockOutAt: true, assignment: { select: { jobId: true } } },
  });
  if (visit) {
    await db.changeRequest.deleteMany({ where: { fieldPath: { startsWith: "visit." } } });
    await db.changeRequest.create({
      data: {
        jobId: visit.assignment.jobId,
        requestedById: tech.id,
        fieldPath: `visit.${visit.id}.punch`,
        oldValue: JSON.stringify({ clockIn: visit.clockInAt.toISOString(), clockOut: visit.clockOutAt!.toISOString() }),
        newValue: JSON.stringify({
          clockIn: new Date(visit.clockInAt.getTime() - 30 * 60_000).toISOString(),
          clockOut: visit.clockOutAt!.toISOString(),
        }),
        reason: "Started unloading before I clocked in.",
      },
    });
  }
  console.log("requests added");
  await db.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});
