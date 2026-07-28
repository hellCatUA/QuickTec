import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
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

export const metadata = { title: "Statistics" };

export default async function StatsPage({
  searchParams,
}: {
  searchParams: Promise<{ user?: string; period?: string }>;
}) {
  const viewer = await getSessionUser();
  if (!viewer) redirect("/signin");

  const scope = permissionScope(viewer, "payroll.view");
  if (!scope) redirect("/dashboard");

  const company = await getCompanySettings();
  const zone = company.defaultTimeZone;
  const params = await searchParams;

  const visibleIds =
    scope === "ALL"
      ? null
      : scope === "OWN"
        ? [viewer.id]
        : [viewer.id, ...(await reportIds(viewer.id))];

  const subjectId =
    params.user && (visibleIds === null || visibleIds.includes(params.user))
      ? params.user
      : viewer.id;

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

  const [subject, team, stats] = await Promise.all([
    db.user.findUniqueOrThrow({
      where: { id: subjectId },
      select: { name: true },
    }),
    visibleIds === null
      ? db.user.findMany({
          where: { active: true },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        })
      : db.user.findMany({
          where: { id: { in: visibleIds } },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        }),
    computeStats(subjectId, selected.range),
  ]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <PageHeader
        title="Statistics"
        backHref="/pay"
        description={`${subject.name} · ${selected.label}`}
      />

      {team.length > 1 ? (
        <div className="flex flex-wrap gap-1.5">
          {team.map((person) => (
            <Link
              key={person.id}
              href={`/pay/stats?user=${person.id}&period=${selected.key}`}
            >
              <Badge variant={person.id === subjectId ? "primary" : "neutral"}>
                {person.id === viewer.id ? "You" : person.name}
              </Badge>
            </Link>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-1.5">
        {ranges.map((entry) => (
          <Link
            key={entry.key}
            href={`/pay/stats?user=${subjectId}&period=${entry.key}`}
          >
            <Badge variant={entry.key === selected.key ? "primary" : "neutral"}>
              {entry.label}
            </Badge>
          </Link>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
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
      <CardContent>
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div className="tabular text-2xl font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}
