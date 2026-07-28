import { db } from "@/lib/db";
import { labourCents, toCents } from "@/lib/payroll";
import { assignmentTotals } from "@/lib/time-tracking";

/**
 * Per-tech statistics.
 *
 * The headline figure is the blended hourly rate: total earned divided by
 * total hours on site, counting flat-rate and non-billable visits in the
 * denominator. A tech taking flat-rate work needs to know what it actually
 * comes to per hour, and an average of the rates themselves would flatter it.
 */

export type StatsRange = { from: Date; to: Date } | { from: null; to: null };

export type Stats = {
  jobs: number;
  hourlyJobs: number;
  flatJobs: number;
  nonBillableJobs: number;
  onsiteMinutes: number;
  paidMinutes: number;
  earnedCents: number;
  reimbursedCents: number;
  /** Null when there are no hours to divide by. */
  blendedHourlyCents: number | null;
};

export async function computeStats(
  userId: string,
  range: StatsRange,
): Promise<Stats> {
  const assignments = await db.jobAssignment.findMany({
    where: {
      userId,
      visits:
        range.from && range.to
          ? { some: { clockInAt: { gte: range.from, lt: range.to } } }
          : { some: {} },
    },
    select: {
      payType: true,
      payRate: true,
      travelReimbursement: true,
      job: {
        select: {
          reimbursements: {
            where: { assignment: { userId } },
            select: { amount: true },
          },
        },
      },
      visits:
        range.from && range.to
          ? {
              where: { clockInAt: { gte: range.from, lt: range.to } },
              select: {
                clockInAt: true,
                clockOutAt: true,
                breaks: { select: { startAt: true, endAt: true, paid: true } },
              },
            }
          : {
              select: {
                clockInAt: true,
                clockOutAt: true,
                breaks: { select: { startAt: true, endAt: true, paid: true } },
              },
            },
    },
  });

  const stats: Stats = {
    jobs: assignments.length,
    hourlyJobs: 0,
    flatJobs: 0,
    nonBillableJobs: 0,
    onsiteMinutes: 0,
    paidMinutes: 0,
    earnedCents: 0,
    reimbursedCents: 0,
    blendedHourlyCents: null,
  };

  for (const assignment of assignments) {
    const totals = assignmentTotals(assignment.visits);

    stats.onsiteMinutes += totals.onsiteMinutes;
    stats.paidMinutes += totals.paidMinutes;
    stats.earnedCents += labourCents(
      assignment.payType,
      assignment.payRate,
      Math.round(totals.paidMinutes),
    );

    if (assignment.travelReimbursement) {
      stats.reimbursedCents += toCents(assignment.travelReimbursement);
    }
    for (const entry of assignment.job.reimbursements) {
      stats.reimbursedCents += toCents(entry.amount);
    }

    if (assignment.payType === "HOURLY") stats.hourlyJobs += 1;
    else if (assignment.payType === "FLAT") stats.flatJobs += 1;
    else stats.nonBillableJobs += 1;
  }

  // Divided by hours actually on site, not paid hours: an unpaid break still
  // cost the tech their afternoon and should drag the figure down.
  if (stats.onsiteMinutes > 0) {
    stats.blendedHourlyCents = Math.round(
      (stats.earnedCents * 60) / stats.onsiteMinutes,
    );
  }

  return stats;
}
