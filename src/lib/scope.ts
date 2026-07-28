import { db } from "@/lib/db";
import type { Permission } from "@/lib/permissions";
import { permissionScope, type SessionUser } from "@/lib/session";
import type { Prisma } from "@prisma-client";

/**
 * Turns a permission's scope into a Prisma filter.
 *
 * Every list query goes through here rather than filtering in the page, so
 * "what can this person see" has exactly one implementation to get right.
 * A null result means no access at all — callers must not fall back to an
 * empty filter, which would show everything.
 */

export async function reportIds(userId: string): Promise<string[]> {
  const reports = await db.user.findMany({
    where: { directSupervisorId: userId },
    select: { id: true },
  });
  return reports.map((report) => report.id);
}

export async function jobScopeWhere(
  user: SessionUser,
  permission: Permission = "job.view",
): Promise<Prisma.JobWhereInput | null> {
  const scope = permissionScope(user, permission);
  if (!scope) return null;
  if (scope === "ALL") return {};

  // Creators keep sight of what they raised even before anyone is assigned,
  // otherwise a tech's ad-hoc job vanishes the moment they save it.
  const clauses: Prisma.JobWhereInput[] = [
    { assignments: { some: { userId: user.id } } },
    { createdById: user.id },
  ];

  if (scope === "REPORTS" || scope === "PROJECT") {
    const ids = await reportIds(user.id);
    if (ids.length > 0) {
      clauses.push({ assignments: { some: { userId: { in: ids } } } });
    }
  }

  if (scope === "PROJECT" && user.scopedProjectIds.length > 0) {
    clauses.push({ projectId: { in: user.scopedProjectIds } });
  }

  return { OR: clauses };
}

/**
 * Whether the user may exercise a permission on one specific job.
 * Takes the job's project and assignee list rather than re-querying, so page
 * code can check several permissions off a single load.
 */
export async function canOnJob(
  user: SessionUser,
  permission: Permission,
  job: { projectId: string | null; assigneeIds: string[]; createdById: string },
): Promise<boolean> {
  const scope = permissionScope(user, permission, job.projectId);
  if (!scope) return false;
  if (scope === "ALL") return true;

  if (job.assigneeIds.includes(user.id) || job.createdById === user.id) {
    return true;
  }

  if (scope === "REPORTS" || scope === "PROJECT") {
    const ids = await reportIds(user.id);
    if (job.assigneeIds.some((assignee) => ids.includes(assignee))) return true;
  }

  if (
    scope === "PROJECT" &&
    job.projectId &&
    user.scopedProjectIds.includes(job.projectId)
  ) {
    return true;
  }

  return false;
}

/** Same shape, for records owned by a single user (mileage, payroll). */
export async function userScopeWhere(
  user: SessionUser,
  permission: Permission,
): Promise<{ userId: string | { in: string[] } } | Record<string, never> | null> {
  const scope = permissionScope(user, permission);
  if (!scope) return null;
  if (scope === "ALL") return {};
  if (scope === "OWN") return { userId: user.id };

  const ids = new Set([user.id, ...(await reportIds(user.id))]);

  if (scope === "PROJECT" && user.scopedProjectIds.length > 0) {
    const members = await db.projectMember.findMany({
      where: { projectId: { in: user.scopedProjectIds } },
      select: { userId: true },
    });
    for (const member of members) ids.add(member.userId);
  }

  return { userId: { in: Array.from(ids) } };
}

/**
 * Who approves changes and statuses on a job.
 *
 * On a project, that is the project manager — they hold the context, and they
 * stay the primary approver even when the tech's own supervisor is also a
 * member. Off-project it falls back to the tech's direct supervisor.
 *
 * Note this is *not* who pays: payroll always follows User.directSupervisorId,
 * whatever project the work happened on.
 */
export async function resolveJobSupervisor(
  techId: string,
  projectId: string | null,
): Promise<string | null> {
  if (projectId) {
    const project = await db.project.findUnique({
      where: { id: projectId },
      select: { managerId: true },
    });
    if (project?.managerId) return project.managerId;
  }

  const tech = await db.user.findUnique({
    where: { id: techId },
    select: { directSupervisorId: true },
  });

  return tech?.directSupervisorId ?? null;
}
