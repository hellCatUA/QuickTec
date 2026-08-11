import { redirect, notFound } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { getCompanySettings } from "@/lib/company";
import {
  toDatetimeLocalInZone,
  usDateTimeInZone,
  usTimeInZone,
} from "@/lib/datetime";
import { db } from "@/lib/db";
import { LATE_START_MINUTES } from "@/lib/job-review";
import { canOnJob } from "@/lib/scope";
import { getSessionUser, permissionScope } from "@/lib/session";
import { JobPay } from "../job-pay";
import { Punches, type Punch } from "./punches";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const job = await db.job.findUnique({
    where: { id },
    select: { title: true },
  });
  return { title: job ? `${job.title} — Manager Portal` : "Manager Portal" };
}

/**
 * The things done to a job rather than on it.
 *
 * A page, not a sheet over the job. On a phone the overlay scrolled the page
 * behind it as often as itself, and what it held — somebody's whole day, and
 * what the job pays — is not glanceable anyway. A page also means the browser's
 * Back means what it says.
 */
export default async function ManagePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/signin");

  const { id } = await params;

  const job = await db.job.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      intWoId: true,
      scheduledStart: true,
      estimateMinutes: true,
      createdById: true,
      projectId: true,
      payType: true,
      payRate: true,
      travelReimbursement: true,
      site: { select: { timeZone: true } },
      project: { select: { managerId: true } },
      assignments: {
        orderBy: { isLead: "desc" },
        select: {
          id: true,
          isLead: true,
          supervisorId: true,
          user: { select: { id: true, name: true, directSupervisorId: true } },
          visits: {
            orderBy: { clockInAt: "asc" },
            select: {
              id: true,
              clockInAt: true,
              clockOutAt: true,
              breaks: {
                orderBy: { startAt: "asc" },
                select: { startAt: true, endAt: true, paid: true },
              },
            },
          },
        },
      },
    },
  });
  if (!job) notFound();

  const jobRef = {
    projectId: job.projectId,
    assigneeIds: job.assignments.map((assignment) => assignment.user.id),
    createdById: job.createdById,
  };

  if (!(await canOnJob(user, "job.view", jobRef))) notFound();

  const [canAdjustTime, canEditPlanned, canEditRates] = await Promise.all([
    canOnJob(user, "job.adjust_time", jobRef),
    canOnJob(user, "job.edit_planned_fields", jobRef),
    canOnJob(user, "pay.edit_rates", jobRef),
  ]);

  const company = await getCompanySettings();
  const zone = job.site.timeZone ?? company.defaultTimeZone;

  const isLead = job.assignments.some(
    (assignment) => assignment.user.id === user.id && assignment.isLead,
  );
  const isProjectManager = job.project?.managerId === user.id;
  const managerEverywhere = permissionScope(user, "job.adjust_time") === "ALL";

  /** Whoever this person's time is charged to, which is not a job-wide fact. */
  function paysFor(assignment: {
    supervisorId: string | null;
    user: { directSupervisorId: string | null };
  }): boolean {
    return (
      managerEverywhere ||
      isProjectManager ||
      assignment.supervisorId === user!.id ||
      assignment.user.directSupervisorId === user!.id
    );
  }

  const canSeePunches =
    canAdjustTime &&
    (canEditPlanned ||
      isLead ||
      job.assignments.some((assignment) => paysFor(assignment)));

  const canSetPay =
    canEditRates &&
    (isProjectManager ||
      job.createdById === user.id ||
      job.assignments.some((assignment) => paysFor(assignment)));

  if (!canSeePunches && !canSetPay) notFound();

  // When the job was due to finish, which is what "over estimate" means.
  const dueOut =
    job.scheduledStart && job.estimateMinutes
      ? new Date(job.scheduledStart.getTime() + job.estimateMinutes * 60_000)
      : null;

  const punches: Punch[] = job.assignments.map((assignment) => {
    const visit = assignment.visits[0] ?? null;
    const mayRemove = paysFor(assignment);

    const late =
      visit && job.scheduledStart
        ? Math.round(
            (visit.clockInAt.getTime() - job.scheduledStart.getTime()) / 60_000,
          )
        : null;

    const breaks = (visit?.breaks ?? []).map((entry) => {
      const minutes = entry.endAt
        ? Math.round((entry.endAt.getTime() - entry.startAt.getTime()) / 60_000)
        : 0;
      return {
        text: `${usTimeInZone(entry.startAt, zone)} – ${
          entry.endAt ? usTimeInZone(entry.endAt, zone) : "still on break"
        } · ${minutes} min`,
        minutes,
        paid: entry.paid,
      };
    });

    const totalBreak = breaks.reduce((sum, entry) => sum + entry.minutes, 0);

    return {
      assignmentId: assignment.id,
      who: assignment.user.name,
      visitId: visit?.id ?? null,
      clockIn: visit
        ? {
            value: toDatetimeLocalInZone(visit.clockInAt, zone),
            text: usDateTimeInZone(visit.clockInAt, zone),
          }
        : null,
      clockOut: visit?.clockOutAt
        ? {
            value: toDatetimeLocalInZone(visit.clockOutAt, zone),
            text: usDateTimeInZone(visit.clockOutAt, zone),
          }
        : null,
      breaks,
      breakTotal:
        breaks.length === 0
          ? null
          : breaks.length === 1
            ? breaks[0].text.split(" · ")[1]
            : `${totalBreak} min total`,
      late:
        late !== null && late >= LATE_START_MINUTES
          ? `${late} minutes after the scheduled start of ${usTimeInZone(
              job.scheduledStart!,
              zone,
            )}.`
          : null,
      over:
        visit?.clockOutAt && dueOut && visit.clockOutAt > dueOut
          ? `Past the estimated finish of ${usTimeInZone(dueOut, zone)}.`
          : null,
      canEdit: canAdjustTime,
      canRemove: mayRemove,
      canAdd: mayRemove,
    };
  });

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <PageHeader
        title={`${job.title} — Manager Portal`}
        backHref={`/jobs/${job.id}`}
        description={job.intWoId}
      />

      {canSeePunches ? (
        <Card>
          <CardHeader>
            <CardTitle>TimeClock Punches</CardTitle>
          </CardHeader>
          <CardContent>
            <Punches punches={punches} />
          </CardContent>
        </Card>
      ) : null}

      {canSetPay ? (
        <Card>
          <CardHeader>
            <CardTitle>Pay</CardTitle>
            <CardDescription>
              What this job pays, for everybody on it. Normally inherited from
              the tech, the project or the company — set it here when this job is
              none of those.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <JobPay
              jobId={job.id}
              canEdit={canSetPay}
              payType={job.payType ?? "HOURLY"}
              payRate={job.payRate?.toString() ?? ""}
              travelReimbursement={job.travelReimbursement?.toString() ?? null}
              note={
                job.payType
                  ? "Applies to everybody on this job, including anybody added later. Somebody put on their own rate keeps it."
                  : "Not set — everybody keeps their own rate, or the project's default where they have none."
              }
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
