import { getCompanySettings } from "@/lib/company";
import {
  decimalHours,
  toDatetimeLocalInZone,
  usDateInZone,
  usDateTimeInZone,
  usTimeInZone,
} from "@/lib/datetime";
import { db } from "@/lib/db";
import { LATE_START_MINUTES } from "@/lib/job-review";
import { buildPunchHistory, type PunchHistoryRow } from "@/lib/punch-history";
import { canOnJob } from "@/lib/scope";
import { getSessionUser, permissionScope } from "@/lib/session";

/**
 * Everybody's day on one job, ready to be shown and corrected.
 *
 * Lifted out of the Manager Portal because the review needs the same thing.
 * A reviewer told a clock-out is wrong and sent somewhere else to fix it comes
 * back to a read-through that has started again from the top — so the block
 * they would have gone to is put in front of them instead, the same one, with
 * the same history and the same buttons.
 */

/** A time as the picker wants it and as a person reads it. */
export type PunchClock = { value: string; text: string };

export type BreakRow = {
  text: string;
  minutes: number;
  paid: boolean;
  /** Datetime-local, so the same row can be handed to the editor. */
  startValue: string;
  endValue: string;
};

export type Punch = {
  assignmentId: string;
  who: string;
  /** Null when this person never clocked in. */
  visitId: string | null;
  clockIn: PunchClock | null;
  clockOut: PunchClock | null;
  breaks: BreakRow[];
  breakTotal: string | null;
  /** "Lead", or nothing — everybody else on a job is a tech. */
  role: string | null;
  /** What the day came to, paid time only. Null when they never clocked in. */
  shift: string | null;
  /** Written by hand rather than pressed on site. */
  manual: boolean;
  /** Set when they arrived well after the job was due to start. */
  late: string | null;
  /** Set when they worked past the estimate. */
  over: string | null;
  /** A reviewer has looked at that flag and accepted it, so it stops shouting. */
  lateAccepted: boolean;
  overAccepted: boolean;
  canEdit: boolean;
  canRemove: boolean;
  canAdd: boolean;
  /** Accepting a flag is part of signing the job off. */
  canAccept: boolean;
  history: PunchHistoryRow[];
};

export type PunchBlocks = {
  punches: Punch[];
  companyName: string;
  /** Whether this person may be shown the crew's clocks at all. */
  visible: boolean;
  /** Whether they may set what the job pays, which travels with this view. */
  canSetPay: boolean;
};

type Actor = NonNullable<Awaited<ReturnType<typeof getSessionUser>>>;

