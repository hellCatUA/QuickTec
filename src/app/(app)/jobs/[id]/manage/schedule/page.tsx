import { redirect, notFound } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { assignmentTerms, describeTerms } from "@/lib/budget";
import { getCompanySettings } from "@/lib/company";
import { toDatetimeLocalInZone } from "@/lib/datetime";
import { db } from "@/lib/db";
import { detailsEditable } from "@/lib/job-fields";
import { toCents } from "@/lib/money";
import { loadPunchBlocks } from "@/lib/punch-blocks";
import { canOnJob } from "@/lib/scope";
import { getSessionUser } from "@/lib/session";
import { CrewPanel } from "../../crew-panel";
import { BudgetForm } from "./budget-form";
import { SinglePunch } from "./punches";
import { ScheduleForm } from "./schedule-form";
import { TravelForm } from "./travel-form";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const job = await db.job.findUnique({
    where: { id },
    select: { title: true },
  });
  return { title: job ? `${job.title} — Schedule & Budget` : "Schedule & Budget" };
}

/**
 * The things done to a job rather than on it.
 *
 * A page, not a sheet over the job. On a phone the overlay scrolled the page
 * behind it as often as itself, and what it held — somebody's whole day, and
 * what the job pays — is not glanceable anyway. A page also means the browser's
 * Back means what it says.
 *
 * The blocks themselves are built in @/lib/punch-blocks, because the review
 * shows the same ones: a reviewer told a clock-out is wrong should be able to
 * fix it where they are told, not somewhere else and then start the read-through
 * again.
 */
