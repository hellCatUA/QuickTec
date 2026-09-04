import { getCompanySettings } from "@/lib/company";
import { usDateTimeInZone, usTimeInZone } from "@/lib/datetime";
import { db } from "@/lib/db";
import { deliverableLabel, effectiveRules } from "@/lib/deliverables";
import {
  flagsFingerprint,
  reviewDeliverables,
  reviewReimbursements,
  reviewTimes,
  reviewWork,
  type ReviewFlag,
  type ReviewStepKey,
} from "@/lib/job-review";
import { visitTotals } from "@/lib/time-tracking";

/**
 * The four passes of a report review, assembled from the job.
 *
 * Lifted out of the page because the page is no longer the only thing that
 * needs them. Confirming a step records what the reviewer was warned about at
 * the time, and a fingerprint the browser posted back would be a fingerprint
 * the browser could choose — so the server works the findings out again for
 * itself, from here, and the two can never disagree.
 */

/** Something worth looking at rather than reading: a photo, a receipt. */
export type ReviewImage = {
  id: string;
  label: string;
};

export type ReviewStepData = {
  key: ReviewStepKey;
  title: string;
  rows: { label: string; value: string; missing?: boolean }[];
  flags: ReviewFlag[];
  /** Shown as thumbnails under the rows. Empty for steps that have none. */
  images: ReviewImage[];
};

export type ReviewJob = {
  id: string;
  title: string;
  intWoId: string;
  lifecycle: string;
  projectId: string | null;
  createdById: string;
  assigneeIds: string[];
  zone: string;
};

export type LoadedReview = {
  job: ReviewJob;
  steps: ReviewStepData[];
};