export async function loadPunchBlocks(
  jobId: string,
  user: Actor,
): Promise<PunchBlocks | null> {
  const job = await db.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      scheduledStart: true,
      estimateMinutes: true,
      createdById: true,
      projectId: true,
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
              addedManually: true,
              lateAcceptedAt: true,
              overAcceptedAt: true,
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
  if (!job) return null;

  const jobRef = {
    projectId: job.projectId,
    assigneeIds: job.assignments.map((assignment) => assignment.user.id),
    createdById: job.createdById,
  };

  if (!(await canOnJob(user, "job.view", jobRef))) return null;

  const [canAdjustTime, canEditPlanned, canEditRates, canApprove] =
    await Promise.all([
      canOnJob(user, "job.adjust_time", jobRef),
      canOnJob(user, "job.edit_planned_fields", jobRef),
      canOnJob(user, "pay.edit_rates", jobRef),
      canOnJob(user, "job.approve_report", jobRef),
    ]);

  // Whose block each recorded event belongs in.
  //
  // The history is the person's, not the visit's. Filing it under the visit
  // loses every event that outlives one: a removal is recorded about a row
  // that no longer exists, and a punch written to replace it starts a fresh
  // history with no trace of what happened to the first. The assignment is
  // what the block on the page is, and it is there from the day somebody is
  // put on the job to the day the job is closed.
  const blockOfEntity = new Map<string, string>();
  for (const assignment of job.assignments) {
    blockOfEntity.set(assignment.id, assignment.id);
    for (const visit of assignment.visits) {
      blockOfEntity.set(visit.id, assignment.id);
    }
  }

  // Everything that has happened to each punch, which is a question about the
  // punch rather than about the job — so it is read here and shown in the
  // block rather than sending somebody to the job's timeline to search.
  // Not filtered by entityType: a break records itself against the visit it
  // belongs to but calls itself a BreakPeriod, and a history missing every
  // break is not a history.
  const events = await db.auditEvent.findMany({
    where: {
      jobId: job.id,
      OR: [
        {
          entityId: {
            in: job.assignments.flatMap((assignment) =>
              assignment.visits.map((visit) => visit.id),
            ),
          },
        },
        // Recorded against the assignment: a removal, whose visit is gone, and
        // clock-ins from before that action learned to name the visit it had
        // just created. Named actions rather than everything, because a rate
        // change is filed against an assignment too and is not a punch event.
        {
          action: { in: ["clock_in", "time_removed"] },
          entityId: { in: job.assignments.map((assignment) => assignment.id) },
        },
      ],
    },
    // Newest first only so that a cap this generous drops the oldest rather
    // than the latest; the builder puts them back in the order they happened.
    // The cap covers the whole crew, so it is set for a job several people
    // have argued over rather than for one punch.
    orderBy: { createdAt: "desc" },
    take: 500,
    select: {
      id: true,
      entityId: true,
      action: true,
      detail: true,
      createdAt: true,
      actor: { select: { name: true } },
    },
  });

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
      assignment.supervisorId === user.id ||
      assignment.user.directSupervisorId === user.id
    );
  }

  const visible =
    canAdjustTime &&
    (canEditPlanned ||
      isLead ||
      job.assignments.some((assignment) => paysFor(assignment)));

  const canSetPay =
    canEditRates &&
    (isProjectManager ||
      job.createdById === user.id ||
      job.assignments.some((assignment) => paysFor(assignment)));

  // The estimate is how long the work takes, not what time it ends.
  //
  // This used to be read as a wall clock — scheduled start plus the estimate —
  // so a crew that turned up two hours early was over estimate before it had
  // done anything, and one that started two hours late got two free hours. In
  // the field the start is early as often as it is late, so the number was
  // wrong in both directions and never about the work.
  //
  // Measured against what each person actually worked instead, which is the
  // same basis the approval step uses and the same figure shown beside their
  // name — so the two numbers on screen are about the same thing.
  const estimate =
    job.estimateMinutes && job.estimateMinutes > 0 ? job.estimateMinutes : null;

  const punches: Punch[] = job.assignments.map((assignment) => {
    const visit = assignment.visits[0] ?? null;
    const mayRemove = paysFor(assignment);

    /** The day this punch is about, against which times are read. */
    const day = visit
      ? usDateInZone(visit.clockInAt, zone)
      : job.scheduledStart
        ? usDateInZone(job.scheduledStart, zone)
        : null;

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
        startValue: toDatetimeLocalInZone(entry.startAt, zone),
        endValue: entry.endAt ? toDatetimeLocalInZone(entry.endAt, zone) : "",
      };
    });

    const totalBreak = breaks.reduce((sum, entry) => sum + entry.minutes, 0);

    /**
     * What this person actually worked: clock to clock, less the breaks they
     * are not paid for. Null while they are still on site, because a day that
     * has not finished cannot be over anything yet.
     */
    const workedMinutes = visit?.clockOutAt
      ? Math.round(
          (visit.clockOutAt.getTime() - visit.clockInAt.getTime()) / 60_000,
        ) -
        breaks.reduce((sum, entry) => sum + (entry.paid ? 0 : entry.minutes), 0)
      : null;

    const history = buildPunchHistory(
      events
        .filter((event) => blockOfEntity.get(event.entityId) === assignment.id)
        .map((event) => ({
          id: event.id,
          action: event.action,
          createdAt: event.createdAt,
          actorName: event.actor?.name ?? null,
          detail: (event.detail ?? null) as Record<string, unknown> | null,
        })),
      {
        // A bare time is only unambiguous on the day the punch belongs to.
        // Anything recorded on another day — a clock corrected the following
        // morning, a punch merged from a second visit — reads as though it
        // happened out of order unless it says which day it was.
        time: (value) => {
          const at = value instanceof Date ? value : new Date(value);
          return day && usDateInZone(at, zone) === day
            ? usTimeInZone(at, zone)
            : usDateTimeInZone(at, zone);
        },
        minutes: (from, to) =>
          Math.round(
            ((to instanceof Date ? to : new Date(to)).getTime() -
              (from instanceof Date ? from : new Date(from)).getTime()) /
              60_000,
          ),
      },
    );

    return {
      assignmentId: assignment.id,
      who: assignment.user.name,
      visitId: visit?.id ?? null,
      manual: visit?.addedManually ?? false,
      lateAccepted:
        visit?.lateAcceptedAt !== null && visit?.lateAcceptedAt !== undefined,
      overAccepted:
        visit?.overAcceptedAt !== null && visit?.overAcceptedAt !== undefined,
      canAccept: canApprove && visit !== null,
      history,
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
        estimate !== null && workedMinutes !== null && workedMinutes > estimate
          ? `Past the scheduled estimate (+${decimalHours(
              workedMinutes - estimate,
            )} hrs).`
          : null,
      // The word beside the name. Everybody on a job is a tech; only one of
      // them owns the merged Work Performed, and that is worth seeing without
      // opening anything.
      role: assignment.isLead ? "Lead" : null,
      // What the day came to, paid time only — the number somebody is looking
      // for when they open this at all.
      shift:
        workedMinutes !== null
          ? `${decimalHours(workedMinutes)} hrs`
          : visit
            ? "on site"
            : null,
      canEdit: canAdjustTime,
      canRemove: mayRemove,
      canAdd: mayRemove,
    };
  });

  return { punches, companyName: company.name, visible, canSetPay };
}
