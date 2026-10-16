import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { db } from "@/lib/db";
import { detailsEditable } from "@/lib/job-fields";
import { payingCompanyFixed } from "@/lib/job-paying-company";
import { portalBackHref } from "@/lib/job-portal";
import { canOnJob, canOnProject } from "@/lib/scope";
import { getSessionUser } from "@/lib/session";

import { JobManagementForm } from "./management-form";

// Named after the tile that opens it.
export const metadata = { title: "Job management" };

/**
 * What the job is called and who it is for, apart from the details of the
 * work itself: its title, its paying company and its rep company.
 *
 * The same rules as Job details, which held the title and the rep company
 * before: a planner changes them outright, somebody who may only suggest
 * sends a new title to a supervisor, and a signed-off job stops at whoever
 * can overrule a planner. The paying company is new here, and follows the
 * rule a project's change of company follows for its jobs.
 */
export default async function JobManagementPage({
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
      clientId: true,
      client: { select: { id: true, name: true } },
      repCompanyId: true,
      repCompany: { select: { id: true, name: true } },
      pmContact: { select: { clientId: true } },
      assignments: { select: { userId: true } },
      changeRequests: {
        where: { status: "PENDING", requestedById: user.id, fieldPath: "title" },
        select: { newValue: true },
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

  // The title is never blank, so filling a gap is not a way in: somebody here
  // either plans the job or may suggest a new title.
  if (!canEditPlanned && !canSuggest) notFound();

  const open = detailsEditable(job.lifecycle) || canEditPlanned;
  const settled = !detailsEditable(job.lifecycle);

  // Who pays for work on a project is the project's to decide: a supervisor
  // on the crew plans the job but does not run the project.
  const canChangeClient =
    canEditPlanned && (job.projectId === null || canOnProject(user, "project.manage", job.projectId));

  const [clients, repCompanies, clientFixed, oldBlanks, standingForms] = await Promise.all([
    db.client.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.repCompany.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    payingCompanyFixed(job.id),
    db.attachment.count({
      where: { jobDocumentId: job.id, generated: false, sourceTemplate: { clientId: job.clientId } },
    }),
    db.clientDocumentTemplate.groupBy({
      by: ["clientId"],
      where: { active: true, isDefault: true },
      _count: { _all: true },
    }),
  ]);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <PageHeader
        title="Job management"
        backHref={await portalBackHref(job.id, user)}
        description={`${job.title} · ${job.intWoId}`}
      />

      {open ? (
        <>
          {settled ? (
            <p className="rounded-xl border border-border bg-surface-raised p-3 text-xs text-muted-foreground">
              This job is signed off. Anything changed here is changed on a record somebody has
              already approved, and every change is on the timeline.
            </p>
          ) : null}

          {canEditPlanned ? null : (
            <p className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
              A new title goes to a supervisor first. The paying and rep companies are set by
              whoever plans the job.
            </p>
          )}

          <JobManagementForm
            jobId={job.id}
            title={job.title}
            clientId={job.clientId}
            repCompanyId={job.repCompanyId ?? ""}
            // One since retired from the directory still shows as what the job
            // holds rather than as somebody else.
            clients={[
              ...clients,
              ...(clients.some((one) => one.id === job.client.id) ? [] : [job.client]),
            ]}
            repCompanies={[
              ...repCompanies,
              ...(job.repCompany && !repCompanies.some((one) => one.id === job.repCompany!.id)
                ? [job.repCompany]
                : []),
            ]}
            clientFixed={clientFixed}
            canChangeClient={canChangeClient}
            moving={{
              coordinator: job.pmContact?.clientId === job.clientId,
              oldBlanks,
              formsOf: Object.fromEntries(
                standingForms.map((row) => [row.clientId, row._count._all]),
              ),
            }}
            canEditPlanned={canEditPlanned}
            canFillMissing={canFillMissing}
            canSuggest={canSuggest}
            pendingTitle={job.changeRequests[0]?.newValue ?? undefined}
          />
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          This job has been signed off, so what it is called and who it is for are the record
          now. A supervisor can still correct its title and rep company; who paid for it stays.
        </p>
      )}
    </div>
  );
}
