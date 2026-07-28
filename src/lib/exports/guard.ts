import { db } from "@/lib/db";
import { loadJobForExport, type JobExportData } from "@/lib/exports/job-data";
import type { Permission } from "@/lib/permissions";
import { canOnJob } from "@/lib/scope";
import { getSessionUser } from "@/lib/session";

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
  const user = await getSessionUser();
  if (!user) return null;

  const job = await db.job.findUnique({
    where: { id: jobId },
    select: {
      projectId: true,
      createdById: true,
      assignments: { select: { userId: true } },
    },
  });
  if (!job) return null;

  const allowed = await canOnJob(user, permission, {
    projectId: job.projectId,
    assigneeIds: job.assignments.map((assignment) => assignment.userId),
    createdById: job.createdById,
  });
  if (!allowed) return null;

  return loadJobForExport(jobId);
}

/** RFC 5987 filename, so a customer name with a comma cannot break the header. */
export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
