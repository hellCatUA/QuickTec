import {
  BedDouble,
  Building,
  Car,
  ChevronDown,
  Clock,
  FileText,
  MapPin,
  Package,
  Paperclip,
  SquareParking,
  Ticket,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  clockTime,
  dayLabel,
  expenseLabel,
  hours,
  money,
  shortDate,
  statementLines,
} from "@/lib/pay-format";
import {
  jobTotal,
  type PayExpense,
  type PayJob,
  type PayPeriod,
} from "@/lib/pay-period";
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

  // The split behind the headline, which is now the total. Written out rather
  // than left for somebody to do, because it is two different kinds of money:
  // hours worked, and a hotel bill handed back.
  const reimbursed =
    totals.reimbursedCents > 0 ? (
      <>
        <span className="tabular-nums text-foreground">
          {money(totals.earnedCents)}
        </span>{" "}
        labour +{" "}
        <span className="tabular-nums text-foreground">
          {money(totals.reimbursedCents)}
        </span>{" "}
        expenses
      </>
    ) : (
      "no expenses claimed"
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
                {money(day.earnedCents + day.expensesCents)}
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

/** One icon per kind, so the row's text can be the name rather than the word. */
const EXPENSE_ICON: Record<PayExpense["kind"], LucideIcon> = {
  TRAVEL: Car,
  PARKING: SquareParking,
  TOLL: Ticket,
  HOTEL: BedDouble,
  MATERIAL: Package,
};

/**
 * One job in the week.
 *
 * The date stays in its own column and the detail stays indented under the
 * title. Where money was claimed back, the card grows a statement across its
 * foot — labour first, then every expense — and the figure at the top becomes
 * what the job actually paid, so the two agree instead of sitting there
 * unreconciled.
 *
 * A job with nothing claimed keeps the plain card: a one-line statement whose
 * only line repeats the heading is worse than no statement.
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
  const span = job.clockOutAt
    ? `${clockTime(job.clockInAt, timeZone)} – ${clockTime(job.clockOutAt, timeZone)}`
    : `${clockTime(job.clockInAt, timeZone)} – still on the clock`;

  const rate =
    job.payType === "NON_BILLABLE"
      ? "no rate set"
      : job.payType === "FLAT"
        ? `${money(Math.round(Number(job.payRate) * 100))} flat`
        : `${money(Math.round(Number(job.payRate) * 100))}/hr`;

  const claimed = job.reimbursements.length > 0;

  return (
    <div className="flex flex-col gap-2 overflow-hidden rounded-xl border border-border bg-surface p-3.5">
      <div className="flex items-baseline gap-2">
        <div className="w-[3.375rem] shrink-0 text-xs tabular-nums text-muted-foreground">
          {dayLabel(job.clockInAt, timeZone)}
        </div>
        <div className="min-w-0 flex-1 text-sm font-semibold">{job.title}</div>
        {/* What the job paid, all in. A touch larger than the title and nothing
            else: it is the number the page exists for, but it is not a
            different kind of thing. */}
        <div className="shrink-0 text-base font-semibold tabular-nums">
          {money(jobTotal(job))}
        </div>
      </div>

      <div className="flex flex-col gap-2 pl-[3.875rem] text-xs text-muted-foreground">
        {/* The company that sent the work, then the brand and site it was at —
            the same two things, in the same order, as every export. */}
        <div className="flex items-start gap-2">
          <Building className="mt-px size-3.5 shrink-0" />
          <span className="min-w-0">
            {job.payingCompany} · {job.site}
          </span>
        </div>

        <div className="flex items-start gap-2">
          <MapPin className="mt-px size-3.5 shrink-0" />
          <span className="min-w-0">{job.address}</span>
        </div>

        <div className="flex items-start gap-2">
          <Clock className="mt-px size-3.5 shrink-0" />
          {/* The hours and the rate move down to the labour line when there is
              a statement, rather than being said twice three rows apart. */}
          <span className="min-w-0 tabular-nums">
            {span}
            {claimed ? null : (
              <>
                {" · "}
                {hours(job.paidMinutes)} hrs
                {showRates ? ` · ${rate}` : null}
              </>
            )}
          </span>
        </div>

        <div className="flex items-start gap-2">
          <FileText className="mt-px size-3.5 shrink-0" />
          <span className="min-w-0 tabular-nums">{job.intWoId}</span>
        </div>
      </div>

      {job.payType === "NON_BILLABLE" ? (
        <div className="pl-[3.875rem]">
          <Badge variant="danger">No pay rate set for this job</Badge>
        </div>
      ) : null}

      {/* The tear-off. Full width of the card, so it reads as its own thing:
          what the job was made of, in the order payroll buckets it. */}
      {claimed ? (
        <div className="-mx-3.5 -mb-3.5 mt-1.5 flex flex-col gap-2 border-t border-border bg-surface-raised px-3.5 py-3 text-xs text-muted-foreground">
          <div className="flex items-start gap-2">
            <Wrench className="mt-px size-3.5 shrink-0" />
            <span className="min-w-0 flex-1 tabular-nums">
              Labour · {hours(job.paidMinutes)} hrs
              {showRates ? ` @ ${rate}` : null}
            </span>
            <span className="shrink-0 tabular-nums text-foreground">
              {money(job.earnedCents)}
            </span>
          </div>

          {statementLines(job.reimbursements).map((line, index) => {
            if (line.kind === "materials") {
              return (
                // A plain <details>, so the shopping list costs no JavaScript
                // and one left open survives a re-render. Shut by default: the
                // total is the answer, the list is the receipt for it.
                <details key={`materials-${index}`} className="group/shelf">
                  <summary
                    className={cn(
                      "flex cursor-pointer list-none items-start gap-2",
                      "[&::-webkit-details-marker]:hidden",
                    )}
                  >
                    <Package className="mt-px size-3.5 shrink-0" />
                    <span className="min-w-0 flex-1">
                      Materials
                      <ChevronDown
                        className={cn(
                          "ml-1 inline-block size-3.5 align-text-bottom",
                          "text-muted-foreground transition-transform",
                          "group-open/shelf:rotate-180",
                        )}
                      />
                    </span>
                    <span className="shrink-0 tabular-nums text-foreground">
                      {money(line.cents)}
                    </span>
                  </summary>

                  {/* Indented to where the heading's text starts, and without
                      seven identical boxes down the margin — the line above
                      has already said what these are. The amounts stay muted
                      so the total is the one figure that reads as a figure. */}
                  <div className="mt-2 flex flex-col gap-2 pl-[1.375rem]">
                    {line.items.map((one, at) => (
                      <div
                        key={`${one.label ?? "material"}-${at}`}
                        className="flex items-start gap-2"
                      >
                        <span className="min-w-0 flex-1">
                          {expenseLabel(one)}
                        </span>
                        {one.hasReceipt ? (
                          <Paperclip
                            className="mt-0.5 size-3 shrink-0"
                            aria-label="Receipt attached"
                          />
                        ) : null}
                        <span className="shrink-0 tabular-nums">
                          {money(one.cents)}
                        </span>
                      </div>
                    ))}
                  </div>
                </details>
              );
            }

            const one = line.expense;
            const Icon = EXPENSE_ICON[one.kind];
            return (
              <div
                key={`${one.kind}-${index}`}
                className="flex items-start gap-2"
              >
                <Icon className="mt-px size-3.5 shrink-0" />
                <span className="min-w-0 flex-1">{expenseLabel(one)}</span>
                {one.hasReceipt ? (
                  <Paperclip
                    className="mt-0.5 size-3 shrink-0"
                    aria-label="Receipt attached"
                  />
                ) : null}
                <span className="shrink-0 tabular-nums text-foreground">
                  {money(one.cents)}
                </span>
              </div>
            );
          })}
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

      <section className="flex flex-col gap-2">
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
          period.jobs.map((job) => (
            <JobCard
              key={job.assignmentId}
              job={job}
              timeZone={timeZone}
              showRates={showRates}
            />
          ))
        )}
      </section>
    </>
  );
}
