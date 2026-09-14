import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  hours,
  money,
  monthLabel,
  monthParam,
  weekParam,
  weekSpan,
} from "@/lib/pay-format";
import {
  PAY_STAGES,
  PAY_STAGE_LABEL,
  type PayPeriod,
  type PayStage,
  type PayWeekSummary,
} from "@/lib/pay-period";
import { cn } from "@/lib/utils";
import { EarnedCard, StatsGrid, stageWord } from "./pay-chrome";

/**
 * A month, and the weeks filed under it.
 *
 * A month spans several weeks in different states at once, so instead of the
 * week screen's four-step tracker it gets a tally: how many weeks are still
 * running, in review, approved, paid. A single tracker would have to pick one
 * of them and would be wrong about the rest.
 */

const TALLY_TONE: Record<PayStage, "primary" | "warning" | "success" | "neutral"> =
  {
    recorded: "primary",
    review: "warning",
    approved: "success",
    paid: "neutral",
  };

function Tally({
  weeks,
  month,
}: {
  weeks: PayWeekSummary[];
  month: { year: number; month: number };
}) {
  const worked = weeks.filter((week) => week.totals.jobs > 0);
  const counts = new Map<PayStage, number>();
  for (const week of worked) {
    counts.set(week.state.stage, (counts.get(week.state.stage) ?? 0) + 1);
  }

  const unsettled = worked.filter((week) => week.state.stage !== "paid").length;

  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-border bg-surface p-3.5">
      <div className="flex flex-wrap items-center gap-2">
        {worked.length === 0 ? (
          <Badge variant="neutral">No weeks worked</Badge>
        ) : (
          PAY_STAGES.filter((stage) => counts.has(stage)).map((stage) => (
            <Badge key={stage} variant={TALLY_TONE[stage]}>
              {counts.get(stage)}{" "}
              {stage === "recorded"
                ? "still running"
                : PAY_STAGE_LABEL[stage].toLowerCase()}
            </Badge>
          ))
        )}
      </div>

      <p className="border-t border-border pt-2.5 text-xs leading-relaxed text-muted-foreground">
        {worked.length === 0
          ? `Nothing clocked in ${monthLabel(month.year, month.month)}.`
          : unsettled === 0
            ? `Every week in ${monthLabel(month.year, month.month)} has been paid. Nothing here will change.`
            : worked.length === 1
              ? "The one week worked here has not been paid yet, so these figures can still move."
              : `${unsettled} of the ${worked.length} weeks worked here ${unsettled === 1 ? "has" : "have"} not been paid yet, so these figures can still move.`}
      </p>
    </div>
  );
}

function WeekRow({
  week,
  timeZone,
  href,
  last,
}: {
  week: PayWeekSummary;
  timeZone: string;
  href: string;
  last: boolean;
}) {
  const empty = week.totals.jobs === 0;

  const row = (
    <>
      <div
        className={cn(
          "w-7 shrink-0 text-[0.8125rem] font-semibold tabular-nums",
          empty ? "" : "text-primary",
        )}
      >
        {week.week}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="text-[0.8125rem] font-semibold tabular-nums">
          {weekSpan(week.start, week.end, timeZone)}
        </div>
        <div className="text-[0.6875rem] tabular-nums text-muted-foreground">
          {empty
            ? "Not worked"
            : `${week.totals.jobs} ${week.totals.jobs === 1 ? "job" : "jobs"} · ${hours(week.totals.paidMinutes)} hrs · ${stageWord(week.state)}`}
        </div>
      </div>
      <div
        className={cn(
          "shrink-0 text-sm font-semibold tabular-nums",
          empty ? "text-muted-foreground" : "",
        )}
      >
        {empty ? "—" : money(week.totals.earnedCents)}
      </div>
      {empty ? null : (
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      )}
    </>
  );

  const className = cn(
    "flex min-h-11 items-center gap-3 px-3.5 py-3",
    last ? "" : "border-b border-border",
    empty ? "opacity-70" : "hover:bg-surface-raised",
  );

  return empty ? (
    <div className={className}>{row}</div>
  ) : (
    <Link href={href} className={className}>
      {row}
    </Link>
  );
}

export function MonthView({
  period,
  weeks,
  month,
  timeZone,
}: {
  period: PayPeriod;
  weeks: PayWeekSummary[];
  month: { year: number; month: number };
  timeZone: string;
}) {
  const running = weeks.filter((week) => week.state.running).length;

  return (
    <>
      <EarnedCard
        totals={period.totals}
        note={
          <>
            {period.totals.reimbursedCents > 0 ? (
              <>
                plus{" "}
                <span className="tabular-nums text-foreground">
                  {money(period.totals.reimbursedCents)}
                </span>{" "}
                reimbursed
              </>
            ) : (
              "no reimbursements"
            )}
            {running > 0
              ? ` · ${running === 1 ? "one week still running" : `${running} weeks still running`}`
              : null}
          </>
        }
      />
      <StatsGrid totals={period.totals} />
      <Tally weeks={weeks} month={month} />

      <section className="flex flex-col gap-2">
        <div className="flex items-baseline gap-2">
          <h2 className="flex-1 text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            Weeks in {monthLabel(month.year, month.month).split(" ")[0]}
          </h2>
          <span className="text-[0.6875rem] text-muted-foreground">
            by their Monday
          </span>
        </div>

        <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-surface">
          {weeks.map((week, index) => (
            <WeekRow
              key={week.start.toISOString()}
              week={week}
              timeZone={timeZone}
              href={`/pay?week=${weekParam(week.start, timeZone)}&from=${monthParam(month.year, month.month)}`}
              last={index === weeks.length - 1}
            />
          ))}
        </div>
      </section>
    </>
  );
}
