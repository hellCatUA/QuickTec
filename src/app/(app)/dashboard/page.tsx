import {
  CircleAlert,
  CircleCheck,
  Inbox,
  Layers,
  Plus,
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Avatar } from "@/components/profile/parts";
import { Badge } from "@/components/ui/badge";
import { formatPhone, telHref } from "@/lib/phone";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { WeekSchedule, type ScheduleDay } from "@/components/week-schedule";
import { siteLabelOnScreen } from "@/lib/address";
import { getCompanySettings } from "@/lib/company";
import {
  endOfWeekMonday,
  isoDateInZone,
  startOfWeekMonday,
  usTimeInZone,
  zonedParts,
} from "@/lib/datetime";
import { db } from "@/lib/db";
import { OPEN_LIFECYCLES } from "@/lib/job-status";
import { jobScopeWhere } from "@/lib/scope";
import { uploadsWritable } from "@/lib/storage";
import { isGuest } from "@/lib/permissions";
import { reachableContact } from "@/lib/profile";
import { waitingOnYou } from "@/lib/waiting";
import { can, getSessionUser, permissionScope } from "@/lib/session";

export const metadata = { title: "Dashboard" };

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * What is on this week, what you are running, and what is waiting on you.
 *
 * It used to be a description of your own permissions, which is a thing you
 * find out once and never need again. These three are what somebody opens the
 * app to find out, so they are what it opens on.
 */