export default async function ManagePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/signin");

  const { id } = await params;

  const blocks = await loadPunchBlocks(id, user);
  if (!blocks) notFound();
  if (!blocks.visible && !blocks.canSetPay) notFound();

  const job = await db.job.findUniqueOrThrow({
    where: { id },
    select: {
      id: true,
      title: true,
      intWoId: true,
      lifecycle: true,
      projectId: true,
      createdById: true,
      travelReimbursement: true,
      scheduledStart: true,
      estimateMinutes: true,
      techsRequired: true,
      budgetType: true,
      budgetFlat: true,
      budgetFlatHours: true,
      budgetHourly: true,
      budgetSplit: true,
      site: { select: { timeZone: true } },
      project: { select: { travelReimbursement: true } },
      assignments: {
        orderBy: [{ isLead: "desc" }, { createdAt: "asc" }],
        select: {
          id: true,
          userId: true,
          isLead: true,
          shareBasisPoints: true,
          payType: true,
          payRate: true,
          payFlat: true,
          payFlatHours: true,
          payRateNote: true,
          payOverridden: true,
          travelReimbursement: true,
          supervisor: { select: { name: true } },
          user: { select: { name: true, defaultPayRate: true } },
          visits: { select: { clockInAt: true, clockOutAt: true } },
          _count: { select: { deliverables: true } },
        },
      },
      changeRequests: {
        where: { status: "PENDING", requestedById: user.id },
        select: { fieldPath: true, newValue: true },
      },
    },
  });

  const jobRef = {
    projectId: job.projectId,
    assigneeIds: job.assignments.map((assignment) => assignment.userId),
    createdById: job.createdById,
  };
  const [
    canEditPlanned,
    canFillMissing,
    canSuggest,
    canAssign,
    canReassign,
    canEditRates,
    showPay,
  ] = await Promise.all([
    canOnJob(user, "job.edit_planned_fields", jobRef),
    canOnJob(user, "job.fill_missing_field", jobRef),
    canOnJob(user, "job.suggest_change", jobRef),
    canOnJob(user, "job.assign", jobRef),
    canOnJob(user, "job.reassign", jobRef),
    canOnJob(user, "pay.edit_rates", jobRef),
    canOnJob(user, "pay.view_rates", jobRef),
  ]);

  // Only fetched for somebody who can act on it, so the page never carries the
  // staff list for the sake of it.
  const crewCandidates = canAssign
    ? await db.user.findMany({
        where: { active: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true, baseRole: true },
      })
    : [];

  // Signed off is a record: it stops at whoever can overrule a planner, and it
  // stops there outright, because a suggestion after sign-off has nothing left
  // to be approved against.
  const scheduleOpen =
    (detailsEditable(job.lifecycle) || canEditPlanned) &&
    (canEditPlanned || canFillMissing || canSuggest);

  const company = await getCompanySettings();
  const zone = job.site.timeZone ?? company.defaultTimeZone;

  const pendingByField: Record<string, string> = {};
  for (const request of job.changeRequests) {
    pendingByField[request.fieldPath] = request.newValue ?? "(cleared)";
  }

  // Each person's clocks, to sit under their own row rather than in a second
  // list of the same people further down the page.
  const punchOf = blocks.visible
    ? Object.fromEntries(
        blocks.punches.map((punch) => [
          punch.assignmentId,
          <SinglePunch
            key={punch.assignmentId}
            punch={punch}
            companyName={blocks.companyName}
          />,
        ]),
      )
    : undefined;

  const crew = job.assignments.map((assignment) => ({
    assignmentId: assignment.id,
    name: assignment.user.name,
    isLead: assignment.isLead,
    defaultRateCents: assignment.user.defaultPayRate
      ? toCents(assignment.user.defaultPayRate)
      : 0,
    shareBasisPoints: assignment.shareBasisPoints,
  }));

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <PageHeader
        title="Schedule & Budget"
        backHref={`/jobs/${job.id}/manage`}
        description={`Manager Portal · ${job.intWoId}`}
      />

      {scheduleOpen ? (
        <Card>
          <CardHeader>
            <CardTitle>Schedule</CardTitle>
            <CardDescription>
              When the crew is due, how long it is expected to take and how
              many go.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ScheduleForm
              jobId={job.id}
              values={{
                // Site-local, which is what the planner typed and what the job
                // page renders. Read as anything else it would move the job.
                scheduledStart: job.scheduledStart
                  ? toDatetimeLocalInZone(job.scheduledStart, zone)
                  : "",
                estimateMinutes: job.estimateMinutes
                  ? String(job.estimateMinutes)
                  : "",
                techsRequired: String(job.techsRequired),
              }}
              canEditPlanned={canEditPlanned}
              canFillMissing={canFillMissing}
              canSuggest={canSuggest}
              pending={pendingByField}
            />
          </CardContent>
        </Card>
      ) : null}

      {canAssign || canReassign || blocks.visible ? (
        <Card>
          <CardHeader>
            <CardTitle>Crew &amp; punches</CardTitle>
            <CardDescription>
              Who is on the job and what each of them clocked. One block rather
              than two, because they are the same list of people and the budget
              below is split between them.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <CrewPanel
              jobId={job.id}
              canAssign={canAssign}
              canReassign={canReassign}
              candidates={crewCandidates.map((person) => ({
                id: person.id,
                name: person.name,
                role: person.baseRole,
              }))}
              canEditPay={canEditRates}
              budgeted={Boolean(job.budgetType)}
              crew={job.assignments.map((assignment) => ({
                id: assignment.id,
                userId: assignment.userId,
                name: assignment.user.name,
                payType: assignment.payType,
                payRate: assignment.payRate.toString(),
                travelReimbursement:
                  assignment.travelReimbursement?.toString() ?? null,
                payNote: showPay ? assignment.payRateNote : null,
                overridden: assignment.payOverridden,
                isLead: assignment.isLead,
                onSite: assignment.visits.some(
                  (visit) => visit.clockOutAt === null,
                ),
                hasWorked:
                  assignment.visits.length > 0 ||
                  assignment._count.deliverables > 0,
                supervisorName: assignment.supervisor?.name ?? null,
                rate: showPay
                  ? `${describeTerms(assignmentTerms(assignment))}${
                      assignment.travelReimbursement
                        ? ` · travel $${Number(assignment.travelReimbursement).toFixed(2)}`
                        : ""
                    }`
                  : null,
              }))}
              punchOf={punchOf}
            />
          </CardContent>
        </Card>
      ) : null}

      {blocks.canSetPay ? (
        <Card>
          <CardHeader>
            <CardTitle>Total tech budget</CardTitle>
            <CardDescription>
              Everything the crew is paid from this job, and nothing else. It
              is not a ceiling held beside their lines — it is their lines
              added up, so payroll has one number to reconcile against.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <BudgetForm
              jobId={job.id}
              crew={crew}
              canEdit={blocks.canSetPay}
              budgetType={job.budgetType}
              budgetFlat={job.budgetFlat?.toString() ?? ""}
              budgetFlatHours={job.budgetFlatHours?.toString() ?? ""}
              budgetHourly={job.budgetHourly?.toString() ?? ""}
              splitMode={job.budgetSplit}
            />
          </CardContent>
        </Card>
      ) : null}

      {blocks.canSetPay ? (
        <Card>
          <CardHeader>
            <CardTitle>Travel</CardTitle>
            <CardDescription>
              Paid on top of the budget. It is a reimbursement rather than
              wages, so it is not split between the crew — everybody on the job
              is allocated it.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TravelForm
              jobId={job.id}
              travelReimbursement={job.travelReimbursement?.toString() ?? null}
              note={
                job.travelReimbursement
                  ? null
                  : job.project?.travelReimbursement
                    ? `Not set on this job — the project allocates $${Number(
                        job.project.travelReimbursement,
                      ).toFixed(2)}.`
                    : "Not set — nobody is reimbursed for travel on this job."
              }
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
