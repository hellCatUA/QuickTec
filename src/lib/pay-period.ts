import {
  isoDateInZone,
  startOfWeekMonday,
  endOfWeekMonday,
  zonedMidnight,
  zonedParts,
} from "@/lib/datetime";
import { db } from "@/lib/db";
import {
  expectedPayDate,
  labourCents,
  toCents,
  weekMonth,
  weeksInMonth,
  type WeekRange,
} from "@/lib/payroll";
import { assignmentTotals, visitTotals } from "@/lib/time-tracking";
import type { PayType } from "@prisma-client";

/**
 * What one person earned in a stretch of time, worked out from the clock.
 *
 * Deliberately not read from PayrollPeriod. Payroll is a decision somebody
 * makes — build the week, approve it, record what arrived — and until they make
 * it there is no row to read. That is why Pay used to be blank on a deployment
 * where nobody had pressed the button: the page was asking the wrong question.
 * A tech wants to know what they have earned, which the time records already
 * answer.
 *
 * Payroll still has the last word on what gets *paid*, so it is shown alongside
 * as a stage rather than as the source. The two disagreeing is information: a
 * figure that has not been approved yet can still move, and the page says so.
 */

/** How far a period has got towards money in somebody's account. */
export type PayStage = "recorded" | "review" | "approved" | "paid";

export const PAY_STAGES: PayStage[] = [
  "recorded",
  "review",
  "approved",
  "paid",
];

export const PAY_STAGE_LABEL: Record<PayStage, string> = {
  recorded: "Recorded",
  review: "In review",
  approved: "Approved",
  paid: "Paid",
};

export type PayState = {
  stage: PayStage;
  /** The period has days still to come, so the figures are not final.  */
  running: boolean;
  approvedBy: string | null;
  approvedAt: Date | null;
  paidOn: Date | null;
  expectedPayDate: Date | null;
  /** Less arrived than was expected, and somebody recorded why. */
  reduced: boolean;
};

export type PayTotals = {
  jobs: number;
  onsiteMinutes: number;
  paidMinutes: number;
  earnedCents: number;
  reimbursedCents: number;
  /** Null when there are no hours to divide by. */
  blendedHourlyCents: number | null;
};

export type PayJob = {
  assignmentId: string;
  jobId: string;
  intWoId: string;
  title: string;
  /** "TSA #4471" — who the work was for, as the job page writes it. */
  customer: string;
  clockInAt: Date;
  clockOutAt: Date | null;
  paidMinutes: number;
  payType: PayType;
  payRate: string;
  earnedCents: number;
  reimbursements: { label: string; cents: number }[];
};

/** One day of the period, whether or not anything happened on it. */
export type PayDay = {
  /** Midnight in the site's own reckoning, so it sorts and labels correctly. */
  at: Date;
  paidMinutes: number;
  earnedCents: number;
  titles: string[];
};

export type PayPeriod = {
  kind: "week" | "month";
  start: Date;
  end: Date;
  /** ISO week number. Null for a month. */
  week: number | null;
  totals: PayTotals;
  jobs: PayJob[];
  /** A week's seven days. Empty for a month, which lists weeks instead. */
  days: PayDay[];
  state: PayState;
};

/** A week as it appears in a list: enough to choose from, not to study. */
export type PayWeekSummary = {
  start: Date;
  end: Date;
  week: number;
  totals: PayTotals;
  state: PayState;
};

/**
 * The ISO week number, which is the one printed on a European calendar and the
 * one people say out loud. Anchored on the Thursday: a week belongs to the year
 * that holds most of it, which is what makes 29 December week 1.
 */
export function isoWeek(weekStart: Date, timeZone: string): number {
  const thursday = new Date(weekStart.getTime() + 3 * 86_400_000);
  const { year } = zonedParts(thursday, timeZone);

  // 4 January is always inside ISO week 1, whatever day it falls on.
  const jan4 = zonedMidnight(year, 1, 4, timeZone);
  const week1Monday = startOfWeekMonday(jan4, timeZone);

  return (
    Math.round((weekStart.getTime() - week1Monday.getTime()) / (7 * 86_400_000)) + 1
  );
}

