import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { getCompanySettings } from "@/lib/company";
import {
  isoDateInZone,
  parseZonedDate,
  startOfWeekMonday,
} from "@/lib/datetime";
import { db } from "@/lib/db";
import { dayLabel, hours, money, shortDate, weekSpan } from "@/lib/pay-format";
import {
  isoWeek,
  loadPayWeek,
  PAY_STAGE_LABEL,
  type PayStage,
} from "@/lib/pay-period";
import { reportIds } from "@/lib/scope";
import { getSessionUser, permissionScope } from "@/lib/session";
import { PeriodPanel } from "./period-panel";

export const metadata = { title: "Payroll" };

const STAGE_VARIANT: Record<PayStage, "primary" | "warning" | "success" | "neutral"> =
  {
    recorded: "primary",
    review: "warning",
    approved: "success",
    paid: "neutral",
  };

/**
 * One person's week: what it is made of, and the decisions somebody has to make
 * about it.
 *
 * Approving is the point of the screen, so it is the first control on it rather
 * than three cards down — the old layout put the week's total, then its lines,
 * then the button that mattered.
 */
export default async function PayrollPersonPage({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{ week?: string }>;
}) {
  const viewer = await getSessionUser();
  if (!viewer) redirect("/signin");

  const scope = permissionScope(viewer, "payroll.view");
  if (!scope || scope === "OWN") redirect("/pay");

  const { userId } = await params;
  const query = await searchParams;

  const visibleIds =
    scope === "ALL" ? null : [viewer.id, ...(await reportIds(viewer.id))];
  if (visibleIds !== null && !visibleIds.includes(userId)) notFound();

  const company = await getCompanySettings();
  const zone = company.defaultTimeZone;
  const now = new Date();

  const anchor = query.week ? parseZonedDate(query.week, zone) : null;
  const weekStart = startOfWeekMonday(anchor ?? now, zone);
  const weekKey = isoDateInZone(weekStart, zone);

  const [subject, clock, period] = await Promise.all([
    db.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, directSupervisorId: true },
    }),
    loadPayWeek({
      userId,
      weekStart,
      timeZone: zone,
      payLagWeeks: company.payLagWeeks,
      now,
    }),
    db.payrollPeriod.findUnique({
      where: { userId_weekStart: { userId, weekStart } },
      select: {
        id: true,
        status: true,
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
                job: {
                  select: {
                    id: true,
                    title: true,
                    intWoId: true,
                    scheduledStart: true,
                  },
                },
              },
            },
          },
        },
      },
    }),
  ]);

  if (!subject) notFound();

  // Approving is the direct supervisor's job; a manager may step in, and that
  // is recorded rather than hidden.
  const isDirectSupervisor = subject.directSupervisorId === viewer.id;
  const approveScope = permissionScope(viewer, "payroll.approve");
  const canApprove =
    Boolean(approveScope) && (isDirectSupervisor || approveScope === "ALL");

  const runScope = permissionScope(viewer, "payroll.run");
  const canRun =
    Boolean(runScope) && (runScope === "ALL" || isDirectSupervisor);

  const receivedScope = permissionScope(viewer, "payroll.mark_received");
  const canMarkReceived =
    Boolean(receivedScope) &&
    (receivedScope === "ALL" || isDirectSupervisor || subject.id === viewer.id);

  const stage = clock.state.stage;
  const week = isoWeek(weekStart, zone);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <div className="flex items-center gap-2.5">
        <Link
          href={`/payroll?week=${weekKey}`}
          aria-label="Back"
          className="flex size-11 shrink-0 items-center justify-center rounded-[0.625rem] border border-border bg-surface text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
        </Link>
        <div className="flex min-w-0 flex-1 flex-col gap-px">
          <div className="text-base font-semibold">{subject.name}</div>
          <div className="text-xs tabular-nums text-muted-foreground">
            W{week} · {weekSpan(clock.start, clock.end, zone)}
          </div>
        </div>
        <Badge variant={STAGE_VARIANT[stage]}>
          {stage === "recorded" ? "Not built" : PAY_STAGE_LABEL[stage]}
        </Badge>
      </div>

      <PeriodPanel
        subjectId={subject.id}
        subjectName={subject.name}
        week={weekKey}
        clock={{
          jobs: clock.jobs.map((job) => ({
            assignmentId: job.assignmentId,
            jobId: job.jobId,
            title: job.title,
            intWoId: job.intWoId,
            customer: job.customer,
            day: dayLabel(job.clockInAt, zone),
            hours: hours(job.paidMinutes),
            payType: job.payType,
            payRate: job.payRate,
            earned: money(job.earnedCents),
            reimbursements: job.reimbursements.map((one) => ({
              label: one.label,
              amount: money(one.cents),
            })),
          })),
          earned: money(clock.totals.earnedCents),
          reimbursed: money(clock.totals.reimbursedCents),
          total: money(clock.totals.earnedCents + clock.totals.reimbursedCents),
          paidHours: hours(clock.totals.paidMinutes),
          expectedPayDate: clock.state.expectedPayDate
            ? shortDate(clock.state.expectedPayDate, zone)
            : null,
        }}
        period={
          period
            ? {
                id: period.id,
                status: period.status,
                expectedAmount: period.expectedAmount.toString(),
                receivedAmount: period.receivedAmount?.toString() ?? null,
                receivedDate: period.receivedDate
                  ? isoDateInZone(period.receivedDate, zone)
                  : null,
                expectedPayDate: period.expectedPayDate
                  ? shortDate(period.expectedPayDate, zone)
                  : null,
                note: period.note,
                approvedBy: period.approvedBy?.name ?? null,
                approvedOn: period.approvedAt
                  ? shortDate(period.approvedAt, zone)
                  : null,
                approvedAsFallback: period.approvedAsFallback,
                supervisorName: period.supervisor?.name ?? null,
              }
            : null
        }
        lines={(period?.lines ?? []).map((line) => ({
          id: line.id,
          jobId: line.assignment.job.id,
          title: line.assignment.job.title,
          intWoId: line.assignment.job.intWoId,
          day: line.assignment.job.scheduledStart
            ? dayLabel(line.assignment.job.scheduledStart, zone)
            : null,
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
        canRun={canRun}
        canMarkReceived={canMarkReceived}
        isDirectSupervisor={isDirectSupervisor}
      />
    </div>
  );
}
