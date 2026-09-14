import { Building, Clock, FileText, MapPin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { isoDateInZone } from "@/lib/datetime";
import { OUTCOME_META } from "@/lib/job-status";
import {
  clockTime,
  dayLabel,
  hours,
  longDayLabel,
  money,
  shortDate,
} from "@/lib/pay-format";
import type { PayJob, PayPeriod } from "@/lib/pay-period";
import { cn } from "@/lib/utils";
import { EarnedCard, StageTracker, StatsGrid } from "./pay-chrome";

/**
 * One week, in full.
 *
 * The same screen however it was reached — from the week list or from a month.
 * The day breakdown is a section of it rather than a screen of its own, so
 * nobody has to remember which route they took to see their own days.
 */

/** What the tracker's sentence says, which depends entirely on the stage. */
function explain(period: PayPeriod, timeZone: string) {
  const { state } = period;

  if (state.stage === "paid") {
    const approved =
      state.approvedBy && state.approvedAt
        ? `Approved by ${state.approvedBy} on ${shortDate(state.approvedAt, timeZone)}, paid`
        : "Paid";
    const on = state.paidOn ? ` on ${shortDate(state.paidOn, timeZone)}` : "";
    return state.reduced
      ? `${approved}${on}, for less than was expected. Somebody recorded why on the payroll week.`
      : `${approved}${on}. This week is settled and will not change.`;
  }

  if (state.stage === "approved") {
    const by =
      state.approvedBy && state.approvedAt
        ? `Approved by ${state.approvedBy} on ${shortDate(state.approvedAt, timeZone)}.`
        : "Approved.";
    const when = state.expectedPayDate
      ? ` Expected to pay out around ${shortDate(state.expectedPayDate, timeZone)}.`
      : "";
    return `${by}${when} The amount is settled; only the payment is still to come.`;
  }

  if (state.stage === "review") {
    return "With payroll. The week has been built but nobody has approved it yet, so the amount can still change.";
  }

  return state.running
    ? "Still being worked. These figures come straight from your time records, so they can still change — nobody has reviewed or approved them yet."
    : "The week is over, but payroll has not picked it up yet. These figures come straight from your time records and can still change.";
}

function EarnedNote({
  period,
  timeZone,
}: {
  period: PayPeriod;
  timeZone: string;
}) {
  const { totals, state } = period;

  const reimbursed =
    totals.reimbursedCents > 0 ? (
      <>
        plus{" "}
        <span className="tabular-nums text-foreground">
          {money(totals.reimbursedCents)}
        </span>{" "}
        reimbursed
      </>
    ) : (
      "no reimbursements"
    );

  const payout =
    state.stage === "paid" && state.paidOn ? (
      <>
        paid{" "}
        <span className="tabular-nums text-foreground">
          {shortDate(state.paidOn, timeZone)}
        </span>
      </>
    ) : state.expectedPayDate ? (
      <>
        pays out around{" "}
        <span className="tabular-nums text-foreground">
          {shortDate(state.expectedPayDate, timeZone)}
        </span>
      </>
    ) : null;

  return (
    <>
      {reimbursed}
      {payout ? <> · {payout}</> : null}
    </>
  );
}

function DayByDay({
  period,
  timeZone,
  now,
}: {
  period: PayPeriod;
  timeZone: string;
  now: Date;
}) {
  const busiest = Math.max(...period.days.map((day) => day.paidMinutes), 0);
  const worked = period.days.filter((day) => day.paidMinutes > 0);
  const settled = period.state.stage === "paid";

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <h2 className="flex-1 text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
          Day by day
        </h2>
        <span className="text-[0.6875rem] tabular-nums text-muted-foreground">
          hours
        </span>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-3.5">
        {worked.map((day) => (
          <div
            key={day.at.toISOString()}
            className="flex flex-col gap-1.5"
          >
            <div className="flex items-baseline gap-2">
              <div className="w-12 shrink-0 text-xs font-semibold tabular-nums">
                {dayLabel(day.at, timeZone)}
              </div>
              <div className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                {day.titles.join(", ")}
              </div>
              <div className="text-xs tabular-nums text-muted-foreground">
                {hours(day.paidMinutes)}
              </div>
              <div className="w-[4.125rem] shrink-0 text-right text-[0.8125rem] font-semibold tabular-nums">
                {money(day.earnedCents)}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-12 shrink-0" />
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    "h-full rounded-full",
                    settled ? "bg-success" : "bg-primary",
                  )}
                  style={{
                    width: `${busiest > 0 ? Math.round((day.paidMinutes / busiest) * 100) : 0}%`,
                  }}
                />
              </div>
            </div>
          </div>
        ))}

        {worked.length > 0 && worked.length < period.days.length ? (
          <div className="h-px bg-border" />
        ) : null}

        {period.days
          .filter((day) => day.paidMinutes === 0)
          .map((day) => (
            <div
              key={day.at.toISOString()}
              className="flex items-center gap-2"
            >
              <div className="w-12 shrink-0 text-xs tabular-nums text-muted-foreground">
                {dayLabel(day.at, timeZone)}
              </div>
              <div className="flex-1 text-xs text-muted-foreground">
                {day.at.getTime() > now.getTime()
                  ? "Still to come"
                  : "Not worked"}
              </div>
            </div>
          ))}
      </div>
    </section>
  );
}

