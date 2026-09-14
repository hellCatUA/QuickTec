import { ChevronLeft, ChevronRight, Download, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { getCompanySettings } from "@/lib/company";
import { isoDateInZone, parseZonedDate, startOfWeekMonday } from "@/lib/datetime";
import { hours, money, monthParam, shortDate, weekSpan } from "@/lib/pay-format";
import { PAY_STAGE_LABEL, type PayStage } from "@/lib/pay-period";
import { loadPayrollWeek } from "@/lib/payroll-week";
import { weekMonth } from "@/lib/payroll";
import { reportIds } from "@/lib/scope";
import { can, getSessionUser, permissionScope } from "@/lib/session";
import { BuildWeekButton } from "./build-week";

export const metadata = { title: "Payroll" };

const STAGE_VARIANT: Record<PayStage, "primary" | "warning" | "success" | "neutral"> =
  {
    recorded: "primary",
    review: "warning",
    approved: "success",
    paid: "neutral",
  };

/**
 * Payroll — what the company owes, a week at a time.
 *
 * Opens on a week rather than on a person, because "who do I owe for last
 * week" is the question somebody actually arrives with. One Build covers
 * everybody in it, and a person whose rate never resolved is called out rather
 * than quietly totalling to $0.00: a rate that came out non-billable is a gap,
 * not a fact about the work.
 */
export default async function PayrollPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const viewer = await getSessionUser();
  if (!viewer) redirect("/signin");

  const scope = permissionScope(viewer, "payroll.view");
  // Own pay is Pay's job. Payroll is only meaningful for somebody who can see
  // more than themselves, so a tech is sent where their money actually is.
  if (!scope || scope === "OWN") redirect("/pay");

  const company = await getCompanySettings();
  const zone = company.defaultTimeZone;
  const params = await searchParams;
  const now = new Date();

  const anchor = params.week ? parseZonedDate(params.week, zone) : null;
  const weekStart = startOfWeekMonday(anchor ?? now, zone);
  const thisWeekStart = startOfWeekMonday(now, zone);

  const visibleIds =
    scope === "ALL" ? null : [viewer.id, ...(await reportIds(viewer.id))];

  const week = await loadPayrollWeek({
    visibleIds,
    weekStart,
    timeZone: zone,
    payLagWeeks: company.payLagWeeks,
    now,
  });

  const canRun = Boolean(permissionScope(viewer, "payroll.run"));
  const canExport = can(viewer, "export.pay");
  const canEditRates = can(viewer, "pay.edit_rates");

  const key = (start: Date) => isoDateInZone(start, zone);
  const shift = (weeks: number) =>
    `/payroll?week=${key(new Date(weekStart.getTime() + weeks * 7 * 86_400_000))}`;

  const filed = weekMonth(weekStart, zone);
  const stepper =
    "flex size-11 shrink-0 items-center justify-center rounded-[0.625rem] border border-border bg-surface text-muted-foreground hover:text-foreground";

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <div className="flex items-start gap-3">
        <div className="flex flex-1 flex-col gap-0.5">
          <h1 className="text-2xl font-semibold tracking-tight">Payroll</h1>
          <p className="text-xs text-muted-foreground">
            What the company owes, week by week.
          </p>
        </div>
        {canEditRates ? (
          <Link
            href="/payroll/rates"
            className="mt-1 text-xs text-muted-foreground underline"
          >
            Rates
          </Link>
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        <Link href={shift(-1)} aria-label="Previous week" className={stepper}>
          <ChevronLeft className="size-4" />
        </Link>
        <div className="flex flex-1 flex-col items-center gap-px">
          <div className="text-[0.9375rem] font-semibold tabular-nums">
            W{week.week} · {weekSpan(week.start, week.end, zone)}
          </div>
          <div className="text-[0.6875rem] text-muted-foreground">
            pays out around {shortDate(week.expectedPayDate, zone)}
          </div>
        </div>
        {weekStart.getTime() >= thisWeekStart.getTime() ? (
          <span className={`${stepper} opacity-40`} aria-hidden>
            <ChevronRight className="size-4" />
          </span>
        ) : (
          <Link href={shift(1)} aria-label="Next week" className={stepper}>
            <ChevronRight className="size-4" />
          </Link>
        )}
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
        <div className="flex items-end gap-3">
          <div className="flex flex-1 flex-col gap-0.5">
            <div className="text-[0.6875rem] font-medium uppercase tracking-[0.06em] text-muted-foreground">
              Expected
            </div>
            <div className="text-3xl font-semibold leading-tight tracking-tight tabular-nums">
              {money(week.totals.expectedCents)}
            </div>
          </div>
          <div className="flex flex-col items-end gap-0.5 text-[0.8125rem] tabular-nums text-muted-foreground">
            <span>
              {week.totals.people}{" "}
              {week.totals.people === 1 ? "person" : "people"}
            </span>
            <span>{hours(week.totals.paidMinutes)} hrs</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {(Object.keys(week.stages) as PayStage[])
            .filter((stage) => week.stages[stage] > 0)
            .map((stage) => (
              <Badge key={stage} variant={STAGE_VARIANT[stage]}>
                {week.stages[stage]}{" "}
                {stage === "recorded"
                  ? "not built"
                  : PAY_STAGE_LABEL[stage].toLowerCase()}
              </Badge>
            ))}
          {week.needingRate > 0 ? (
            <Badge variant="danger">
              {week.needingRate}{" "}
              {week.needingRate === 1 ? "needs a rate" : "need a rate"}
            </Badge>
          ) : null}
          {week.totals.people === 0 ? (
            <Badge variant="neutral">Nobody worked this week</Badge>
          ) : null}
        </div>
      </div>

      {canRun && week.stages.recorded > 0 ? (
        <BuildWeekButton week={key(weekStart)} count={week.stages.recorded} />
      ) : null}

      {week.people.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            Who is in this week
          </h2>

          <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-surface">
            {week.people.map((person, index) => (
              <Link
                key={person.userId}
                href={`/payroll/${person.userId}?week=${key(weekStart)}`}
                className={`flex min-h-11 items-center gap-3 px-3.5 py-3 hover:bg-surface-raised ${
                  index === week.people.length - 1
                    ? ""
                    : "border-b border-border"
                }`}
              >
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="text-sm font-semibold">{person.name}</div>
                  {person.needsRate ? (
                    <div className="flex items-center gap-1.5 text-[0.6875rem] tabular-nums text-danger">
                      <TriangleAlert className="size-3 shrink-0" />
                      {person.jobs} {person.jobs === 1 ? "job" : "jobs"} ·{" "}
                      {hours(person.paidMinutes)} hrs · no rate set
                    </div>
                  ) : (
                    <div className="text-[0.6875rem] tabular-nums text-muted-foreground">
                      {person.jobs} {person.jobs === 1 ? "job" : "jobs"} ·{" "}
                      {hours(person.paidMinutes)} hrs
                      {person.soleHourlyRate
                        ? ` · ${money(Math.round(Number(person.soleHourlyRate) * 100))}/hr`
                        : person.jobs > 0
                          ? " · mixed rates"
                          : ""}
                    </div>
                  )}
                  {/* An override makes these differ on purpose; work having
                      moved since the build makes them differ by accident. The
                      row cannot tell which, so it says the figure is not what
                      the clock now reads and leaves the reading to whoever
                      opens it. */}
                  {person.periodId &&
                  person.expectedCents !== person.clockCents ? (
                    <div className="text-[0.6875rem] tabular-nums text-warning">
                      built at {money(person.expectedCents)}; the clock now says{" "}
                      {money(person.clockCents)}
                    </div>
                  ) : null}
                </div>

                <div className="flex shrink-0 flex-col items-end gap-1">
                  <div
                    className={`text-[0.9375rem] font-semibold tabular-nums ${
                      person.needsRate ? "text-muted-foreground" : ""
                    }`}
                  >
                    {money(person.expectedCents)}
                  </div>
                  {person.needsRate ? (
                    <Badge variant="danger">Needs a rate</Badge>
                  ) : (
                    <Badge variant={STAGE_VARIANT[person.stage]}>
                      {person.stage === "recorded"
                        ? "Not built"
                        : PAY_STAGE_LABEL[person.stage]}
                    </Badge>
                  )}
                </div>

                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {canExport ? (
        <div className="flex gap-2">
          <a
            href={`/api/pay/export?week=${key(weekStart)}`}
            className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-[0.625rem] border border-border bg-surface-raised text-[0.8125rem] font-medium hover:bg-muted"
          >
            <Download className="size-4" /> Week .xlsx
          </a>
          <a
            href={`/api/pay/export?month=${monthParam(filed.year, filed.month)}`}
            className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-[0.625rem] border border-border bg-surface-raised text-[0.8125rem] font-medium hover:bg-muted"
          >
            <Download className="size-4" /> Month .xlsx
          </a>
        </div>
      ) : null}
    </div>
  );
}
