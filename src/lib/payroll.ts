import {
  endOfWeekMonday,
  isoDateInZone,
  startOfWeekMonday,
  zonedParts,
} from "@/lib/datetime";
import { db } from "@/lib/db";
import { assignmentTotals } from "@/lib/time-tracking";
import type { PayType } from "@prisma-client";

/**
 * Pay arithmetic.
 *
 * A pay period is one Monday-to-Sunday week for one tech, approved by that
 * tech's direct supervisor — the person who actually pays them — whatever
 * projects the week's work happened to fall under.
 *
 * Money is handled in cents as integers throughout. Adding a dozen job totals
 * as floats and rounding at the end is how a week ends up a penny out and
 * someone spends an afternoon on it.
 */

export type WeekRange = { start: Date; end: Date };

export function weekRange(date: Date, timeZone: string): WeekRange {
  return {
    start: startOfWeekMonday(date, timeZone),
    end: endOfWeekMonday(date, timeZone),
  };
}

/**
 * Which month a week is filed under: the one its Monday falls in. A week that
 * starts on 29 September belongs to September even though most of its days are
 * October, and October must not count it twice.
 */
export function weekMonth(
  weekStart: Date,
  timeZone: string,
): { year: number; month: number } {
  const { year, month } = zonedParts(weekStart, timeZone);
  return { year, month };
}

/** Every Monday whose week is filed under the given month. */
export function weeksInMonth(
  year: number,
  month: number,
  timeZone: string,
): WeekRange[] {
  const weeks: WeekRange[] = [];

  // Walk day by day from the 1st; cheap, and it sidesteps every off-by-one
  // that arithmetic on month lengths invites.
  for (let day = 1; day <= 31; day++) {
    const probe = new Date(Date.UTC(year, month - 1, day, 12));
    if (probe.getUTCMonth() !== month - 1) break;

    const start = startOfWeekMonday(probe, timeZone);
    const filed = weekMonth(start, timeZone);
    if (filed.year !== year || filed.month !== month) continue;

    if (!weeks.some((week) => week.start.getTime() === start.getTime())) {
      weeks.push({ start, end: endOfWeekMonday(start, timeZone) });
    }
  }

  return weeks;
}

export function expectedPayDate(weekEnd: Date, lagWeeks: number): Date {
  return new Date(weekEnd.getTime() + lagWeeks * 7 * 24 * 60 * 60_000);
}

// --- money -----------------------------------------------------------------

export function toCents(value: string | number | { toString(): string }): number {
  return Math.round(Number(value.toString()) * 100);
}

