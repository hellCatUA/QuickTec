import { notFound, redirect } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Timeline } from "@/components/timeline";
import { PageHeader } from "@/components/ui/page-header";
import { getCompanySettings } from "@/lib/company";
import { db } from "@/lib/db";
import { DELIVERABLE_ORDER } from "@/lib/deliverables";
import { can, getSessionUser } from "@/lib/session";
import { loadTimeline } from "@/lib/timeline-data";
import { ProjectForm } from "../project-form";
import { DeliverableRules } from "./deliverable-rules";
import { DispatchContacts } from "./dispatch-contacts";
import { ProjectMembers } from "./project-members";

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
  return { title: project?.name ?? "Project" };
}

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/signin");

  const { id } = await params;
  const canManage = can(user, "project.manage", { projectId: id });
  if (!canManage) redirect("/projects");

  const [project, clients, customers, managers, staff] = await Promise.all([
    db.project.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        externalProjectId: true,
        clientId: true,
        customerId: true,
        managerId: true,
        generalScopeOfWork: true,
        travelReimbursement: true,
        breakPaid: true,
        status: true,
        intWoCounter: true,
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
            id: true,
            category: true,
            customLabel: true,
            enabled: true,
            required: true,
            requiresPhoto: true,
            requiresText: true,
            order: true,
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
  ]);

  if (!project) notFound();

  const company = await getCompanySettings();
  const timeline = await loadTimeline(
    { projectId: project.id },
    company.defaultTimeZone,
  );

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
        title={project.name}
        backHref="/projects"
        description={`Next work order in this project: #${String(project.intWoCounter + 1).padStart(4, "0")}`}
      />

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent>
          <ProjectForm
            project={{
              ...project,
              travelReimbursement:
                project.travelReimbursement?.toString() ?? null,
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
          <CardTitle>Deliverables</CardTitle>
          <CardDescription>
            Defaults for jobs in this project. A job can override them while it
            is being planned.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DeliverableRules projectId={project.id} rules={rules} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Dispatch contacts</CardTitle>
          <CardDescription>
            Bridge numbers and inboxes a tech may need mid-job. Their own
            supervisor is always shown first and does not need adding here.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DispatchContacts
            projectId={project.id}
            contacts={project.dispatchContacts}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Timeline</CardTitle>
          <CardDescription>
            Everything that has happened to this project, newest first. Runs of
            the same thing collapse — tap to open them.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Timeline rows={timeline} />
        </CardContent>
      </Card>
    </div>
  );
}