export default async function DashboardPage() {
  const user = await getSessionUser();
  if (!user) redirect("/signin");

  const company = await getCompanySettings();
  const zone = user.timeZone || company.defaultTimeZone;

  const now = new Date();
  const weekStart = startOfWeekMonday(now, zone);
  const weekEnd = endOfWeekMonday(now, zone);
  const today = isoDateInZone(now, zone);

  const jobWhere = await jobScopeWhere(user, "job.view");
  const uploads = can(user, "settings.company")
    ? await uploadsWritable()
    : ({ ok: true } as const);

  const [scheduled, projects, supervisor] = await Promise.all([
    jobWhere
      ? db.job.findMany({
          where: {
            AND: [
              jobWhere,
              // weekEnd is next Monday's midnight: the first instant of the
              // week after, not the last of this one.
              { scheduledStart: { gte: weekStart, lt: weekEnd } },
              { lifecycle: { notIn: ["CLOSED"] } },
            ],
          },
          orderBy: { scheduledStart: "asc" },
          take: 200,
          select: {
            id: true,
            intWoId: true,
            title: true,
            scheduledStart: true,
            estimateMinutes: true,
            lifecycle: true,
            customer: { select: { code: true } },
            site: {
              select: {
                siteNumber: true,
                numberPending: true,
                city: true,
                state: true,
                timeZone: true,
              },
            },
            assignments: {
              orderBy: { isLead: "desc" },
              select: { user: { select: { name: true } } },
            },
          },
        })
      : [],

    // Projects you are actually on, not the whole portfolio: a manager with
    // ALL scope still opens the dashboard to see their own work. Not for a
    // guest, who is let into particular jobs rather than into projects.
    isGuest(user) ? [] : db.project.findMany({
      where: {
        status: "ACTIVE",
        OR: [
          { managerId: user.id },
          { members: { some: { userId: user.id } } },
        ],
      },
      orderBy: { name: "asc" },
      take: 12,
      select: {
        id: true,
        name: true,
        code: true,
        client: { select: { name: true } },
        manager: { select: { id: true } },
        _count: { select: { jobs: true } },
        jobs: {
          where: { lifecycle: { in: OPEN_LIFECYCLES } },
          select: { id: true },
        },
      },
    }),

    // Their supervisor as this person may see them: the numbers the
    // supervisor's profile shares, not their personal one.
    user.directSupervisorId
      ? Promise.all([
          db.user.findUnique({
            where: { id: user.directSupervisorId },
            select: { name: true },
          }),
          reachableContact(user, user.directSupervisorId),
        ]).then(([row, contact]) => (row ? { name: row.name, ...contact } : null))
      : Promise.resolve(null),
  ]);

  // --- what is waiting on you ------------------------------------------------
  // Counted where the Approvals tab's number is counted, so the two agree.
  const {
    changes: changeCount,
    adHoc: adHocCount,
    reviews: reviewCount,
    payroll: payrollCount,
    profileRequests: profileRequestCount,
    notices: notificationCount,
    mine: myPendingCount,
  } = await waitingOnYou(user);

  const waiting = [
    { label: "Suggested changes", count: changeCount, href: "/approvals" },
    { label: "Ad-hoc jobs", count: adHocCount, href: "/approvals" },
    { label: "Reports to review", count: reviewCount, href: "/approvals" },
    { label: "Payroll weeks", count: payrollCount, href: "/approvals" },
    { label: "Profile requests", count: profileRequestCount, href: "/approvals" },
    {
      label: "To acknowledge",
      count: notificationCount,
      href: "/approvals",
    },
    {
      label: "Your requests pending",
      count: myPendingCount,
      href: "/approvals?tab=outgoing",
    },
  ].filter((row) => row.count > 0);

  // --- the week --------------------------------------------------------------
  const days: ScheduleDay[] = Array.from({ length: 7 }, (_, offset) => {
    const at = new Date(weekStart.getTime() + offset * 86_400_000);
    const parts = zonedParts(at, zone);
    const date = `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;

    return {
      date,
      weekday: WEEKDAYS[offset],
      dayLabel: `${parts.month}/${parts.day}`,
      isToday: date === today,
      isPast: date < today,
      jobs: [],
    };
  });

  const byDate = new Map(days.map((day) => [day.date, day]));

  for (const job of scheduled) {
    if (!job.scheduledStart) continue;
    // A job is on the day it is on at the site, not in the viewer's zone: a
    // 6am start in New York is not the night before for a planner in Seattle.
    const siteZone = job.site.timeZone ?? zone;
    const day = byDate.get(isoDateInZone(job.scheduledStart, siteZone));
    if (!day) continue;

    day.jobs.push({
      id: job.id,
      intWoId: job.intWoId,
      title: job.title,
      siteLabel: siteLabelOnScreen(job.customer.code, job.site),
      city: job.site.city,
      state: job.site.state,
      time: usTimeInZone(job.scheduledStart, siteZone),
      lifecycle: job.lifecycle,
      crew: job.assignments.map((assignment) => assignment.user.name),
      estimateHours: job.estimateMinutes ? job.estimateMinutes / 60 : null,
    });
  }

  // Things that will quietly break later if they are left unset now.
  const setupChecks = can(user, "settings.company")
    ? [
        {
          done: company.name !== "QuickTec",
          label: "Set the company name",
          detail:
            "Used in the internal work order field label and every export header.",
          href: "/settings/company",
        },
        {
          done: Boolean(company.logoUrl),
          label: "Add a company logo",
          detail: "Appears on the internal PDF work order.",
          href: "/settings/company",
        },
        {
          done:
            (await db.user.count({
              where: { directSupervisorId: null, baseRole: "TECH" },
            })) === 0,
          label: "Give every tech a direct supervisor",
          detail:
            "Payroll approval routes through this link. A tech without one cannot be paid.",
          href: "/settings/users",
        },
        // Found here rather than by a tech on site with a photo to file: a
        // bind mount takes the host directory's ownership, so a volume the
        // container cannot write to looks entirely normal until it matters.
        {
          done: uploads.ok,
          label: "Make the uploads volume writable",
          detail: uploads.ok
            ? ""
            : `Photos, signatures and exports cannot be saved. ${uploads.reason}`,
          href: "/settings",
        },
      ].filter((check) => !check.done)
    : [];

  // Monday to Sunday. weekEnd is the Monday after, so the label takes the last
  // day on the list — the week read "11/9 – 11/16" above seven days ending
  // on the 15th.
  const firstDay = zonedParts(weekStart, zone);
  const lastDay = zonedParts(new Date(weekEnd.getTime() - 12 * 3_600_000), zone);
  const weekLabel = `${firstDay.month}/${firstDay.day} – ${lastDay.month}/${lastDay.day}`;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">
            Welcome back, {user.name.split(" ")[0]}
          </h1>
          <p className="text-sm text-muted-foreground">
            {scheduled.length === 0
              ? "Nothing on the books this week."
              : `${scheduled.length} job${scheduled.length === 1 ? "" : "s"} this week.`}
          </p>
        </div>
        {can(user, "job.create") ? (
          <Link href="/jobs/new" className={buttonVariants({ size: "sm" })}>
            <Plus /> New job
          </Link>
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>This week</CardTitle>
          <CardDescription className="tabular">{weekLabel}</CardDescription>
        </CardHeader>
        <CardContent>
          {/* Their own name is left off their own jobs — but only for somebody
              who sees just their own. On a manager's week every name counts. */}
          <WeekSchedule
            days={days}
            selfName={
              permissionScope(user, "job.view") === "OWN" ? user.name : undefined
            }
          />
        </CardContent>
      </Card>

      {/* One column that may be narrower than what is in it. Left to size
          itself, the column grew to fit the longest project line unbroken —
          wider than a small phone, so the whole dashboard scrolled sideways,
          and on a larger one these two cards stuck out past the rest. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Inbox className="size-4 text-primary" />
              Waiting on you
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {waiting.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing is waiting on you.
              </p>
            ) : (
              waiting.map((row) => (
                <Link
                  key={row.label}
                  href={row.href}
                  className="flex items-center gap-3 rounded-lg border border-border p-2 text-sm hover:bg-muted"
                >
                  <span className="flex-1">{row.label}</span>
                  <Badge variant="warning">{row.count}</Badge>
                </Link>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Layers className="size-4 text-primary" />
              Your projects
            </CardTitle>
            <CardDescription>
              The ones you run or are a member of.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {projects.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                You are not on any active project.
              </p>
            ) : (
              projects.map((project) => (
                <Link
                  key={project.id}
                  href={`/projects/${project.id}`}
                  className="flex items-center gap-3 rounded-lg border border-border p-2 hover:bg-muted"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {project.name}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {project.code} · {project.client.name}
                    </span>
                  </span>
                  {project.manager?.id === user.id ? (
                    <Badge variant="primary">PM</Badge>
                  ) : null}
                  <span className="tabular shrink-0 text-xs text-muted-foreground">
                    {project.jobs.length}/{project._count.jobs} open
                  </span>
                </Link>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {setupChecks.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Setup</CardTitle>
            <CardDescription>
              Worth finishing before the first real job goes in.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {setupChecks.map((check) => (
              <Link
                key={check.label}
                href={check.href}
                className="flex items-start gap-3 text-sm"
              >
                <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
                <span>
                  {check.label}
                  <span className="block text-xs text-muted-foreground">
                    {check.detail}
                  </span>
                </span>
              </Link>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {supervisor ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CircleCheck className="size-4 text-primary" />
              Your supervisor
            </CardTitle>
            <CardDescription>
              Always the first entry in a job&rsquo;s dispatch block.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="flex items-center gap-2.5 font-medium">
              <Avatar src={supervisor.picture} name={supervisor.name} size={32} />
              {supervisor.name}
            </span>
            {supervisor.phone ? (
              <a
                href={telHref(supervisor.phone)}
                className="text-primary underline-offset-4 hover:underline"
              >
                {formatPhone(supervisor.phone)}
              </a>
            ) : null}
            {supervisor.email ? (
              <a
                href={`mailto:${supervisor.email}`}
                className="truncate text-primary underline-offset-4 hover:underline"
              >
                {supervisor.email}
              </a>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
