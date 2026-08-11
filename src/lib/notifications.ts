import { db } from "@/lib/db";

/**
 * Things that happened to somebody, as opposed to things they must decide.
 *
 * Being put on a job, taken off one, or handed a project is not an approval —
 * there is nothing to accept or reject — but it is also not something to find
 * out about by noticing your schedule changed. So it is delivered, and waits
 * for an acknowledgement, which is what makes "they were told" a fact rather
 * than an assumption.
 *
 * Nobody is notified about their own doing: the person who pressed the button
 * knows.
 */

export const NOTIFICATION_KINDS = {
  job_assigned: "Assigned to a job",
  job_unassigned: "Taken off a job",
  job_lead: "Made lead on a job",
  project_pm: "Project coordinator changed",
  project_manager: "Made project manager",
  // Not a decision for them either: it is the answer to one they have been
  // waiting on, and nothing else tells a tech their week can now be run.
  report_approved: "Report approved",
} as const;

export type NotificationKind = keyof typeof NOTIFICATION_KINDS;

export async function notify(input: {
  userId: string;
  actorId: string | null;
  kind: NotificationKind;
  title: string;
  body?: string | null;
  href?: string | null;
  jobId?: string | null;
  projectId?: string | null;
}): Promise<void> {
  if (input.userId === input.actorId) return;

  try {
    await db.notification.create({
      data: {
        userId: input.userId,
        actorId: input.actorId,
        kind: input.kind,
        title: input.title,
        body: input.body ?? null,
        href: input.href ?? null,
        jobId: input.jobId ?? null,
        projectId: input.projectId ?? null,
      },
    });
  } catch (error) {
    // A notification is never the point of the operation it accompanies.
    // Losing one must not roll back an assignment that otherwise succeeded.
    console.error("[notify] could not record notification:", error);
  }
}

/** Everyone who should hear about a job: the crew and their supervisors. */
export async function jobAudience(jobId: string): Promise<string[]> {
  const assignments = await db.jobAssignment.findMany({
    where: { jobId },
    select: { userId: true, supervisorId: true },
  });

  const ids = new Set<string>();
  for (const assignment of assignments) {
    ids.add(assignment.userId);
    if (assignment.supervisorId) ids.add(assignment.supervisorId);
  }
  return [...ids];
}

export async function unacknowledgedCount(userId: string): Promise<number> {
  return db.notification.count({
    where: { userId, acknowledgedAt: null },
  });
}
