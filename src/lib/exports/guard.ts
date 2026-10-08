import { db } from "@/lib/db";
import { loadJobForExport, type JobExportData } from "@/lib/exports/job-data";
import type { Permission } from "@/lib/permissions";
import { canOnJob } from "@/lib/scope";
import { getSessionUser, permissionScope, type SessionUser } from "@/lib/session";

/**
 * Loads a job for export only if the caller is allowed that export.
 *
 * Every export route funnels through here so the three of them cannot drift
 * apart on who may download what — and so a 404 is returned rather than a 403,
 * which would otherwise confirm the job exists to someone who cannot see it.
 */
export async function loadExportable(
  jobId: string,
  permission: Permission,
): Promise<JobExportData | null> {
  return (await loadExportableWithForms(jobId, permission))?.data ?? null;
}

/**
 * The same, with whose updated WM Form the caller may have: it says what each
 * tech is paid, so it follows who may see that — see wmFormAssignments.
 */
export async function loadExportableWithForms(
  jobId: string,
  permission: Permission,
): Promise<{ data: JobExportData; forms: string[]; own: string | null } | null> {
  const user = await getSessionUser();
  if (!user) return null;

  const job = await db.job.findUnique({
    where: { id: jobId },
    select: {
      projectId: true,
      createdById: true,
      // The lead first, so a form asked for without saying whose is theirs.
      assignments: { orderBy: { isLead: "desc" }, select: { id: true, userId: true } },
    },
  });
  if (!job) return null;

  const ref = {
    projectId: job.projectId,
    assigneeIds: job.assignments.map((assignment) => assignment.userId),
    createdById: job.createdById,
  };
  if (!(await canOnJob(user, permission, ref))) return null;

  const data = await loadJobForExport(jobId);
  if (!data) return null;
  return {
    data,
    forms: await wmFormAssignments(user, ref, job.assignments),
    own: job.assignments.find((assignment) => assignment.userId === user.id)?.id ?? null,
  };
}

/**
 * Whose updated WM Form somebody may have. Each says what that tech is paid:
 * a tech has their own, and whoever may see the crew's rates on the job —
 * beyond their own — has everybody's.
 */
export async function wmFormAssignments(
  user: SessionUser,
  job: { projectId: string | null; assigneeIds: string[]; createdById: string },
  assignments: { id: string; userId: string }[],
): Promise<string[]> {
  const scope = permissionScope(user, "pay.view_rates", job.projectId);
  const everyone =
    scope !== null && scope !== "OWN" && (await canOnJob(user, "pay.view_rates", job));
  return assignments
    .filter((assignment) => everyone || assignment.userId === user.id)
    .map((assignment) => assignment.id);
}

/** RFC 5987 filename, so a customer name with a comma cannot break the header. */
export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