const EMPTY_TOTALS: PayTotals = {
  jobs: 0,
  onsiteMinutes: 0,
  paidMinutes: 0,
  earnedCents: 0,
  reimbursedCents: 0,
  blendedHourlyCents: null,
};

function blend(totals: PayTotals): PayTotals {
  return {
    ...totals,
    // Divided by hours actually on site rather than paid hours: an unpaid break
    // still cost the tech their afternoon and should drag the figure down.
    blendedHourlyCents:
      totals.onsiteMinutes > 0
        ? Math.round((totals.earnedCents * 60) / totals.onsiteMinutes)
        : null,
  };
}

/** Everything one person worked between two instants, job by job. */
async function jobsInRange(
  userId: string,
  range: WeekRange,
  now: Date,
): Promise<PayJob[]> {
  const assignments = await db.jobAssignment.findMany({
    where: {
      userId,
      visits: { some: { clockInAt: { gte: range.start, lt: range.end } } },
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
          customer: { select: { code: true } },
          site: { select: { siteNumber: true } },
          reimbursements: {
            where: { assignment: { userId } },
            select: { type: true, label: true, amount: true },
          },
        },
      },
      visits: {
        where: { clockInAt: { gte: range.start, lt: range.end } },
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
    const first = assignment.visits[0];
    const last = assignment.visits[assignment.visits.length - 1];

    const reimbursements = assignment.job.reimbursements.map((entry) => ({
      label: entry.label ?? entry.type,
      cents: toCents(entry.amount),
    }));
    // Travel is carried by the assignment rather than claimed as an expense,
    // so it has no row of its own to borrow a label from.
    if (assignment.travelReimbursement) {
      reimbursements.unshift({
        label: "Travel",
        cents: toCents(assignment.travelReimbursement),
      });
    }

    return {
      assignmentId: assignment.id,
      jobId: assignment.job.id,
      intWoId: assignment.job.intWoId,
      title: assignment.job.title,
      customer: `${assignment.job.customer.code} #${assignment.job.site.siteNumber ?? "—"}`,
      clockInAt: first.clockInAt,
      clockOutAt: last.clockOutAt,
      paidMinutes: Math.round(totals.paidMinutes),
      payType: assignment.payType,
      payRate: assignment.payRate?.toString() ?? "0",
      earnedCents: labourCents(
        assignment.payType,
        assignment.payRate ?? "0",
        Math.round(totals.paidMinutes),
      ),
      reimbursements,
    };
  });
}

function totalsOf(jobs: PayJob[], onsiteMinutes: number): PayTotals {
  return blend({
    jobs: jobs.length,
    onsiteMinutes,
    paidMinutes: jobs.reduce((sum, job) => sum + job.paidMinutes, 0),
    earnedCents: jobs.reduce((sum, job) => sum + job.earnedCents, 0),
    reimbursedCents: jobs.reduce(
      (sum, job) =>
        sum + job.reimbursements.reduce((inner, one) => inner + one.cents, 0),
      0,
    ),
    blendedHourlyCents: null,
  });
}

/** Hours on site have to come from the visits, which PayJob has flattened. */
async function onsiteMinutesInRange(
  userId: string,
  range: WeekRange,
): Promise<number> {
  const assignments = await db.jobAssignment.findMany({
    where: {
      userId,
      visits: { some: { clockInAt: { gte: range.start, lt: range.end } } },
    },
    select: {
      visits: {
        where: { clockInAt: { gte: range.start, lt: range.end } },
        select: {
          clockInAt: true,
          clockOutAt: true,
          breaks: { select: { startAt: true, endAt: true, paid: true } },
        },
      },
    },
  });

  return assignments.reduce(
    (sum, assignment) => sum + assignmentTotals(assignment.visits).onsiteMinutes,
    0,
  );
}

