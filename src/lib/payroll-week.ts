import { endOfWeekMonday } from "@/lib/datetime";
import { db } from "@/lib/db";
import {
  isoWeek,
  loadPayWeek,
  type PayStage,
  type PayPeriod,
} from "@/lib/pay-period";
import { expectedPayDate, toCents } from "@/lib/payroll";

/**
 * One payroll week, across everybody in it.
 *
 * Payroll opens on a week rather than on a person because that is the question
 * a manager arrives with: who do I owe for last week. The old screen made them
 * pick a person first and then discover the week was never built, one tech at a
 * time.
 *
 * Every figure here comes from the same loadPayWeek the tech sees on their own
 * Pay screen, so the two can never disagree about what was worked. Where a week
 * has been built, the payroll period's own total takes over — that is the one
 * that carries somebody's override, and overriding a line is exactly the case
 * where the clock and the cheque are meant to differ.
 */

export type PayrollPerson = {
  userId: string;
  name: string;
  jobs: number;
  paidMinutes: number;
  /** What the company expects to pay: the built total, or the clock's. */
  expectedCents: number;
  /**
   * What the clock says right now, whether or not the week was built. The two
   * differing is information rather than a fault — an override is exactly that
   * — but a built week that no longer matches the time records should say so
   * instead of quietly showing a figure nobody can trace.
   */
  clockCents: number;
  stage: PayStage;
  /** The week has been built, so there is something to approve. */
  periodId: string | null;
  approvedAsFallback: boolean;
  /** At least one job in the week resolved to no rate at all. */
  needsRate: boolean;
  /** "$65.00/hr" when one rate covers the week, else null. */
  soleHourlyRate: string | null;
};

export type PayrollWeek = {
  start: Date;
  end: Date;
  week: number;
  expectedPayDate: Date;
  people: PayrollPerson[];
  totals: {
    people: number;
    paidMinutes: number;
    expectedCents: number;
  };
  /** How many people sit at each stage, for the week's summary row. */
  stages: Record<PayStage, number>;
  needingRate: number;
};

/** Everybody the caller may see who has anything in this week. */
async function peopleInWeek(
  visibleIds: string[] | null,
  start: Date,
  end: Date,
): Promise<{ id: string; name: string }[]> {
  const scope = visibleIds === null ? {} : { id: { in: visibleIds } };

  return db.user.findMany({
    where: {
      ...scope,
      OR: [
        // Worked in the week, whether or not payroll has been run.
        {
          assignments: {
            some: { visits: { some: { clockInAt: { gte: start, lt: end } } } },
          },
        },
        // Or payroll already holds a week for them — a built week with every
        // job since removed still has to be visible, or it can never be closed.
        { payrollPeriods: { some: { weekStart: start } } },
      ],
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}

function summarise(period: PayPeriod): {
  needsRate: boolean;
  soleHourlyRate: string | null;
} {
  const needsRate = period.jobs.some((job) => job.payType === "NON_BILLABLE");

  // "The week's rate" is only a true sentence when every job on it is hourly.
  // A week of one hourly job and two on a flat covering hours has no single
  // rate, and printing the hourly one made it look as though it did.
  const allHourly =
    period.jobs.length > 0 &&
    period.jobs.every((job) => job.payType === "HOURLY");
  const hourly = new Set(period.jobs.map((job) => job.payRate));

  return {
    needsRate,
    soleHourlyRate: allHourly && hourly.size === 1 ? [...hourly][0] : null,
  };
}

export async function loadPayrollWeek(input: {
  /** Null means every active person. */
  visibleIds: string[] | null;
  weekStart: Date;
  timeZone: string;
  payLagWeeks: number;
  now?: Date;
}): Promise<PayrollWeek> {
  const now = input.now ?? new Date();
  const end = endOfWeekMonday(input.weekStart, input.timeZone);

  const users = await peopleInWeek(input.visibleIds, input.weekStart, end);

  const periods = await db.payrollPeriod.findMany({
    where: {
      weekStart: input.weekStart,
      userId: { in: users.map((user) => user.id) },
    },
    select: {
      id: true,
      userId: true,
      status: true,
      expectedAmount: true,
      approvedAsFallback: true,
    },
  });
  const periodOf = new Map(periods.map((period) => [period.userId, period]));

  const people: PayrollPerson[] = await Promise.all(
    users.map(async (user) => {
      const week = await loadPayWeek({
        userId: user.id,
        weekStart: input.weekStart,
        timeZone: input.timeZone,
        payLagWeeks: input.payLagWeeks,
        now,
      });
      const period = periodOf.get(user.id);
      const { needsRate, soleHourlyRate } = summarise(week);
      const clockCents =
        week.totals.earnedCents + week.totals.reimbursedCents;

      return {
        userId: user.id,
        name: user.name,
        jobs: week.totals.jobs,
        paidMinutes: week.totals.paidMinutes,
        clockCents,
        expectedCents: period ? toCents(period.expectedAmount) : clockCents,
        stage: week.state.stage,
        periodId: period?.id ?? null,
        approvedAsFallback: period?.approvedAsFallback ?? false,
        needsRate,
        soleHourlyRate,
      };
    }),
  );

  const stages: Record<PayStage, number> = {
    recorded: 0,
    review: 0,
    approved: 0,
    paid: 0,
  };
  for (const person of people) stages[person.stage] += 1;

  return {
    start: input.weekStart,
    end,
    week: isoWeek(input.weekStart, input.timeZone),
    expectedPayDate: expectedPayDate(end, input.payLagWeeks),
    people,
    totals: {
      people: people.length,
      paidMinutes: people.reduce(
        (sum, person) => sum + person.paidMinutes,
        0,
      ),
      expectedCents: people.reduce(
        (sum, person) => sum + person.expectedCents,
        0,
      ),
    },
    stages,
    needingRate: people.filter((person) => person.needsRate).length,
  };
}
