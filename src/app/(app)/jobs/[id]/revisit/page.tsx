import { redirect, notFound } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
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
          />
        </CardContent>
      </Card>
    </div>
  );
}