export async function loadReview(jobId: string): Promise<LoadedReview | null> {
  const now = new Date();

  const job = await db.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      title: true,
      intWoId: true,
      lifecycle: true,
      scheduledStart: true,
      estimateMinutes: true,
      workPerformedMerged: true,
      createdById: true,
      projectId: true,
      site: { select: { timeZone: true } },
      documents: { select: { jobDocumentKind: true } },
      deliverableRules: {
        where: { projectId: null },
        select: {
          category: true,
          customLabel: true,
          enabled: true,
          required: true,
          requiresPhoto: true,
          requiresText: true,
          order: true,
        },
      },
      project: {
        select: {
          deliverableRules: {
            where: { jobId: null },
            select: {
              category: true,
              customLabel: true,
              enabled: true,
              required: true,
              requiresPhoto: true,
              requiresText: true,
              order: true,
            },
          },
        },
      },
      deliverables: {
        select: {
          category: true,
          customLabel: true,
          attachments: { select: { id: true } },
        },
      },
      reimbursements: {
        select: {
          type: true,
          label: true,
          amount: true,
          attachments: { select: { id: true } },
        },
      },
      assignments: {
        select: {
          workPerformed: true,
          user: { select: { id: true, name: true } },
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
  const zone = job.site.timeZone ?? company.defaultTimeZone;

  const rules = effectiveRules(
    job.deliverableRules,
    job.project?.deliverableRules ?? [],
  ).filter((rule) => rule.enabled);

  const worked = job.assignments
    .map((assignment) => {
      const visit = assignment.visits[0];
      if (!visit) return null;
      const totals = assignment.visits.map((one) =>
        visitTotals(
          {
            clockInAt: one.clockInAt,
            clockOutAt: one.clockOutAt,
            breaks: one.breaks,
          },
          now,
        ),
      );
      return {
        who: assignment.user.name,
        clockInAt: visit.clockInAt,
        clockOutAt: visit.clockOutAt,
        paidMinutes: totals.reduce((sum, one) => sum + one.paidMinutes, 0),
      };
    })
    .filter((entry) => entry !== null);

  const sections = rules.map((rule) => {
    const items = job.deliverables.filter(
      (item) =>
        item.category === rule.category &&
        (rule.category !== "CUSTOM" || item.customLabel === rule.customLabel),
    );
    return {
      label: deliverableLabel(rule.category, rule.customLabel),
      required: rule.required,
      filled: items.length > 0,
      attachmentIds: items.flatMap((item) =>
        item.attachments.map((attachment) => attachment.id),
      ),
    };
  });

  const claims = job.reimbursements.map((entry) => ({
    label: entry.label ?? entry.type,
    amount: Number(entry.amount),
    hasReceipt: entry.attachments.length > 0,
    attachmentIds: entry.attachments.map((attachment) => attachment.id),
  }));

  const written = job.assignments.map((assignment) => ({
    who: assignment.user.name,
    text: assignment.workPerformed,
  }));

  const steps: ReviewStepData[] = [
    {
      key: "times",
      title: "Times",
      rows: [
        {
          label: "Scheduled",
          value: job.scheduledStart
            ? usDateTimeInZone(job.scheduledStart, zone)
            : "Not scheduled",
          missing: !job.scheduledStart,
        },
        {
          label: "Estimate",
          value: job.estimateMinutes
            ? `${(job.estimateMinutes / 60).toFixed(2)} hrs`
            : "None",
          missing: !job.estimateMinutes,
        },
        ...worked.map((entry) => ({
          label: entry.who,
          value: `${usTimeInZone(entry.clockInAt, zone)} – ${
            entry.clockOutAt ? usTimeInZone(entry.clockOutAt, zone) : "still on"
          } · ${(entry.paidMinutes / 60).toFixed(2)} hrs`,
        })),
      ],
      flags: reviewTimes({
        scheduledStart: job.scheduledStart,
        estimateMinutes: job.estimateMinutes,
        visits: worked,
      }),
      images: [],
    },
    {
      key: "deliverables",
      title: "Deliverables",
      rows: sections.map((section) => ({
        label: section.label,
        value: section.filled
          ? section.attachmentIds.length > 0
            ? `${section.attachmentIds.length} photo${section.attachmentIds.length === 1 ? "" : "s"}`
            : "Recorded"
          : "Empty",
        missing: !section.filled,
      })),
      flags: reviewDeliverables({
        sections,
        photoCount: job.deliverables.reduce(
          (total, item) => total + item.attachments.length,
          0,
        ),
        hasSignOff: job.documents.some(
          (doc) => doc.jobDocumentKind === "SIGN_OFF",
        ),
      }),
      // Every photo the client is about to be sent, in the pass that is about
      // them. Reading "4 photos" and believing it is not a review.
      images: sections.flatMap((section) =>
        section.attachmentIds.map((id) => ({ id, label: section.label })),
      ),
    },
    {
      key: "reimbursements",
      title: "Reimbursements",
      rows: claims.map((claim) => ({
        label: claim.label,
        value: `$${claim.amount.toFixed(2)}${claim.hasReceipt ? "" : " · no receipt"}`,
        missing: !claim.hasReceipt,
      })),
      flags: reviewReimbursements({ entries: claims }),
      images: claims.flatMap((claim) =>
        claim.attachmentIds.map((id) => ({ id, label: claim.label })),
      ),
    },
    {
      key: "work",
      title: "Work performed",
      rows: job.workPerformedMerged
        ? [{ label: "To the client", value: job.workPerformedMerged }]
        : written
            .filter((entry) => entry.text?.trim())
            .map((entry) => ({ label: entry.who, value: entry.text! })),
      flags: reviewWork({ merged: job.workPerformedMerged, entries: written }),
      images: [],
    },
  ];

  return {
    job: {
      id: job.id,
      title: job.title,
      intWoId: job.intWoId,
      lifecycle: job.lifecycle,
      projectId: job.projectId,
      createdById: job.createdById,
      assigneeIds: job.assignments.map((assignment) => assignment.user.id),
      zone,
    },
    steps,
  };
}

/** The findings on one step, as they stand right now. */
export function fingerprintOf(
  steps: ReviewStepData[],
  key: ReviewStepKey,
): string | null {
  const step = steps.find((one) => one.key === key);
  return step ? flagsFingerprint(step.flags) : null;
}
