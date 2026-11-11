import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { getCompanySettings } from "@/lib/company";
import { startOfWeekMonday, zonedMidnight, zonedParts } from "@/lib/datetime";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { weeksInMonth } from "@/lib/payroll";
import { reportIds } from "@/lib/scope";
import { computeStats, type StatsRange } from "@/lib/stats";
import { getSessionUser, permissionScope } from "@/lib/session";
import { cn } from "@/lib/utils";

export const metadata = { title: "Statistics" };

export default async function StatsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const viewer = await getSessionUser();
  if (!viewer) redirect("/signin");

  if (!permissionScope(viewer, "payroll.view")) redirect("/dashboard");

  const company = await getCompanySettings();
  const zone = company.defaultTimeZone;
  const params = await searchParams;

  // Own figures only, like the rest of Pay. Somebody else's totals are a
  // payroll question and are answered on the payroll pages.
  const subjectId = viewer.id;

  const now = new Date();
  const { year, month } = zonedParts(now, zone);

  const thisWeek = startOfWeekMonday(now, zone);
  const lastWeek = new Date(thisWeek.getTime() - 7 * 24 * 60 * 60_000);
  const monthWeeks = weeksInMonth(year, month, zone);
  const previousMonth = month === 1 ? 12 : month - 1;
  const previousMonthYear = month === 1 ? year - 1 : year;
  const previousWeeks = weeksInMonth(previousMonthYear, previousMonth, zone);

  const ranges: { key: string; label: string; range: StatsRange }[] = [
    {
      key: "week",
      label: "This week",
      range: { from: thisWeek, to: new Date(thisWeek.getTime() + 7 * 864e5) },
    },
    {
      key: "last-week",
      label: "Last week",
      range: { from: lastWeek, to: thisWeek },
    },
    {
      key: "month",
      label: "This month",
      range:
        monthWeeks.length > 0
          ? { from: monthWeeks[0].start, to: monthWeeks[monthWeeks.length - 1].end }
          : { from: zonedMidnight(year, month, 1, zone), to: now },
    },
    {
      key: "last-month",
      label: "Last month",
      range:
        previousWeeks.length > 0
          ? {
              from: previousWeeks[0].start,
              to: previousWeeks[previousWeeks.length - 1].end,
            }
          : { from: null, to: null },
    },
    { key: "all", label: "All time", range: { from: null, to: null } },
  ];

  const selected =
    ranges.find((entry) => entry.key === params.period) ?? ranges[0];

  const stats = await computeStats(subjectId, selected.range);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <PageHeader
        title="Statistics"
        backHref="/pay"
        description={`Your figures · ${selected.label}`}
      />

      {/* Chips a thumb can hit. They were badges — labels a couple of dozen
          pixels tall, made into links — and the period was the one thing on
          the page anybody changes. */}
      <nav aria-label="Period" className="flex flex-wrap gap-2">
        {ranges.map((entry) => {
          const current = entry.key === selected.key;
          return (
            <Link
              key={entry.key}
              href={`/pay/stats?period=${entry.key}`}
              aria-current={current ? "page" : undefined}
              className={cn(
                "inline-flex min-h-10 items-center rounded-full border px-4 text-sm font-medium transition-colors",
                current
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {entry.label}
            </Link>
          );
        })}
      </nav>

      {/* Six figures as tiles, two to a row on a phone and three wider. As
          six cards the width of the screen they were two screens of one
          number each, and the one somebody came for was usually below the
          fold. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Jobs" value={String(stats.jobs)} />
        <Stat
          label="Hours on site"
          value={(stats.onsiteMinutes / 60).toFixed(2)}
        />
        <Stat label="Hours paid" value={(stats.paidMinutes / 60).toFixed(2)} />
        <Stat label="Earned" value={formatMoney(stats.earnedCents / 100)} />
        <Stat
          label="Reimbursed"
          value={formatMoney(stats.reimbursedCents / 100)}
        />
        <Stat
          label="Blended hourly"
          value={
            stats.blendedHourlyCents === null
              ? "—"
              : formatMoney(stats.blendedHourlyCents / 100)
          }
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>How the blended rate is worked out</CardTitle>
          <CardDescription>
            Everything earned divided by every hour on site, so flat-rate and
            non-billable visits pull it down. Averaging the rates themselves
            would flatter it.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <span>
            <span className="text-muted-foreground">Hourly jobs </span>
            <span className="tabular">{stats.hourlyJobs}</span>
          </span>
          <span>
            <span className="text-muted-foreground">Flat rate </span>
            <span className="tabular">{stats.flatJobs}</span>
          </span>
          <span>
            <span className="text-muted-foreground">Non-billable </span>
            <span className="tabular">{stats.nonBillableJobs}</span>
          </span>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-3 sm:p-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        {/* A size smaller on a phone, where a tile is half the screen and a
            five-figure amount has to fit in it. */}
        <div className="tabular mt-0.5 text-lg font-semibold [overflow-wrap:anywhere] sm:text-2xl">
          {value}
        </div>
      </CardContent>
    </Card>
  );
}
