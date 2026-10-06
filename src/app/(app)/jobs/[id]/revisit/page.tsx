import { redirect, notFound } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { describeTerms, jobTerms } from "@/lib/budget";
import { decimalHours } from "@/lib/datetime";
import { db } from "@/lib/db";
import { formatRate } from "@/lib/money";
import { portalBackHref } from "@/lib/job-portal";
import { canOnJob } from "@/lib/scope";
import { can, getSessionUser } from "@/lib/session";
import { RevisitPanel } from "../revisit-panel";

// Named after the tile that opens it.
export const metadata = { title: "Revisit planner" };

/**
 * Booking the return trip.
 *
 * Its own page rather than a section of the Manager Portal: it is not a setting
 * on this job, it makes a different one.
 */
export default async function RevisitPage({
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
      externalAssignmentId: true,
      createdById: true,
      projectId: true,
      // What the original is actually carrying, so the form offers only what
      // is there and says how much of it there is.
      scopeOfWork: true,
      ticketNumber: true,
      incNumber: true,
      estimateMinutes: true,
      techsRequired: true,
      payType: true,
      payRate: true,
      breakPaid: true,
      travelReimbursement: true,
      budgetType: true,
      budgetFlat: true,
      budgetFlatHours: true,
      budgetHourly: true,
      extraTickets: { orderBy: { order: "asc" }, select: { number: true } },
      _count: {
        select: { dispatchContacts: true, locations: true, pointsOfContact: true },
      },
      deliverablesOwn: true,
      deliverableRules: { where: { enabled: true }, select: { id: true } },
      documents: {
        where: { jobDocumentKind: "SIGN_OFF", sourceTemplateId: { not: null } },
        select: { id: true },
      },
      project: { select: { managerId: true } },
      assignments: {
        orderBy: { isLead: "desc" },
        select: {
          supervisorId: true,
          isLead: true,
          user: {
            select: { id: true, name: true, directSupervisorId: true },
          },
        },
      },
    },
  });
  if (!job) notFound();

  const allowed =
    can(user, "job.create") &&
    (await canOnJob(user, "job.view", {
      projectId: job.projectId,
      assigneeIds: job.assignments.map((assignment) => assignment.user.id),
      createdById: job.createdById,
    })) &&
    (job.project?.managerId === user.id ||
      user.baseRole === "MANAGER" ||
      user.baseRole === "ADMINISTRATOR" ||
      job.assignments.some(
        (assignment) =>
          assignment.supervisorId === user.id ||
          assignment.user.directSupervisorId === user.id,
      ));
  if (!allowed) notFound();

  const budget = jobTerms(job);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <PageHeader
        title={`${job.title} — Revisit planner`}
        backHref={await portalBackHref(job.id, user)}
        description={job.intWoId}
      />

      <Card>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Creates a new job carrying the same internal number with an -R
            suffix, in the month the revisit happens. Everything on this job
            comes across; change what is different about the trip on the
            revisit.
          </p>
          <RevisitPanel
            jobId={job.id}
            jobTitle={job.title}
            externalAssignmentId={job.externalAssignmentId}
            canAssign={can(user, "job.assign")}
            crew={job.assignments.map((assignment) => ({
              id: assignment.user.id,
              name: assignment.user.name,
              isLead: assignment.isLead,
            }))}
            source={{
              scope: Boolean(job.scopeOfWork?.trim()),
              deliverables: job.deliverablesOwn
                ? job.deliverableRules.length
                : 0,
              locations: job._count.locations,
              tickets: [
                job.ticketNumber,
                ...job.extraTickets.map((row) => row.number),
                job.incNumber ? `INC ${job.incNumber}` : null,
              ].filter((value): value is string => Boolean(value)),
              estimate: [
                job.estimateMinutes
                  ? `${decimalHours(job.estimateMinutes)} hrs`
                  : null,
                `${job.techsRequired} tech${job.techsRequired === 1 ? "" : "s"}`,
              ]
                .filter(Boolean)
                .join(" · "),
              pay: [
                budget
                  ? `Budget ${describeTerms(budget)}`
                  : job.payType
                    ? `${formatRate(job.payType, job.payRate?.toString() ?? "0")} for the crew`
                    : "Each tech's own rate",
                `breaks ${job.breakPaid ? "paid" : "unpaid"}`,
                job.travelReimbursement
                  ? `travel $${Number(job.travelReimbursement).toFixed(2)}`
                  : "no travel",
              ].join(" · "),
              dispatch: job._count.dispatchContacts,
              contacts: job._count.pointsOfContact,
              signOff: job.documents.length > 0,
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
