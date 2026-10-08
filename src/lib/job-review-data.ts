import { siteLabel } from "@/lib/address";
import { getCompanySettings } from "@/lib/company";
import { usDateTimeInZone, usTimeInZone } from "@/lib/datetime";
import { db } from "@/lib/db";
import { formSummary } from "@/lib/exports/text-report";
import { fileVersion } from "@/lib/storage";
import { MAX_WORK_SUMMARY } from "@/lib/work-summary";
import {
  effectiveRules,
  fieldProgress,
  itemMatchesRule,
  LOCATION_PLAN_SELECT,
  RULE_SELECT,
} from "@/lib/deliverables";
import {
  flagsFingerprint,
  reviewDeliverables,
  reviewDetails,
  reviewReimbursements,
  reviewTimes,
  reviewWork,
  type DetailChange,
  type ReviewFlag,
  type ReviewStepKey,
} from "@/lib/job-review";
import { isJobField, JOB_FIELDS } from "@/lib/job-fields";
import { visitTotals } from "@/lib/time-tracking";
import type { JobLifecycle } from "@prisma-client";

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
  /** Changes when a photo is drawn again with a new label. */
  version?: string;
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
  lifecycle: JobLifecycle;
  projectId: string | null;
  createdById: string;
  assigneeIds: string[];
  zone: string;
};

export type LoadedReview = {
  job: ReviewJob;
  steps: ReviewStepData[];
};

/**
 * Every field that held a value and was changed after the job was raised.
 *
 * Read from the audit log rather than kept in a column of its own: the log is
 * already written on every route a change can take — straight onto the job by
 * somebody who may, or through a supervisor's approval by somebody who may not
 * — and a second record of the same fact is a second record to keep in step.
 *
 * `field_filled` is deliberately not gathered. A gap closed on site overwrote
 * nothing and nobody was working from the old value.
 *
 * The site reads back as a name rather than an id. A reviewer asked to check
 * "cmu6j5np…  →  cmu8vyye…" is a reviewer who ticks the box.
 */
async function detailChanges(
  jobId: string,
  zone: string,
): Promise<DetailChange[]> {
  const events = await db.auditEvent.findMany({
    where: { jobId, action: { in: ["field_edited", "change_approved"] } },
    orderBy: { createdAt: "asc" },
    select: {
      action: true,
      detail: true,
      createdAt: true,
      actor: { select: { name: true } },
    },
  });

  const siteIds = new Set<string>();
  for (const event of events) {
    const detail = (event.detail ?? {}) as Record<string, unknown>;
    if (detail.field !== "siteId") continue;
    for (const key of ["from", "to"]) {
      const value = detail[key];
      if (typeof value === "string" && value) siteIds.add(value);
    }
  }

  const sites =
    siteIds.size === 0
      ? []
      : await db.site.findMany({
          where: { id: { in: [...siteIds] } },
          select: {
            id: true,
            siteNumber: true,
            numberPending: true,
            customer: { select: { code: true, name: true } },
          },
        });
  const siteNames = new Map(
    sites.map((site) => [
      site.id,
      `${site.customer.name} · ${
        site.numberPending
          ? "number pending"
          : siteLabel(site.customer.code, site.siteNumber)
      }`,
    ]),
  );

  const changes: DetailChange[] = [];

  for (const event of events) {
    const detail = (event.detail ?? {}) as Record<string, unknown>;
    const field = detail.field;
    if (typeof field !== "string" || !isJobField(field)) continue;

    const from = typeof detail.from === "string" ? detail.from : "";
    const to = typeof detail.to === "string" ? detail.to : "";
    // Nothing was overwritten, so there is nothing for a reviewer to weigh.
    if (from === "") continue;

    const show = (value: string) =>
      field === "siteId" ? (siteNames.get(value) ?? value) : value;

    changes.push({
      label: JOB_FIELDS[field].label,
      from: show(from),
      to: show(to),
      who: event.actor?.name ?? "Someone since removed",
      when: usDateTimeInZone(event.createdAt, zone),
      approved: event.action === "change_approved",
    });
  }

  return changes;
}

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
        select: RULE_SELECT,
      },
      project: {
        select: {
          deliverableRules: {
            where: { jobId: null },
            select: RULE_SELECT,
          },
        },
      },
      deliverables: {
        select: {
          category: true,
          customLabel: true,
          locationId: true,
          textValue: true,
          attachments: { select: { id: true, label: true, storagePath: true } },
        },
      },
      locations: {
        orderBy: [{ order: "asc" }, { createdAt: "asc" }],
        select: { id: true, name: true, ...LOCATION_PLAN_SELECT },
      },
      reimbursements: {
        select: {
          type: true,
          label: true,
          quantity: true,
          amount: true,
          assignmentId: true,
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

  const progress = fieldProgress(
    rules,
    job.deliverables.map((item) => ({
      category: item.category,
      customLabel: item.customLabel,
      locationId: item.locationId,
      textValue: item.textValue,
      fileCount: item.attachments.length,
    })),
    job.locations,
  );

  const sections = progress.map((field) => {
    const items = job.deliverables.filter((item) =>
      itemMatchesRule(item, field.rule),
    );
    return {
      label: field.label,
      required: field.rule.required,
      filled: field.files > 0 || field.hasText,
      gap: field.gap,
      photos: items.flatMap((item) =>
        item.attachments.map((attachment) => ({
          id: attachment.id,
          label: attachment.label,
          version: fileVersion(attachment.storagePath, attachment.label),
        })),
      ),
    };
  });

  const claims = job.reimbursements.map((entry) => ({
    label:
      entry.type === "MATERIAL" && entry.quantity > 1
        ? `(${entry.quantity}) ${entry.label ?? "Material"}`
        : (entry.label ?? entry.type),
    amount: Number(entry.amount),
    hasReceipt: entry.attachments.length > 0,
    hasTech: entry.assignmentId !== null,
    attachmentIds: entry.attachments.map((attachment) => attachment.id),
  }));

  const written = job.assignments.map((assignment) => ({
    who: assignment.user.name,
    text: assignment.workPerformed,
  }));

  const changes = await detailChanges(jobId, zone);

  const steps: ReviewStepData[] = [
    {
      key: "details",
      title: "Details changed",
      rows: changes.map((change) => ({
        label: change.label,
        value: `${change.from || "(blank)"} → ${change.to || "(cleared)"}`,
      })),
      flags: reviewDetails({ changes }),
      images: [],
    },
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
          ? section.photos.length > 0
            ? `${section.photos.length} photo${section.photos.length === 1 ? "" : "s"}`
            : "Recorded"
          : "Empty",
        // Short of what it asks for is as missing as empty: 2 photos of 3 is
        // highlighted with the rest, as the flag above already says.
        missing: section.required ? section.gap !== null : !section.filled,
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
        section.photos.map((photo) => ({
          id: photo.id,
          label: photo.label ? `${section.label} — ${photo.label}` : section.label,
          version: photo.version,
        })),
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
      flags: reviewWork({
        merged: job.workPerformedMerged,
        entries: written,
        forms: written.map((entry) => ({
          who: entry.who,
          text: formSummary({
            merged: job.workPerformedMerged,
            own: entry.text,
            entries: written,
          }),
        })),
        limit: MAX_WORK_SUMMARY,
      }),
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
