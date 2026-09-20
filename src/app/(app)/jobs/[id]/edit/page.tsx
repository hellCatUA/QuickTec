import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { formatAddress, siteLabel } from "@/lib/address";
import { getCompanySettings } from "@/lib/company";
import { toDatetimeLocalInZone } from "@/lib/datetime";
import { db } from "@/lib/db";
import { detailsEditable } from "@/lib/job-fields";
import { canOnJob } from "@/lib/scope";
import { getSessionUser } from "@/lib/session";

import { DetailsForm } from "./details-form";

export const metadata = { title: "Edit job details" };

/**
 * Correcting what the job was raised as, while it is being worked.
 *
 * A page rather than a mode on the job page. The job page is a long scroll on
 * a phone and a mode across it puts Save somewhere off the bottom; this is one
 * form, one press, and a Back that works. It is also the honest shape for what
 * happens next — a tech's changes are a request, not an edit, and a request
 * wants a reason box and a sentence about where it went.
 *
 * Only what was decided at creation. Everything collected during the job —
 * contacts, dispatch numbers, extra tickets, the release code, the paperwork —
 * stays on the job page where it is read and added to.
 */
export default async function EditDetailsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/signin");

  const { id } = await params;

  const job = await db.job.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      intWoId: true,
      lifecycle: true,
      projectId: true,
      createdById: true,
      siteId: true,
      externalAssignmentId: true,
      ticketNumber: true,
      incNumber: true,
      scheduledStart: true,
      estimateMinutes: true,
      techsRequired: true,
      scopeOfWork: true,
      site: { select: { timeZone: true } },
      assignments: { select: { userId: true } },
      changeRequests: {
        where: { status: "PENDING", requestedById: user.id },
        select: { fieldPath: true, newValue: true },
      },
    },
  });
  if (!job) notFound();

  const jobRef = {
    projectId: job.projectId,
    assigneeIds: job.assignments.map((assignment) => assignment.userId),
    createdById: job.createdById,
  };
  if (!(await canOnJob(user, "job.view", jobRef))) notFound();

  const [canEditPlanned, canFillMissing, canSuggest] = await Promise.all([
    canOnJob(user, "job.edit_planned_fields", jobRef),
    canOnJob(user, "job.fill_missing_field", jobRef),
    canOnJob(user, "job.suggest_change", jobRef),
  ]);

  // Nothing to offer somebody who can neither write nor ask.
  if (!canEditPlanned && !canFillMissing && !canSuggest) notFound();

  // Signed off is a record, so it stops at whoever can overrule a planner —
  // and it stops there outright, because a suggestion after sign-off has
  // nothing left to be approved against.
  const company = await getCompanySettings();
  const zone = job.site.timeZone ?? company.defaultTimeZone;

  const open = detailsEditable(job.lifecycle) || canEditPlanned;
  const settled = !detailsEditable(job.lifecycle);

  const sites = await db.site.findMany({
    where: { OR: [{ active: true }, { id: job.siteId }] },
    orderBy: [{ customer: { name: "asc" } }, { siteNumber: "asc" }],
    select: {
      id: true,
      siteNumber: true,
      numberPending: true,
      name: true,
      addressLine1: true,
      addressLine2: true,
      city: true,
      state: true,
      postalCode: true,
      country: true,
      customer: { select: { code: true, name: true } },
    },
  });

  // Searchable by the customer's name as well as the number, because "the
  // Truman Health one" is how somebody standing at the wrong door describes it.
  const options = sites.map((site) => ({
    value: site.id,
    label: `${site.customer.name} · ${
      site.numberPending
        ? "number pending"
        : siteLabel(site.customer.code, site.siteNumber)
    }`,
    hint: formatAddress(site),
    keywords: [site.name, site.customer.code, site.siteNumber]
      .filter(Boolean)
      .join(" "),
  }));

  const pending: Record<string, string> = {};
  for (const request of job.changeRequests) {
    pending[request.fieldPath] = request.newValue ?? "(cleared)";
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <PageHeader
        title="Edit job details"
        backHref={`/jobs/${job.id}`}
        description={`${job.title} · ${job.intWoId}`}
      />

      {open ? (
        <>
          {settled ? (
            <p className="rounded-xl border border-border bg-surface-raised p-3 text-xs text-muted-foreground">
              This job is signed off. Anything changed here is changed on a
              record somebody has already approved, and every change is on the
              timeline.
            </p>
          ) : null}

          {canEditPlanned ? null : (
            <p className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
              Filling something in that was left blank saves straight away.
              Changing something that already has a value goes to a supervisor
              first — each field below says which it will be.
            </p>
          )}

          <DetailsForm
            jobId={job.id}
            values={{
              siteId: job.siteId,
              externalAssignmentId: job.externalAssignmentId ?? "",
              ticketNumber: job.ticketNumber ?? "",
              incNumber: job.incNumber ?? "",
              // Site-local, which is what the planner typed and what the job
              // page renders. Read as anything else it would move the job.
              scheduledStart: job.scheduledStart
                ? toDatetimeLocalInZone(job.scheduledStart, zone)
                : "",
              estimateMinutes: job.estimateMinutes
                ? String(job.estimateMinutes)
                : "",
              techsRequired: String(job.techsRequired),
              scopeOfWork: job.scopeOfWork ?? "",
            }}
            sites={options}
            canEditPlanned={canEditPlanned}
            canFillMissing={canFillMissing}
            canSuggest={canSuggest}
            pending={pending}
          />
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          This job has been signed off, so its details are the record now. A
          supervisor can still correct them.
        </p>
      )}
    </div>
  );
}
