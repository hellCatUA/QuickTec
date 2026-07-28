import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/page-header";
import { getCompanySettings } from "@/lib/company";
import {
  isoDateInZone,
  parseZonedDate,
  startOfWeekMonday,
  usDateInZone,
} from "@/lib/datetime";
import { db } from "@/lib/db";
import { weekLabel, weekRange } from "@/lib/payroll";
import { reportIds } from "@/lib/scope";
import { can, getSessionUser, permissionScope } from "@/lib/session";
import Link from "next/link";
import { PayPeriodPanel } from "./pay-period-panel";

export const metadata = { title: "Pay" };

/** Mondays going back from this week, for the selector. */
function recentWeeks(timeZone: string, count = 12): Date[] {
  const weeks: Date[] = [];
  const current = startOfWeekMonday(new Date(), timeZone);
  for (let index = 0; index < count; index++) {
    weeks.push(new Date(current.getTime() - index * 7 * 24 * 60 * 60_000));
  }
  return weeks;
}

export default async function PayPage({
  searchParams,
}: {
  searchParams: Promise<{ user?: string; week?: string }>;
}) {
  const viewer = await getSessionUser();
  if (!viewer) redirect("/signin");

  const viewScope = permissionScope(viewer, "payroll.view");
  if (!viewScope) redirect("/dashboard");

  const company = await getCompanySettings();
  const zone = company.defaultTimeZone;
  const params = await searchParams;

  const visibleIds =
    viewScope === "ALL"
      ? null
      : viewScope === "OWN"
        ? [viewer.id]
        : [viewer.id, ...(await reportIds(viewer.id))];

  const subjectId =
    params.user && (visibleIds === null || visibleIds.includes(params.user))
      ? params.user
      : viewer.id;

  // Parsed as a calendar date in the company zone: the plain Date constructor
  // would read it as UTC midnight and land a week early on the US west coast.
  const anchor = params.week ? parseZonedDate(params.week, zone) : null;
  const week = weekRange(anchor ?? new Date(), zone);

  const [subject, period, team] = await Promise.all([
    db.user.findUniqueOrThrow({
      where: { id: subjectId },
      select: { id: true, name: true, directSupervisorId: true },
    }),
    db.payrollPeriod.findUnique({
      where: { userId_weekStart: { userId: subjectId, weekStart: week.start } },
      select: {
        id: true,
        status: true,
        weekStart: true,
        weekEnd: true,
        expectedAmount: true,
        receivedAmount: true,
        receivedDate: true,
        expectedPayDate: true,
        note: true,
        approvedAsFallback: true,
        approvedAt: true,
        approvedBy: { select: { name: true } },
        supervisor: { select: { name: true } },
        lines: {
          orderBy: { assignment: { job: { scheduledStart: "asc" } } },
          select: {
            id: true,
            payType: true,
            payRate: true,
            paidMinutes: true,
            laborAmount: true,
            travelReimb: true,
            parkingTollsReimb: true,
            hotelReimb: true,
            materialsReimb: true,
            totalExpected: true,
            overrideAmount: true,
            overrideNote: true,
            receivedAmount: true,
            receivedDate: true,
            payStatus: true,
            payNote: true,
            assignment: {
              select: {
                job: { select: { id: true, title: true, intWoId: true } },
              },
            },
          },
        },
      },
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
  ]);

  const isOwn = subject.id === viewer.id;
  const weekParam = isoDateInZone(week.start, zone);

  // Approving is the direct supervisor's job; a manager may step in, and that
  // is recorded rather than hidden.
  const isDirectSupervisor = subject.directSupervisorId === viewer.id;
  const approveScope = permissionScope(viewer, "payroll.approve");
  const canApprove =
    Boolean(approveScope) && (isDirectSupervisor || approveScope === "ALL");

  const runScope = permissionScope(viewer, "payroll.run");
  const canRun =
    Boolean(runScope) &&
    (runScope === "ALL" || isDirectSupervisor || (runScope === "OWN" && isOwn));

  const receivedScope = permissionScope(viewer, "payroll.mark_received");
  const canMarkReceived =
    Boolean(receivedScope) &&
    (receivedScope === "ALL" || isOwn || isDirectSupervisor);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <PageHeader
        title="Pay"
        description={`Weeks run Monday to Sunday. Payment is expected about ${company.payLagWeeks} weeks after a week closes.`}
        actions={
          <div className="flex gap-2">
            <Link href={`/pay/stats?user=${params.user ?? ""}`}>
              <Button type="button" size="sm" variant="secondary">
                Stats
              </Button>
            </Link>
            {can(viewer, "pay.edit_rates") ? (
              <Link href="/pay/rates">
                <Button type="button" size="sm" variant="secondary">
                  Rates
                </Button>
              </Link>
            ) : null}
          </div>
        }
      />

      {team.length > 1 ? (
        <div className="flex flex-wrap gap-1.5">
          {team.map((person) => (
            <Link
              key={person.id}
              href={`/pay?user=${person.id}&week=${weekParam}`}
            >
              <Badge variant={person.id === subjectId ? "primary" : "neutral"}>
                {person.id === viewer.id ? "You" : person.name}
              </Badge>
            </Link>
          ))}
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <div className="flex gap-1.5">
          {recentWeeks(zone).map((monday) => {
            const key = isoDateInZone(monday, zone);
            return (
              <Link key={key} href={`/pay?user=${subjectId}&week=${key}`}>
                <Badge variant={key === weekParam ? "primary" : "neutral"}>
                  {usDateInZone(monday, zone).slice(0, 5)}
                </Badge>
              </Link>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">
          {isOwn ? "Your pay" : subject.name} · {weekLabel(week.start, zone)}
        </span>

        {can(viewer, "export.pay") ? (
          <div className="ml-auto flex gap-2">
            <a href={`/api/pay/export?week=${weekParam}&user=${subjectId}`}>
              <Button type="button" size="sm" variant="secondary">
                Week .xlsx
              </Button>
            </a>
            <a
              href={`/api/pay/export?month=${weekParam.slice(0, 7)}&user=${subjectId}`}
            >
              <Button type="button" size="sm" variant="secondary">
                Month .xlsx
              </Button>
            </a>
          </div>
        ) : null}
      </div>

      {period ? (
        <PayPeriodPanel
          period={{
            id: period.id,
            status: period.status,
            expectedAmount: period.expectedAmount.toString(),
            receivedAmount: period.receivedAmount?.toString() ?? null,
            receivedDate: period.receivedDate
              ? isoDateInZone(period.receivedDate, zone)
              : null,
            expectedPayDate: period.expectedPayDate
              ? usDateInZone(period.expectedPayDate, zone)
              : null,
            note: period.note,
            approvedBy: period.approvedBy?.name ?? null,
            approvedAsFallback: period.approvedAsFallback,
            supervisorName: period.supervisor?.name ?? null,
          }}
          lines={period.lines.map((line) => ({
            id: line.id,
            jobId: line.assignment.job.id,
            title: line.assignment.job.title,
            intWoId: line.assignment.job.intWoId,
            payType: line.payType,
            payRate: line.payRate.toString(),
            paidMinutes: line.paidMinutes,
            laborAmount: line.laborAmount.toString(),
            travelReimb: line.travelReimb.toString(),
            parkingTollsReimb: line.parkingTollsReimb.toString(),
            hotelReimb: line.hotelReimb.toString(),
            materialsReimb: line.materialsReimb.toString(),
            totalExpected: line.totalExpected.toString(),
            overrideAmount: line.overrideAmount?.toString() ?? null,
            overrideNote: line.overrideNote,
            receivedAmount: line.receivedAmount?.toString() ?? null,
            receivedDate: line.receivedDate
              ? isoDateInZone(line.receivedDate, zone)
              : null,
            payStatus: line.payStatus,
            payNote: line.payNote,
          }))}
          canApprove={canApprove}
          canOverride={canRun}
          canMarkReceived={canMarkReceived}
          isDirectSupervisor={isDirectSupervisor}
        />
      ) : (
        <EmptyState
          title="No payroll built for this week"
          description={
            canRun
              ? "Building a week gathers every job with a clock-in inside it."
              : "Your supervisor builds the week once the work is done."
          }
        >
          {canRun ? (
            <form
              action={async (formData: FormData) => {
                "use server";
                const { runPayroll } = await import("./actions");
                await runPayroll(formData);
              }}
              className="mt-3"
            >
              <input type="hidden" name="userId" value={subjectId} />
              <input type="hidden" name="week" value={weekParam} />
              <Button type="submit" size="sm">
                Build this week
              </Button>
            </form>
          ) : null}
        </EmptyState>
      )}

      {period && canRun ? (
        <form
          action={async (formData: FormData) => {
            "use server";
            const { runPayroll } = await import("./actions");
            await runPayroll(formData);
          }}
        >
          <input type="hidden" name="userId" value={subjectId} />
          <input type="hidden" name="week" value={weekParam} />
          <Button type="submit" size="sm" variant="ghost">
            Rebuild from current time records
          </Button>
        </form>
      ) : null}

      <Card>
        <CardContent className="text-xs text-muted-foreground">
          Rebuilding recalculates hours and reimbursements from the time
          records. Overrides, received amounts and notes are decisions someone
          made, so they are left alone.
        </CardContent>
      </Card>
    </div>
  );
}