export function fromCents(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function labourCents(
  payType: PayType,
  rate: string | { toString(): string },
  paidMinutes: number,
): number {
  if (payType === "NON_BILLABLE") return 0;
  const rateCents = toCents(rate);
  if (payType === "FLAT") return rateCents;
  return Math.round((rateCents * paidMinutes) / 60);
}

// --- building a week -------------------------------------------------------

export type PayrollLineDraft = {
  assignmentId: string;
  jobId: string;
  intWoId: string;
  title: string;
  clientName: string;
  customerName: string;
  address: string;
  onsiteAt: Date | null;
  offsiteAt: Date | null;
  payType: PayType;
  payRate: string;
  paidMinutes: number;
  labourCents: number;
  travelCents: number;
  parkingTollsCents: number;
  hotelCents: number;
  materialsCents: number;
  totalExpectedCents: number;
};

/**
 * The work a tech did in one week, ready to become payroll lines.
 *
 * A job counts towards the week its *clock-in* falls in, not its clock-out —
 * an overnight that ends at 2am on Monday belongs to the week the crew
 * arrived, which is also the week the client is billed for.
 */
export async function draftWeek(
  userId: string,
  week: WeekRange,
): Promise<PayrollLineDraft[]> {
  const assignments = await db.jobAssignment.findMany({
    where: {
      userId,
      visits: { some: { clockInAt: { gte: week.start, lt: week.end } } },
    },
    select: {
      id: true,
      payType: true,
      payRate: true,
      travelReimbursement: true,
      job: {
        select: {
          id: true,
          intWoId: true,
          title: true,
          client: { select: { name: true } },
          customer: { select: { name: true } },
          site: {
            select: {
              addressLine1: true,
              addressLine2: true,
              city: true,
              state: true,
              postalCode: true,
            },
          },
          reimbursements: {
            where: { assignment: { userId } },
            select: { type: true, amount: true },
          },
        },
      },
      visits: {
        where: { clockInAt: { gte: week.start, lt: week.end } },
        orderBy: { clockInAt: "asc" },
        select: {
          clockInAt: true,
          clockOutAt: true,
          breaks: { select: { startAt: true, endAt: true, paid: true } },
        },
      },
    },
  });

  return assignments.map((assignment) => {
    const totals = assignmentTotals(assignment.visits);

    const sumOf = (types: string[]) =>
      assignment.job.reimbursements
        .filter((entry) => types.includes(entry.type))
        .reduce((total, entry) => total + toCents(entry.amount), 0);

    const labour = labourCents(
      assignment.payType,
      assignment.payRate,
      Math.round(totals.paidMinutes),
    );
    const travel = assignment.travelReimbursement
      ? toCents(assignment.travelReimbursement)
      : 0;
    const parkingTolls = sumOf(["PARKING", "TOLL"]);
    const hotel = sumOf(["HOTEL"]);
    const materials = sumOf(["MATERIAL"]);

    const clockIns = assignment.visits.map((visit) => visit.clockInAt.getTime());
    const clockOuts = assignment.visits
      .map((visit) => visit.clockOutAt?.getTime())
      .filter((time): time is number => typeof time === "number");

    return {
      assignmentId: assignment.id,
      jobId: assignment.job.id,
      intWoId: assignment.job.intWoId,
      title: assignment.job.title,
      clientName: assignment.job.client.name,
      customerName: assignment.job.customer.name,
      address: [
        assignment.job.site.addressLine1,
        assignment.job.site.addressLine2,
        `${assignment.job.site.city}, ${assignment.job.site.state} ${assignment.job.site.postalCode}`,
      ]
        .filter(Boolean)
        .join(", "),
      onsiteAt: clockIns.length > 0 ? new Date(Math.min(...clockIns)) : null,
      offsiteAt: clockOuts.length > 0 ? new Date(Math.max(...clockOuts)) : null,
      payType: assignment.payType,
      payRate: assignment.payRate.toString(),
      paidMinutes: Math.round(totals.paidMinutes),
      labourCents: labour,
      travelCents: travel,
      parkingTollsCents: parkingTolls,
      hotelCents: hotel,
      materialsCents: materials,
      totalExpectedCents:
        labour + travel + parkingTolls + hotel + materials,
    };
  });
}

/**
 * Creates or refreshes a week's payroll.
 *
 * Refreshing rebuilds the amounts from the current visits and claims, but
 * never touches an override, a received amount or a note — those are decisions
 * somebody made, not figures to recompute.
 */
export async function buildPayrollPeriod(input: {
  userId: string;
  week: WeekRange;
  timeZone: string;
  payLagWeeks: number;
}) {
  const { userId, week } = input;

  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { directSupervisorId: true },
  });

  const drafts = await draftWeek(userId, week);
  const expectedCents = drafts.reduce(
    (total, draft) => total + draft.totalExpectedCents,
    0,
  );

  const period = await db.payrollPeriod.upsert({
    where: { userId_weekStart: { userId, weekStart: week.start } },
    update: {
      weekEnd: week.end,
      supervisorId: user.directSupervisorId,
      expectedAmount: fromCents(expectedCents),
      expectedPayDate: expectedPayDate(week.end, input.payLagWeeks),
    },
    create: {
      userId,
      weekStart: week.start,
      weekEnd: week.end,
      supervisorId: user.directSupervisorId,
      expectedAmount: fromCents(expectedCents),
      expectedPayDate: expectedPayDate(week.end, input.payLagWeeks),
    },
    select: { id: true },
  });

  const existing = await db.payrollLine.findMany({
    where: { payrollPeriodId: period.id },
    select: { id: true, assignmentId: true },
  });
  const byAssignment = new Map(
    existing.map((line) => [line.assignmentId, line.id]),
  );

  for (const draft of drafts) {
    const data = {
      payType: draft.payType,
      payRate: draft.payRate,
      paidMinutes: draft.paidMinutes,
      laborAmount: fromCents(draft.labourCents),
      travelReimb: fromCents(draft.travelCents),
      parkingTollsReimb: fromCents(draft.parkingTollsCents),
      hotelReimb: fromCents(draft.hotelCents),
      materialsReimb: fromCents(draft.materialsCents),
      totalExpected: fromCents(draft.totalExpectedCents),
    };

    const lineId = byAssignment.get(draft.assignmentId);
    if (lineId) {
      await db.payrollLine.update({ where: { id: lineId }, data });
      byAssignment.delete(draft.assignmentId);
    } else {
      await db.payrollLine.create({
        data: { payrollPeriodId: period.id, assignmentId: draft.assignmentId, ...data },
      });
    }
  }

  // Work that moved out of the week — a corrected clock-in, usually — should
  // not leave a line behind claiming money.
  if (byAssignment.size > 0) {
    await db.payrollLine.deleteMany({
      where: { id: { in: Array.from(byAssignment.values()) } },
    });
  }

  return period.id;
}

/** "Week of Jul 27, 2026" — how a period is labelled everywhere. */
export function weekLabel(weekStart: Date, timeZone: string): string {
  return `Week of ${new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(weekStart)}`;
}

export function weekKey(weekStart: Date, timeZone: string): string {
  return isoDateInZone(weekStart, timeZone);
}
