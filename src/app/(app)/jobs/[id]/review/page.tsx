import { redirect, notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { usDateTimeInZone } from "@/lib/datetime";
import { db } from "@/lib/db";
import { flagsFingerprint } from "@/lib/job-review";
import { loadReview } from "@/lib/job-review-data";
import { canOnJob } from "@/lib/scope";
import { getSessionUser } from "@/lib/session";
import { JobReview, type ReviewStep } from "../job-review";

export const metadata = { title: "Job approval" };

/**
 * The read-through before a job is signed off.
 *
 * A page of its own, reached from the job's menu and from the approvals queue,
 * so the job page itself stays the thing a tech reads on site rather than
 * carrying a reviewer's workflow at the top of it.
 *
 * What the reviewer is looking at is worked out in `loadReview`, which the
 * actions behind the buttons use as well — so what a step was warning about
 * when it was ticked is the same question, asked in the same place, whichever
 * side of the form is asking.
 */
export default async function ReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/signin");

  const { id } = await params;

  const review = await loadReview(id);
  if (!review) notFound();
  const { job, steps } = review;

  const allowed = await canOnJob(user, "job.approve_report", {
    projectId: job.projectId,
    assigneeIds: job.assigneeIds,
    createdById: job.createdById,
  });
  if (!allowed) notFound();

  // What has already been ticked, and whether the tick is still about what is
  // on screen. A step checked before somebody rewrote a punch is a step checked
  // about a different day.
  const checks = await db.jobReviewCheck.findMany({
    where: { jobId: job.id },
    select: {
      step: true,
      note: true,
      flagsSeen: true,
      checkedAt: true,
      checkedBy: { select: { name: true } },
    },
  });
  const checkOf = new Map(checks.map((check) => [check.step, check]));

  const withState: ReviewStep[] = steps.map((step) => {
    const check = checkOf.get(step.key);
    const current = flagsFingerprint(step.flags);

    return {
      key: step.key,
      title: step.title,
      rows: step.rows,
      flags: step.flags,
      images: step.images,
      note: check?.note ?? null,
      checked: check ? check.flagsSeen === current : false,
      // Ticked, but about findings that have since moved. Said out loud rather
      // than silently un-ticked, because "I already did that one" is exactly
      // what somebody would otherwise think.
      stale: check ? check.flagsSeen !== current : false,
      checkedBy: check?.checkedBy?.name ?? null,
      checkedAt: check
        ? usDateTimeInZone(check.checkedAt, job.zone)
        : null,
    };
  });

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <PageHeader
        title={`${job.title} — Job approval`}
        backHref={`/jobs/${job.id}`}
        description={job.intWoId}
      />

      {job.lifecycle === "PENDING_REVIEW" ? (
        <JobReview jobId={job.id} steps={withState} />
      ) : (
        <p className="text-sm text-muted-foreground">
          This job is not waiting on a read-through — it is {job.lifecycle}.
        </p>
      )}
    </div>
  );
}
