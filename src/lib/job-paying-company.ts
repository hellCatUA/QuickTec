import { db } from "@/lib/db";
import { OPEN_LIFECYCLES } from "@/lib/job-status";

/** Every job not yet signed off: the ones whose paying company can still move. */
const STILL_OPEN = new Set<string>([...OPEN_LIFECYCLES, "DRAFT"]);

/**
 * Why this job's paying company can no longer change, or null when it can.
 *
 * The rule a project's change of company follows for its open jobs, asked of
 * one job: a job signed off, one with the company's own work order attached —
 * not a blank copied from their template — or one with a week on it that
 * payroll has approved is that company's on paper already.
 */
export async function payingCompanyFixed(jobId: string): Promise<string | null> {
  const job = await db.job.findUnique({
    where: { id: jobId },
    select: {
      lifecycle: true,
      documents: {
        where: { jobDocumentKind: "CLIENT_WORK_ORDER", sourceTemplateId: null },
        select: { id: true },
        take: 1,
      },
      assignments: {
        select: {
          payrollLines: {
            where: { payrollPeriod: { status: { not: "DRAFT" } } },
            select: { id: true },
            take: 1,
          },
        },
      },
    },
  });
  if (!job) return "The job is gone.";
  if (!STILL_OPEN.has(job.lifecycle)) {
    return "The job is signed off, so who paid for it is part of the record.";
  }
  if (job.documents.length > 0) {
    return "Their work order is attached to this job.";
  }
  if (job.assignments.some((assignment) => assignment.payrollLines.length > 0)) {
    return "A week on this job has already been through payroll.";
  }
  return null;
}