/** Where payroll has got to with this week, if it has started at all. */
async function stateOfWeek(
  userId: string,
  range: WeekRange,
  now: Date,
  payLagWeeks: number,
): Promise<PayState> {
  const period = await db.payrollPeriod.findUnique({
    where: { userId_weekStart: { userId, weekStart: range.start } },
    select: {
      status: true,
      approvedAt: true,
      receivedDate: true,
      expectedPayDate: true,
      approvedBy: { select: { name: true } },
    },
  });

  const running = now < range.end;
  const expected = period?.expectedPayDate ?? expectedPayDate(range.end, payLagWeeks);

  if (!period) {
    return {
      stage: "recorded",
      running,
      approvedBy: null,
      approvedAt: null,
      paidOn: null,
      expectedPayDate: expected,
      reduced: false,
    };
  }

  const stage: PayStage =
    period.status === "DRAFT"
      ? "review"
      : period.status === "APPROVED"
        ? "approved"
        : "paid";

  return {
    stage,
    running,
    approvedBy: period.approvedBy?.name ?? null,
    approvedAt: period.approvedAt,
    paidOn: period.receivedDate,
    expectedPayDate: expected,
    reduced: period.status === "REDUCED",
  };
}

/** One week, in full: the totals, the jobs, and the seven days. */
export async function loadPayWeek(input: {
  userId: string;
  weekStart: Date;
  timeZone: string;
  payLagWeeks: number;
  now?: Date;
}): Promise<PayPeriod> {
  const now = input.now ?? new Date();
  const range: WeekRange = {
    start: input.weekStart,
    end: endOfWeekMonday(input.weekStart, input.timeZone),
  };

  const [jobs, onsite, state] = await Promise.all([
    jobsInRange(input.userId, range, now),
    onsiteMinutesInRange(input.userId, range),
    stateOfWeek(input.userId, range, now, input.payLagWeeks),
  ]);

  // Seven rows whether or not anything happened on them. A day left out of the
  // list is a day somebody has to work out was empty; a day that says so is an
  // answer.
  const days: PayDay[] = [];
  for (let offset = 0; offset < 7; offset++) {
    const at = new Date(range.start.getTime() + offset * 86_400_000);
    days.push({ at, paidMinutes: 0, earnedCents: 0, titles: [] });
  }

  const dayOf = new Map(
    days.map((day) => [isoDateInZone(day.at, input.timeZone), day]),
  );
  for (const job of jobs) {
    const key = isoDateInZone(job.clockInAt, input.timeZone);
    const day = dayOf.get(key);
    if (!day) continue;
    day.paidMinutes += job.paidMinutes;
    day.earnedCents += job.earnedCents;
    day.titles.push(job.title);
  }

  jobs.sort((a, b) => a.clockInAt.getTime() - b.clockInAt.getTime());

  return {
    kind: "week",
    start: range.start,
    end: range.end,
    week: isoWeek(range.start, input.timeZone),
    totals: totalsOf(jobs, onsite),
    jobs,
    days,
    state,
  };
}

/**
 * One month, and the weeks filed under it.
 *
 * A month is its weeks, not its days: a week that straddles the boundary is
 * counted once, in the month its Monday falls in, which is how the payroll
 * export already files it. Counting calendar days instead would give a figure
 * that never matches what was paid.
 */
