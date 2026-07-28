import { roundToInterval } from "@/lib/datetime";
import type { PayType } from "@prisma-client";

/**
 * Time and money arithmetic.
 *
 * Two different totals come out of the same visits and must not be confused:
 *
 *   - The **client** is billed for the span the crew was on site: the earliest
 *     clock-in to the latest clock-out across everyone, breaks included.
 *   - A **tech** is paid for their own visits, minus their own unpaid breaks.
 *
 * Everything here is pure so the same functions run on the server for storage
 * and in the browser for the ticking display, with no chance of the two
 * disagreeing.
 */

export type BreakInput = {
  startAt: Date | string;
  endAt: Date | string | null;
  paid: boolean;
};

export type VisitInput = {
  clockInAt: Date | string;
  clockOutAt: Date | string | null;
  breaks: BreakInput[];
};

function ms(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

/**
 * Minutes of a break that fall inside the visit window. An open break is
 * measured up to `now`, which is how the live counter stops climbing the
 * moment a tech taps Break.
 */
function breakMinutes(
  entry: BreakInput,
  visitStart: number,
  visitEnd: number,
): number {
  const start = Math.max(ms(entry.startAt), visitStart);
  const end = Math.min(entry.endAt ? ms(entry.endAt) : visitEnd, visitEnd);
  return Math.max(0, (end - start) / 60_000);
}

export type VisitTotals = {
  /** Wall-clock minutes on site, breaks included. */
  onsiteMinutes: number;
  /** Minutes the tech is actually paid for. */
  paidMinutes: number;
  unpaidBreakMinutes: number;
  paidBreakMinutes: number;
  isOpen: boolean;
};

export function visitTotals(visit: VisitInput, now: Date = new Date()): VisitTotals {
  const start = ms(visit.clockInAt);
  const end = visit.clockOutAt ? ms(visit.clockOutAt) : now.getTime();
  const onsiteMinutes = Math.max(0, (end - start) / 60_000);

  let unpaid = 0;
  let paid = 0;
  for (const entry of visit.breaks) {
    const minutes = breakMinutes(entry, start, end);
    if (entry.paid) paid += minutes;
    else unpaid += minutes;
  }

  return {
    onsiteMinutes,
    unpaidBreakMinutes: unpaid,
    paidBreakMinutes: paid,
    // Unpaid breaks come off pay only. The client is still billed for the
    // full onsite span.
    paidMinutes: Math.max(0, onsiteMinutes - unpaid),
    isOpen: visit.clockOutAt === null,
  };
}

export type AssignmentTotals = {
  onsiteMinutes: number;
  paidMinutes: number;
  unpaidBreakMinutes: number;
  hasOpenVisit: boolean;
};

export function assignmentTotals(
  visits: VisitInput[],
  now: Date = new Date(),
): AssignmentTotals {
  return visits.reduce<AssignmentTotals>(
    (total, visit) => {
      const totals = visitTotals(visit, now);
      return {
        onsiteMinutes: total.onsiteMinutes + totals.onsiteMinutes,
        paidMinutes: total.paidMinutes + totals.paidMinutes,
        unpaidBreakMinutes:
          total.unpaidBreakMinutes + totals.unpaidBreakMinutes,
        hasOpenVisit: total.hasOpenVisit || totals.isOpen,
      };
    },
    {
      onsiteMinutes: 0,
      paidMinutes: 0,
      unpaidBreakMinutes: 0,
      hasOpenVisit: false,
    },
  );
}

/**
 * The client-facing span: earliest anyone arrived to latest anyone left,
 * regardless of who that was. A tech who finishes early is still covered by
 * the supervisor who stayed on.
 */
export function jobSpan(
  visits: VisitInput[],
  now: Date = new Date(),
): { onsiteAt: Date | null; offsiteAt: Date | null; totalMinutes: number; open: boolean } {
  if (visits.length === 0) {
    return { onsiteAt: null, offsiteAt: null, totalMinutes: 0, open: false };
  }

  const starts = visits.map((visit) => ms(visit.clockInAt));
  const open = visits.some((visit) => visit.clockOutAt === null);
  const ends = visits.map((visit) =>
    visit.clockOutAt ? ms(visit.clockOutAt) : now.getTime(),
  );

  const onsite = Math.min(...starts);
  const offsite = Math.max(...ends);

  return {
    onsiteAt: new Date(onsite),
    offsiteAt: open ? null : new Date(offsite),
    totalMinutes: Math.max(0, (offsite - onsite) / 60_000),
    open,
  };
}

/** Money owed for time worked. Flat pays once per job, not per visit. */
export function earnings(
  payType: PayType,
  rate: number,
  paidMinutes: number,
): number {
  if (payType === "NON_BILLABLE") return 0;
  if (payType === "FLAT") return rate;
  return (paidMinutes / 60) * rate;
}

/** "6:42" — elapsed time, not a clock reading, so hours are not padded. */
export function formatElapsed(minutes: number): string {
  const total = Math.max(0, Math.floor(minutes));
  const hours = Math.floor(total / 60);
  return `${hours}:${String(total % 60).padStart(2, "0")}`;
}

/** Same, with seconds, for the live counter. */
export function formatElapsedPrecise(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * The choices behind "Clock in/out early or later": the snapped current time,
 * and the same in five-minute steps either side.
 *
 * Offsets are measured from the *snapped* time, not the raw clock, so at 09:57
 * the options read 09:50 / 09:55 / 10:00 / 10:05 / 10:10 rather than something
 * off-grid.
 */
export function clockOptions(
  now: Date,
  intervalMinutes: number,
  offsets: number[] = [-10, -5, 0, 5, 10],
): { offset: number; at: Date }[] {
  const base = roundToInterval(now, intervalMinutes);
  return offsets.map((offset) => ({
    offset,
    at: new Date(base.getTime() + offset * 60_000),
  }));
}

/**
 * How far a proposed time strays from now, in minutes. Used to enforce the
 * company's cap on what a tech may adjust for themselves.
 */
export function adjustmentMinutes(proposed: Date, now: Date): number {
  return Math.abs(proposed.getTime() - now.getTime()) / 60_000;
}
