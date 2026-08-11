import { redirect, notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { getCompanySettings } from "@/lib/company";
import { usDateTimeInZone, usTimeInZone } from "@/lib/datetime";
import { db } from "@/lib/db";
import { deliverableLabel, effectiveRules } from "@/lib/deliverables";
import {
  reviewDeliverables,
  reviewReimbursements,
  reviewTimes,
  reviewWork,
} from "@/lib/job-review";
import { canOnJob } from "@/lib/scope";
import { getSessionUser } from "@/lib/session";
import { visitTotals } from "@/lib/time-tracking";
import { JobReview, type ReviewStep } from "../job-review";

export const metadata = { title: "Job approval" };

/**
 * The read-through before a job is signed off.
 *
 * A page of its own now, reached from the job's menu, so the job page itself
 * stays the thing a tech reads on site rather than carrying a reviewer's
 * workflow at the top of it.
 */
export default async function ReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/signin");

  const { id } = await params;
  const now = new Date();

  const job = await db.job.findUnique({
    where: { id },
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
  if (!job) notFound();

  const allowed = await canOnJob(user, "job.approve_report", {
    projectId: job.projectId,
    assigneeIds: job.assignments.map((assignment) => assignment.user.id),
    createdById: job.createdById,
  });
  if (!allowed) notFound();

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

  const sections = rules.map((rule) => ({
    label: deliverableLabel(rule.category, rule.customLabel),
    required: rule.required,
    filled: job.deliverables.some(
      (item) =>
        item.category === rule.category &&
        (rule.category !== "CUSTOM" || item.customLabel === rule.customLabel),
    ),
  }));

  const claims = job.reimbursements.map((entry) => ({
    label: entry.label ?? entry.type,
    amount: Number(entry.amount),
    hasReceipt: entry.attachments.length > 0,
  }));

  const written = job.assignments.map((assignment) => ({
    who: assignment.user.name,
    text: assignment.workPerformed,
  }));

  const steps: ReviewStep[] = [
    {
      key: "times",
      title: "Times",
      rows: [
        {
          label: "Scheduled",
          value: job.scheduledStart
            ? usDateTimeInZone(job.scheduledStart, zone)
            : "Not scheduled",
        },
        {
          label: "Estimate",
          value: job.estimateMinutes
            ? `${(job.estimateMinutes / 60).toFixed(2)} hrs`
            : "None",
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
    },
    {
      key: "deliverables",
      title: "Deliverables",
      rows: sections.map((section) => ({
        label: section.label,
        value: section.filled ? "Recorded" : "Empty",
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
    },
    {
      key: "reimbursements",
      title: "Reimbursements",
      rows: claims.map((claim) => ({
        label: claim.label,
        value: `$${claim.amount.toFixed(2)}${claim.hasReceipt ? "" : " · no receipt"}`,
      })),
      flags: reviewReimbursements({ entries: claims }),
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
    },
  ];

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <PageHeader
        title={`${job.title} — Job approval`}
        backHref={`/jobs/${job.id}`}
        description={job.intWoId}
      />

      {job.lifecycle === "PENDING_REVIEW" ? (
        <JobReview jobId={job.id} steps={steps} />
      ) : (
        <p className="text-sm text-muted-foreground">
          This job is not waiting on a read-through — it is {job.lifecycle}.
        </p>
      )}
    </div>
  );
}