/**
 * The week's jobs under the day each was worked.
 *
 * Already sorted by clock-in, so the days come out in order without sorting
 * again — and a day with two jobs on it keeps them together, which is what the
 * old per-card date column was trying and failing to say.
 */
function groupByDay(
  jobs: PayJob[],
  timeZone: string,
): { key: string; label: string; jobs: PayJob[] }[] {
  const days: { key: string; label: string; jobs: PayJob[] }[] = [];

  for (const job of jobs) {
    const key = isoDateInZone(job.clockInAt, timeZone);
    const last = days[days.length - 1];
    if (last?.key === key) {
      last.jobs.push(job);
    } else {
      days.push({
        key,
        label: longDayLabel(job.clockInAt, timeZone),
        jobs: [job],
      });
    }
  }

  return days;
}

/**
 * One job, as the day actually went.
 *
 * Laid out down the page rather than indented off a date column: the date is
 * the group heading now, and the column it used to need was pushing every other
 * line into a narrow gutter. Each row leads with an icon so the eye can find the
 * one it wants — who it was for, where, when — without reading the others.
 */
function JobCard({
  job,
  timeZone,
  showRates,
}: {
  job: PayJob;
  timeZone: string;
  showRates: boolean;
}) {
  const rate =
    job.payType === "NON_BILLABLE"
      ? "no rate set"
      : job.payType === "FLAT"
        ? `${money(Math.round(Number(job.payRate) * 100))} flat`
        : `${money(Math.round(Number(job.payRate) * 100))}/hr`;

  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-border bg-surface p-4">
      <div className="flex items-start gap-2">
        <h3 className="min-w-0 flex-1 text-[0.9375rem] font-semibold leading-snug">
          {job.title}
        </h3>
        {job.outcome ? (
          <Badge variant={OUTCOME_META[job.outcome].variant}>
            {OUTCOME_META[job.outcome].label.toUpperCase()}
          </Badge>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5 text-xs text-muted-foreground">
        {/* The company that sent the work, then the brand and site it was at —
            the same two things, in the same order, as every export. */}
        <div className="flex items-start gap-2">
          <Building className="mt-px size-3.5 shrink-0" />
          <span className="min-w-0">
            <span className="text-foreground">{job.repCompany}</span> · {job.site}
          </span>
        </div>

        <div className="flex items-start gap-2">
          <MapPin className="mt-px size-3.5 shrink-0" />
          <span className="min-w-0">{job.address}</span>
        </div>

        <div className="flex items-start gap-2">
          <FileText className="mt-px size-3.5 shrink-0" />
          <span className="min-w-0 tabular-nums">
            {job.intWoId}
            {showRates ? ` · ${rate}` : null}
          </span>
        </div>
      </div>

      {/* What was worked and what it came to, on one line: the two halves of
          the same sentence, and the only two numbers most people are after. */}
      <div className="flex items-baseline gap-3 border-t border-border pt-2.5">
        <div className="flex min-w-0 flex-1 items-baseline gap-2 text-xs text-muted-foreground">
          <Clock className="size-3.5 shrink-0 translate-y-0.5" />
          <span className="tabular-nums">
            {clockTime(job.clockInAt, timeZone)} →{" "}
            {job.clockOutAt
              ? clockTime(job.clockOutAt, timeZone)
              : "still on the clock"}
          </span>
          <span className="tabular-nums">{hours(job.paidMinutes)} hrs</span>
        </div>

        <span className="shrink-0 text-base font-semibold tabular-nums text-success">
          {money(job.earnedCents)}
        </span>
      </div>

      {job.payType === "NON_BILLABLE" ? (
        <Badge variant="danger">No pay rate set for this job</Badge>
      ) : null}

      {job.reimbursements.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {job.reimbursements.map((one, index) => (
            <Badge key={`${one.label}-${index}`} variant="success">
              <span className="tabular-nums">+{money(one.cents)}</span>{" "}
              {one.label.toLowerCase()}
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function WeekView({
  period,
  timeZone,
  showRates,
  now,
}: {
  period: PayPeriod;
  timeZone: string;
  showRates: boolean;
  now: Date;
}) {
  return (
    <>
      <EarnedCard
        totals={period.totals}
        note={<EarnedNote period={period} timeZone={timeZone} />}
      />
      <StatsGrid totals={period.totals} />
      <StageTracker
        state={period.state}
        explanation={explain(period, timeZone)}
      />
      <DayByDay period={period} timeZone={timeZone} now={now} />

      <section className="flex flex-col gap-3">
        <h2 className="text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
          {period.jobs.length === 0
            ? "Jobs"
            : period.jobs.length === 1
              ? "The week’s one job"
              : "The week’s jobs"}
        </h2>

        {period.jobs.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
            Nothing clocked in this week.
          </div>
        ) : (
          groupByDay(period.jobs, timeZone).map((day) => (
            <div key={day.key} className="flex flex-col gap-2">
              <h3 className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                {day.label}
              </h3>
              {day.jobs.map((job) => (
                <JobCard
                  key={job.assignmentId}
                  job={job}
                  timeZone={timeZone}
                  showRates={showRates}
                />
              ))}
            </div>
          ))
        )}
      </section>
    </>
  );
}
