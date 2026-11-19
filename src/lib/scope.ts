import { db } from "@/lib/db";
import type { Permission } from "@/lib/permissions";
import { getSessionUser, permissionScope, type SessionUser } from "@/lib/session";
import { canSupervise } from "@/lib/supervisors";
import type { BaseRole, Prisma } from "@prisma-client";

/**
 * Turns a permission's scope into a Prisma filter.
 *
 * Every list query goes through here rather than filtering in the page, so
 * "what can this person see" has exactly one implementation to get right.
 * A null result means no access at all — callers must not fall back to an
 * empty filter, which would show everything.
 */

export async function reportIds(user: { id: string; baseRole: BaseRole }): Promise<string[]> {
  // Only while their role still supervises. The link stays on their old
  // reports' records after a demotion, and a Supervisor with one left over
  // still opened those techs' jobs, mileage and pay — though the profile
  // code, which asked the same question, already refused them.
  if (!canSupervise(user.baseRole)) return [];
  const reports = await db.user.findMany({
    where: { directSupervisorId: user.id },
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
    const ids = await reportIds(user);
    if (ids.length > 0) {
      clauses.push({ assignments: { some: { userId: { in: ids } } } });
      // A tech cannot assign anyone, so the ad-hoc job they just raised has no
      // crew yet. Without this their supervisor never sees the thing they are
      // meant to approve.
      clauses.push({ createdById: { in: ids } });
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
    const ids = await reportIds(user);
    if (job.assigneeIds.some((assignee) => ids.includes(assignee))) return true;
    if (ids.includes(job.createdById)) return true;
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

/**
 * Whether the user may exercise a permission on one specific project.
 *
 * PROJECT scope reaches the projects somebody runs or supervises, not every
 * project there is. Checking the permission alone allowed exactly that: a
 * supervisor could open any project's settings, change who pays for it, and
 * add themselves as a member — which then widened what jobs they could see.
 */
export function canOnProject(
  user: SessionUser,
  permission: Permission,
  projectId: string,
): boolean {
  const scope = permissionScope(user, permission, projectId);
  if (!scope) return false;
  if (scope === "ALL") return true;
  // Granted on this project by name.
  if (user.projectGrants.get(permission)?.has(projectId)) return true;
  return scope === "PROJECT" && user.scopedProjectIds.includes(projectId);
}

/**
 * A job's title and number for the browser tab, only for somebody who may
 * open the job. The tab's title is worked out apart from the page, and read
 * the job with no check at all: the "not found" page somebody got for a job
 * that was not theirs still carried its title and number in the tab.
 */
export async function viewableJobTitle(
  id: string,
): Promise<{ title: string; intWoId: string } | null> {
  const user = await getSessionUser();
  if (!user) return null;
  const job = await db.job.findUnique({
    where: { id },
    select: {
      title: true,
      intWoId: true,
      projectId: true,
      createdById: true,
      assignments: { select: { userId: true } },
    },
  });
  if (!job) return null;
  const allowed = await canOnJob(user, "job.view", {
    projectId: job.projectId,
    assigneeIds: job.assignments.map((assignment) => assignment.userId),
    createdById: job.createdById,
  });
  return allowed ? { title: job.title, intWoId: job.intWoId } : null;
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
