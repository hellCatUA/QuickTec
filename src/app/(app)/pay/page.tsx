import { redirect } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { getCompanySettings } from "@/lib/company";
import {
  isoDateInZone,
  parseZonedDate,
  startOfWeekMonday,
  zonedParts,
} from "@/lib/datetime";
import {
  monthAbbr,
  monthLabel,
  monthParam,
  parseMonthParam,
  weekParam,
  weekSpan,
} from "@/lib/pay-format";
import { loadPayMonth, loadPayWeek, loadPayWeeks } from "@/lib/pay-period";
import { weekMonth } from "@/lib/payroll";
import { can, getSessionUser, permissionScope } from "@/lib/session";
import { MonthView } from "./month-view";
import { PeriodRow, ScopeToggle } from "./pay-chrome";
import { WeekView } from "./week-view";
import { WeeksView } from "./weeks-view";

export const metadata = { title: "Pay" };

/**
 * Pay — what one person earned, and nobody else's.
 *
 * Deliberately single-subject: there is no person switcher here and no button
 * that changes anything. Deciding what the company owes is Payroll's job and
 * lives on its own page, so this one can be read without wondering which of
 * these figures somebody else is still allowed to move.
 *
 *   /pay                     the weeks behind you, under the month each is in
 *   /pay?week=2026-09-14     that week: stats, day by day, the jobs
 *   /pay?month=2026-09       that month: stats, and its weeks
 *   &from=2026-09            came from a month, so Back returns to it
 */
export default async function PayPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; month?: string; from?: string }>;
}) {
  const viewer = await getSessionUser();
  if (!viewer) redirect("/signin");

  // Own pay only, so OWN is enough — a wider scope buys nothing on this page.
  if (!permissionScope(viewer, "payroll.view")) redirect("/dashboard");

  const company = await getCompanySettings();
  const zone = company.defaultTimeZone;
  const params = await searchParams;

  const now = new Date();
  const showRates = can(viewer, "pay.view_rates");
  const canExport = can(viewer, "export.pay");

  const thisWeekStart = startOfWeekMonday(now, zone);
  const thisMonth = zonedParts(now, zone);

  const header = (
    <div className="flex flex-col gap-0.5">
      <h1 className="text-2xl font-semibold tracking-tight">Pay</h1>
      <p className="text-xs text-muted-foreground">
        What you have earned. Weeks run Monday to Sunday, and a week belongs to
        the month its Monday falls in.
      </p>
    </div>
  );

  const stats = (
    <Link href="/pay/stats" className="text-xs text-muted-foreground underline">
      All-time figures
    </Link>
  );

  // --- one month -----------------------------------------------------------
  const askedMonth = parseMonthParam(params.month);
  if (askedMonth) {
    const { period, weeks } = await loadPayMonth({
      userId: viewer.id,
      year: askedMonth.year,
      month: askedMonth.month,
      timeZone: zone,
      payLagWeeks: company.payLagWeeks,
      now,
    });

    const previous =
      askedMonth.month === 1
        ? { year: askedMonth.year - 1, month: 12 }
        : { year: askedMonth.year, month: askedMonth.month - 1 };
    const next =
      askedMonth.month === 12
        ? { year: askedMonth.year + 1, month: 1 }
        : { year: askedMonth.year, month: askedMonth.month + 1 };

    const isCurrent =
      askedMonth.year === thisMonth.year && askedMonth.month === thisMonth.month;

    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        {header}
        <ScopeToggle
          active="monthly"
          weeklyHref="/pay"
          monthlyHref={`/pay?month=${monthParam(askedMonth.year, askedMonth.month)}`}
        />
        <PeriodRow
          name={isCurrent ? "This month" : monthLabel(askedMonth.year, askedMonth.month)}
          detail={monthLabel(askedMonth.year, askedMonth.month)}
          prevHref={`/pay?month=${monthParam(previous.year, previous.month)}`}
          nextHref={
            isCurrent
              ? undefined
              : `/pay?month=${monthParam(next.year, next.month)}`
          }
          exportHref={
            canExport
              ? `/api/pay/export?month=${monthParam(askedMonth.year, askedMonth.month)}&user=${viewer.id}`
              : undefined
          }
          exportLabel={`${monthAbbr(askedMonth.month)} .xlsx`}
        />
        <MonthView
          period={period}
          weeks={weeks}
          month={askedMonth}
          timeZone={zone}
        />
        {stats}
      </div>
    );
  }

  // --- one week ------------------------------------------------------------
  const anchor = params.week ? parseZonedDate(params.week, zone) : null;
  if (anchor) {
    const weekStart = startOfWeekMonday(anchor, zone);
    const period = await loadPayWeek({
      userId: viewer.id,
      weekStart,
      timeZone: zone,
      payLagWeeks: company.payLagWeeks,
      now,
    });

    const filed = weekMonth(weekStart, zone);
    const cameFrom = parseMonthParam(params.from);
    const isCurrent = weekStart.getTime() === thisWeekStart.getTime();

    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        {header}
        <ScopeToggle
          active="weekly"
          weeklyHref="/pay"
          monthlyHref={`/pay?month=${monthParam(filed.year, filed.month)}`}
        />
        <PeriodRow
          name={
            isCurrent
              ? "This week"
              : `Week of ${weekSpan(period.start, period.end, zone).split(" – ")[0]}`
          }
          detail={`W${period.week} · ${weekSpan(period.start, period.end, zone)}`}
          backHref={
            cameFrom
              ? `/pay?month=${monthParam(cameFrom.year, cameFrom.month)}`
              : "/pay"
          }
          exportHref={
            canExport
              ? `/api/pay/export?week=${weekParam(weekStart, zone)}&user=${viewer.id}`
              : undefined
          }
          exportLabel={`W${period.week} .xlsx`}
        />
        <WeekView
          period={period}
          timeZone={zone}
          showRates={showRates}
          now={now}
        />
        {stats}
      </div>
    );
  }

  // --- the weeks behind you ------------------------------------------------
  const groups = await loadPayWeeks({
    userId: viewer.id,
    timeZone: zone,
    payLagWeeks: company.payLagWeeks,
    count: 12,
    now,
  });

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      {header}
      <ScopeToggle
        active="weekly"
        weeklyHref="/pay"
        monthlyHref={`/pay?month=${monthParam(thisMonth.year, thisMonth.month)}`}
      />
      <WeeksView
        groups={groups}
        timeZone={zone}
        currentWeekStart={thisWeekStart}
      />
      <div className="flex items-center justify-between">
        {stats}
        {canExport ? (
          <a
            href={`/api/pay/export?week=${isoDateInZone(thisWeekStart, zone)}&user=${viewer.id}`}
          >
            <Button type="button" size="sm" variant="secondary">
              This week .xlsx
            </Button>
          </a>
        ) : null}
      </div>
    </div>
  );
}
