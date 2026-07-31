import { notFound, redirect } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { db } from "@/lib/db";
import { DELIVERABLE_ORDER } from "@/lib/deliverables";
import { can, getSessionUser } from "@/lib/session";
import { ProjectForm } from "../../project-form";
import { DeliverableRules } from "../deliverable-rules";
import { DispatchContacts } from "../dispatch-contacts";
import { JobSettingsForm } from "../job-settings-form";
import { ProjectMembers } from "../project-members";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await db.project.findUnique({
    where: { id },
    select: { name: true },
  });
  return { title: project ? `${project.name} settings` : "Project settings" };
}

/**
 * Everything that configures a project, off the page people actually use.
 *
 * The overview is read a hundred times for every once these are changed, so
 * they no longer share a screen with it.
 */
export default async function ProjectSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/signin");

  const { id } = await params;
  if (!can(user, "project.manage", { projectId: id })) redirect("/projects");

  const [project, clients, customers, managers, staff, contacts] =
    await Promise.all([
      db.project.findUnique({
        where: { id },
        select: {
          id: true,
          name: true,
          externalProjectId: true,
          clientId: true,
          client: { select: { name: true } },
          customerId: true,
          managerId: true,
          pmContactId: true,
          generalScopeOfWork: true,
          travelReimbursement: true,
          breakPaid: true,
          defaultJobTitle: true,
          defaultPayType: true,
          defaultPayRate: true,
          status: true,
          members: {
            orderBy: { role: "asc" },
            select: {
              userId: true,
              role: true,
              user: { select: { name: true, email: true, baseRole: true } },
            },
          },
          deliverableRules: {
            where: { jobId: null },
            select: {
              category: true,
              customLabel: true,
              enabled: true,
              required: true,
              requiresPhoto: true,
              requiresText: true,
            },
          },
          dispatchContacts: {
            orderBy: { order: "asc" },
            select: {
              id: true,
              label: true,
              name: true,
              phone: true,
              email: true,
              note: true,
            },
          },
        },
      }),
      db.client.findMany({
        where: { active: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      db.customer.findMany({
        where: { active: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true, code: true },
      }),
      db.user.findMany({
        where: { active: true, baseRole: { in: ["SUPERVISOR", "MANAGER"] } },
        orderBy: { name: "asc" },
        select: { id: true, name: true, baseRole: true },
      }),
      db.user.findMany({
        where: { active: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true, baseRole: true },
      }),
      db.externalContact.findMany({
        where: { active: true },
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          title: true,
          phone: true,
          email: true,
          clientId: true,
        },
      }),
    ]);

  if (!project) notFound();

  // Categories with no stored row yet still need a switch to turn on.
  const rulesByCategory = new Map(
    project.deliverableRules.map((rule) => [rule.category, rule]),
  );
  const rules = DELIVERABLE_ORDER.map((category) => {
    const stored = rulesByCategory.get(category);
    return {
      category,
      customLabel: stored?.customLabel ?? null,
      enabled: stored?.enabled ?? false,
      required: stored?.required ?? false,
      requiresPhoto: stored?.requiresPhoto ?? true,
      requiresText: stored?.requiresText ?? false,
    };
  });

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <PageHeader
        title="Project settings"
        backHref={`/projects/${project.id}`}
        description={project.name}
      />

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent>
          <ProjectForm
            project={{
              id: project.id,
              name: project.name,
              externalProjectId: project.externalProjectId,
              clientId: project.clientId,
              customerId: project.customerId,
              managerId: project.managerId,
              pmContactId: project.pmContactId,
              generalScopeOfWork: project.generalScopeOfWork,
              travelReimbursement:
                project.travelReimbursement?.toString() ?? null,
              breakPaid: project.breakPaid,
              status: project.status,
            }}
            clients={clients.map((client) => ({
              id: client.id,
              label: client.name,
            }))}
            customers={customers.map((customer) => ({
              id: customer.id,
              label: `${customer.name} (${customer.code})`,
            }))}
            managers={managers.map((manager) => ({
              id: manager.id,
              label: `${manager.name} · ${manager.baseRole}`,
            }))}
            contacts={contacts}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
          <CardDescription>
            Supervisors and project managers here get PROJECT-scoped access to
            this project&rsquo;s jobs. Pay approval is unaffected — that always
            follows each tech&rsquo;s direct supervisor.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProjectMembers
            projectId={project.id}
            managerId={project.managerId}
            members={project.members.map((member) => ({
              userId: member.userId,
              role: member.role,
              name: member.user.name,
              email: member.user.email,
              baseRole: member.user.baseRole,
            }))}
            candidates={staff.map((person) => ({
              id: person.id,
              label: `${person.name} · ${person.baseRole}`,
            }))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>In Project Jobs Settings</CardTitle>
          <CardDescription>
            How every job raised under this project starts out. All of it stays
            editable on the job itself.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <JobSettingsForm
            clientName={project.client.name}
            project={{
              id: project.id,
              breakPaid: project.breakPaid,
              defaultJobTitle: project.defaultJobTitle,
              travelReimbursement:
                project.travelReimbursement?.toString() ?? null,
              defaultPayType: project.defaultPayType,
              defaultPayRate: project.defaultPayRate?.toString() ?? null,
            }}
          />

          <div className="border-t border-border pt-4">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Dispatch contacts
            </div>
            <p className="mb-3 text-xs text-muted-foreground">
              Bridge numbers and inboxes a tech may need mid-job. Their own
              supervisor is always shown first and does not need adding here.
            </p>
            <DispatchContacts
              projectId={project.id}
              contacts={project.dispatchContacts}
            />
          </div>

          <div className="border-t border-border pt-4">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Deliverables Requirements
            </div>
            <p className="mb-3 text-xs text-muted-foreground">
              What a tech has to produce before checkout will let them finish.
              A job can override these while it is being planned.
            </p>
            <DeliverableRules projectId={project.id} rules={rules} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
