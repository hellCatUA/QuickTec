import { redirect, notFound } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { decimalHours } from "@/lib/datetime";
import { db } from "@/lib/db";
import { canOnJob } from "@/lib/scope";
import { can, getSessionUser } from "@/lib/session";
import { RevisitPanel } from "../revisit-panel";

export const metadata = { title: "Schedule a revisit" };

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
      extraTickets: { orderBy: { order: "asc" }, select: { number: true } },
      _count: { select: { deliverableRules: true, dispatchContacts: true } },
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

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <PageHeader
        title={`${job.title} — Schedule a revisit`}
        backHref={`/jobs/${job.id}`}
        description={job.intWoId}
      />

      <Card>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Creates a new job carrying the same internal number with an -R
            suffix, in the month the revisit happens. Site, scope, deliverable
            rules and the crew are copied across.
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
              deliverables: job._count.deliverableRules,
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
              pay:
                job.payType && job.payRate
                  ? `${job.payType} ${job.payRate}, breaks ${job.breakPaid ? "paid" : "unpaid"}`
                  : `No pay set on the job — breaks ${job.breakPaid ? "paid" : "unpaid"}.`,
              dispatch: job._count.dispatchContacts,
              signOff: job.documents.length > 0,
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