export async function loadPayMonth(input: {
  userId: string;
  year: number;
  month: number;
  timeZone: string;
  payLagWeeks: number;
  now?: Date;
}): Promise<{ period: PayPeriod; weeks: PayWeekSummary[] }> {
  const now = input.now ?? new Date();
  const ranges = weeksInMonth(input.year, input.month, input.timeZone);

  const loaded = await Promise.all(
    ranges.map(async (range) => {
      const [jobs, onsite, state] = await Promise.all([
        jobsInRange(input.userId, range, now),
        onsiteMinutesInRange(input.userId, range),
        stateOfWeek(input.userId, range, now, input.payLagWeeks),
      ]);
      return { range, jobs, totals: totalsOf(jobs, onsite), state };
    }),
  );

  const jobs = loaded.flatMap((entry) => entry.jobs);
  jobs.sort((a, b) => a.clockInAt.getTime() - b.clockInAt.getTime());
  const onsite = loaded.reduce(
    (sum, entry) => sum + entry.totals.onsiteMinutes,
    0,
  );

  const first = ranges[0];
  const last = ranges[ranges.length - 1];

  return {
    period: {
      kind: "month",
      start: first?.start ?? new Date(Date.UTC(input.year, input.month - 1, 1)),
      end: last?.end ?? new Date(Date.UTC(input.year, input.month, 1)),
      week: null,
      totals: totalsOf(jobs, onsite),
      jobs,
      days: [],
      // A month spans several weeks in different states, so its own stage is
      // the least far along of them: nothing about the month is settled while
      // any week in it is still open.
      state: {
        stage: loaded.reduce<PayStage>(
          (worst, entry) =>
            PAY_STAGES.indexOf(entry.state.stage) < PAY_STAGES.indexOf(worst)
              ? entry.state.stage
              : worst,
          "paid",
        ),
        running: loaded.some((entry) => entry.state.running),
        approvedBy: null,
        approvedAt: null,
        paidOn: null,
        expectedPayDate: null,
        reduced: loaded.some((entry) => entry.state.reduced),
      },
    },
    weeks: loaded
      .map((entry) => ({
        start: entry.range.start,
        end: entry.range.end,
        week: isoWeek(entry.range.start, input.timeZone),
        totals: entry.totals,
        state: entry.state,
      }))
      .sort((a, b) => b.start.getTime() - a.start.getTime()),
  };
}

/**
 * The weeks behind somebody, newest first, for the list they pick from.
 *
 * Empty weeks are kept rather than skipped. A gap in a list of weeks is a
 * question — did I not work, or did the app lose it — and an empty row is an
 * answer.
 */
export async function loadPayWeeks(input: {
  userId: string;
  timeZone: string;
  payLagWeeks: number;
  /** How many weeks back from the current one. */
  count?: number;
  now?: Date;
}): Promise<{ month: { year: number; month: number }; weeks: PayWeekSummary[] }[]> {
  const now = input.now ?? new Date();
  const count = input.count ?? 12;

  const current = startOfWeekMonday(now, input.timeZone);
  const starts = Array.from(
    { length: count },
    (_, index) => new Date(current.getTime() - index * 7 * 86_400_000),
  ).map((probe) => startOfWeekMonday(probe, input.timeZone));

  const summaries = await Promise.all(
    starts.map(async (start) => {
      const range: WeekRange = {
        start,
        end: endOfWeekMonday(start, input.timeZone),
      };
      const [jobs, onsite, state] = await Promise.all([
        jobsInRange(input.userId, range, now),
        onsiteMinutesInRange(input.userId, range),
        stateOfWeek(input.userId, range, now, input.payLagWeeks),
      ]);
      return {
        start: range.start,
        end: range.end,
        week: isoWeek(range.start, input.timeZone),
        totals: totalsOf(jobs, onsite),
        state,
      };
    }),
  );

  const groups: { month: { year: number; month: number }; weeks: PayWeekSummary[] }[] =
    [];
  for (const summary of summaries) {
    const filed = weekMonth(summary.start, input.timeZone);
    const last = groups[groups.length - 1];
    if (last && last.month.year === filed.year && last.month.month === filed.month) {
      last.weeks.push(summary);
    } else {
      groups.push({ month: filed, weeks: [summary] });
    }
  }
  return groups;
}

/** Adds up a month header from the weeks under it. */
export function sumTotals(all: PayTotals[]): PayTotals {
  return blend(
    all.reduce<PayTotals>(
      (sum, one) => ({
        jobs: sum.jobs + one.jobs,
        onsiteMinutes: sum.onsiteMinutes + one.onsiteMinutes,
        paidMinutes: sum.paidMinutes + one.paidMinutes,
        earnedCents: sum.earnedCents + one.earnedCents,
        reimbursedCents: sum.reimbursedCents + one.reimbursedCents,
        blendedHourlyCents: null,
      }),
      { ...EMPTY_TOTALS },
    ),
  );
}

/** Kept so a caller can use the same maths on a single visit. */
export { visitTotals };
