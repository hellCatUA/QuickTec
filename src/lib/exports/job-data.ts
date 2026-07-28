import { siteLabel } from "@/lib/address";
import { getCompanySettings } from "@/lib/company";
import { isoDateInZone } from "@/lib/datetime";
import { db } from "@/lib/db";
import { jobSpan } from "@/lib/time-tracking";

/**
 * One query behind every export.
 *
 * The text report, the ZIP and the internal PDF all describe the same job, so
 * they read from the same shape — otherwise the report and the archive start
 * disagreeing about who was on site, which is exactly the sort of thing nobody
 * notices until a client asks.
 */
export async function loadJobForExport(jobId: string) {
  const job = await db.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      intWoId: true,
      title: true,
      externalAssignmentId: true,
      ticketNumber: true,
      incNumber: true,
      scheduledStart: true,
      estimateMinutes: true,
      scopeOfWork: true,
      releaseCode: true,
      noReleaseCode: true,
      returnTrackingNumber: true,
      workPerformedMerged: true,
      outcome: true,
      internalStatus: true,
      lifecycle: true,
      revisitNumber: true,
      createdAt: true,
      client: { select: { name: true } },
      customer: { select: { name: true, code: true } },
      site: {
        select: {
          siteNumber: true,
          name: true,
          addressLine1: true,
          addressLine2: true,
          city: true,
          state: true,
          postalCode: true,
          country: true,
          timeZone: true,
        },
      },
      project: {
        select: { name: true, externalProjectId: true, generalScopeOfWork: true },
      },
      pointsOfContact: {
        orderBy: [{ type: "asc" }, { order: "asc" }],
        select: { id: true, type: true, name: true },
      },
      signatures: {
        select: {
          id: true,
          kind: true,
          signerName: true,
          skipped: true,
          signedAt: true,
          attachment: {
            select: { id: true, storagePath: true, originalName: true, mimeType: true },
          },
        },
      },
      deliverables: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          category: true,
          customLabel: true,
          textValue: true,
          assignment: { select: { user: { select: { name: true } } } },
          attachments: {
            select: {
              id: true,
              storagePath: true,
              originalName: true,
              mimeType: true,
            },
          },
        },
      },
      reimbursements: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          type: true,
          label: true,
          amount: true,
          attachments: {
            select: { id: true, storagePath: true, mimeType: true },
          },
        },
      },
      assignments: {
        orderBy: { isLead: "desc" },
        select: {
          id: true,
          isLead: true,
          workPerformed: true,
          user: { select: { name: true } },
          visits: {
            orderBy: { clockInAt: "asc" },
            select: {
              clockInAt: true,
              clockOutAt: true,
              breaks: { select: { startAt: true, endAt: true, paid: true } },
            },
          },
        },
      },
    },
  });

  if (!job) return null;

  const company = await getCompanySettings();
  const timeZone = job.site.timeZone ?? company.defaultTimeZone;
  const span = jobSpan(job.assignments.flatMap((a) => a.visits));

  return {
    job,
    company,
    timeZone,
    span,
    siteName: siteLabel(job.customer.code, job.site.siteNumber),
    /**
     * The date the work happened, not the date of the export. A job finished
     * at 2am is filed under the day the crew arrived.
     */
    workDate: isoDateInZone(span.onsiteAt ?? job.scheduledStart ?? job.createdAt, timeZone),
  };
}

export type JobExportData = NonNullable<Awaited<ReturnType<typeof loadJobForExport>>>;

/** "2026-07-28-887766" — the stem for both the ZIP and the report file. */
export function exportStem(data: JobExportData): string {
  return `${data.workDate}-${data.job.externalAssignmentId || data.job.intWoId}`;
}
