import { ChevronRight } from "lucide-react";
import Link from "next/link";
import {
  hours,
  money,
  monthLabel,
  shortDate,
  weekParam,
  weekSpan,
} from "@/lib/pay-format";
import {
  payTotal,
  sumTotals,
  type PayWeekSummary,
  type PayTotals,
} from "@/lib/pay-period";
import { cn } from "@/lib/utils";
import { StageMark } from "./pay-chrome";

/**
 * The weeks behind somebody, newest first, under the month each is filed in.
 *
 * A week belongs to the month its Monday falls in — the rule the payroll export
 * already uses — so W36 starting 31 August sits under August even though most
 * of it is September. Filing it by its Monday is what keeps a week from being
 * counted twice, and what makes these figures match what was actually paid.
 */

export type WeekGroup = {
  month: { year: number; month: number };
  weeks: PayWeekSummary[];
};

/** What a week's right-hand column says under the money. */
function payoutNote(week: PayWeekSummary, timeZone: string): string {
  const { state } = week;
  if (state.stage === "paid") {
    return state.paidOn ? `paid ${shortDate(state.paidOn, timeZone)}` : "paid";
  }
  if (state.stage === "approved") {
    return state.expectedPayDate
      ? `pays ${shortDate(state.expectedPayDate, timeZone)}`
      : "approved";
  }
  if (state.stage === "review") return "not approved yet";
  // The amount beside this already includes the expenses, so the note says how
  // much of it they were rather than announcing them as an extra.
  return week.totals.reimbursedCents > 0
    ? `${money(week.totals.reimbursedCents)} of it expenses`
    : "not submitted yet";
}

function WeekBlock({
  week,
  timeZone,
  href,
  current,
}: {
  week: PayWeekSummary;
  timeZone: string;
  href: string;
  current: boolean;
}) {
  const empty = week.totals.jobs === 0;

  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-3 rounded-xl border bg-surface p-3.5 transition-colors hover:bg-surface-raised",
        current ? "border-primary" : "border-border",
        empty ? "opacity-70" : "",
      )}
    >
      <div className="flex w-12 shrink-0 flex-col items-center justify-center">
        <div
          className={cn(
            "text-xl font-semibold leading-tight tabular-nums",
            current ? "text-primary" : "",
          )}
        >
          {week.week}
        </div>
        <div className="text-[0.6875rem] uppercase tracking-[0.06em] text-muted-foreground">
          week
        </div>
      </div>

      <div className="w-px self-stretch bg-border" />

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="text-sm font-semibold tabular-nums">
          {weekSpan(week.start, week.end, timeZone)}
        </div>
        {empty ? (
          <div className="text-xs text-muted-foreground">No work</div>
        ) : (
          <>
            <div className="text-xs tabular-nums text-muted-foreground">
              {week.totals.jobs} {week.totals.jobs === 1 ? "job" : "jobs"} ·{" "}
              {hours(week.totals.paidMinutes)} hrs
            </div>
            <StageMark state={week.state} />
          </>
        )}
      </div>

      {empty ? (
        <div className="shrink-0 text-[0.9375rem] font-semibold tabular-nums text-muted-foreground">
          —
        </div>
      ) : (
        <div className="flex shrink-0 flex-col items-end gap-0.5">
          <div className="text-[1.0625rem] font-semibold tabular-nums">
            {money(payTotal(week.totals))}
          </div>
          <div className="text-[0.6875rem] tabular-nums text-muted-foreground">
            {payoutNote(week, timeZone)}
          </div>
        </div>
      )}

      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}

export function WeeksView({
  groups,
  timeZone,
  currentWeekStart,
}: {
  groups: WeekGroup[];
  timeZone: string;
  currentWeekStart: Date;
}) {
  return (
    <>
      {groups.map((group) => {
        const totals: PayTotals = sumTotals(
          group.weeks.map((week) => week.totals),
        );

        return (
          <section
            key={`${group.month.year}-${group.month.month}`}
            className="flex flex-col gap-2"
          >
            <div className="flex items-baseline gap-2 px-0.5">
              <h2 className="flex-1 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                {monthLabel(group.month.year, group.month.month)}
              </h2>
              <span className="text-xs tabular-nums text-muted-foreground">
                {totals.jobs} {totals.jobs === 1 ? "job" : "jobs"} ·{" "}
                {hours(totals.paidMinutes)} hrs
              </span>
              <span className="text-[0.8125rem] font-semibold tabular-nums">
                {money(payTotal(totals))}
              </span>
            </div>

            {group.weeks.map((week) => (
              <WeekBlock
                key={week.start.toISOString()}
                week={week}
                timeZone={timeZone}
                href={`/pay?week=${weekParam(week.start, timeZone)}`}
                current={week.start.getTime() === currentWeekStart.getTime()}
              />
            ))}
          </section>
        );
      })}
    </>
  );
}
