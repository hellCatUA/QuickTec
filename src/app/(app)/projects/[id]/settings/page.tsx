import { notFound, redirect } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DeliverableRules } from "@/components/deliverable-rules";
import { PageHeader } from "@/components/ui/page-header";
import { db } from "@/lib/db";
import {
  deliverableLabel,
  effectiveRules,
  locationCounts,
  RULE_SELECT,
  ruleKey,
} from "@/lib/deliverables";
import { OPEN_LIFECYCLES } from "@/lib/job-status";
import { jobsNumberedWith } from "@/lib/project-code";
import { canOnProject } from "@/lib/scope";
import { can, getSessionUser } from "@/lib/session";
import { ProjectForm } from "../../project-form";
import { saveDeliverableRule } from "../../actions";
import { DispatchPanel } from "../../../jobs/[id]/dispatch-panel";
import { ProjectLocations } from "../project-locations";
import { ProjectTemplates } from "../project-templates";
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
  if (!canOnProject(user, "project.manage", id)) redirect("/projects");
  // Pay and travel are money: shown and changed only by whoever sets pay.
  const canSetPay = can(user, "pay.edit_rates");

  const [project, clients, repCompanies, customers, managers, staff, contacts] =
    await Promise.all([
      db.project.findUnique({
        where: { id },
        select: {
          id: true,
          name: true,
          code: true,
          clientProjectName: true,
          externalProjectId: true,
          repProjectName: true,
          repProjectId: true,

          clientId: true,
          client: { select: { name: true } },
          repCompanyId: true,
          repCompany: { select: { name: true } },
          customerId: true,
          managerId: true,
          pmContactId: true,
          generalScopeOfWork: true,
          travelReimbursement: true,
          breakPaid: true,
          defaultJobTitle: true,
          defaultPayType: true,
          defaultPayRate: true,
          defaultBudgetType: true,
          defaultBudgetFlat: true,
          defaultBudgetFlatHours: true,
          defaultBudgetHourly: true,
          defaultBudgetSplit: true,
          ownTemplates: true,
          templates: { select: { id: true } },
          locations: {
            orderBy: [{ order: "asc" }, { createdAt: "asc" }],
            select: { id: true, name: true, icon: true, fields: true, minPhotos: true },
          },
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
            select: RULE_SELECT,
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
      db.repCompany.findMany({
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

  // The dictionary the rooms are picked from, the paying company's blanks,
  // and how many jobs a company change could still reach.
  const [known, templates, openJobs] = await Promise.all([
    db.knownLocation.findMany({
      where: { active: true },
      orderBy: [{ order: "asc" }, { label: "asc" }],
      select: { label: true, icon: true },
    }),
    db.clientDocumentTemplate.findMany({
      where: { clientId: project.clientId, active: true },
      orderBy: [{ isDefault: "desc" }, { label: "asc" }],
      select: { id: true, label: true, kind: true, isDefault: true },
    }),
    db.job.count({
      where: {
        projectId: project.id,
        lifecycle: { in: [...OPEN_LIFECYCLES, "DRAFT"] },
      },
    }),
  ]);

  // The sheet its jobs answer to, sections that are off included. A project
  // nothing has been saved on yet shows the defaults its jobs are using, not
  // a list with everything off that no job actually follows.
  const rules = effectiveRules([], project.deliverableRules);

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
              code: project.code,
              codeLocked: (await jobsNumberedWith(project.id, project.code)) > 0,
              openJobs,
              clientProjectName: project.clientProjectName,
              externalProjectId: project.externalProjectId,
              repProjectName: project.repProjectName,
              repProjectId: project.repProjectId,
              clientId: project.clientId,
              repCompanyId: project.repCompanyId,
              customerId: project.customerId,
              managerId: project.managerId,
              pmContactId: project.pmContactId,
              generalScopeOfWork: project.generalScopeOfWork,
              status: project.status,
            }}
            // A company since retired from the directory still shows as what
            // the project holds, rather than as nothing picked.
            clients={[
              ...clients,
              ...(!clients.some((one) => one.id === project.clientId)
                ? [{ id: project.clientId, name: project.client.name }]
                : []),
            ].map((client) => ({
              id: client.id,
              label: client.name,
            }))}
            repCompanies={[
              ...repCompanies,
              ...(project.repCompanyId &&
              project.repCompany &&
              !repCompanies.some((one) => one.id === project.repCompanyId)
                ? [{ id: project.repCompanyId, name: project.repCompany.name }]
                : []),
            ].map((repCompany) => ({
              id: repCompany.id,
              label: repCompany.name,
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
          <CardTitle>Job Settings</CardTitle>
          <CardDescription>
            How every job raised under this project starts out. All of it stays
            editable on the job itself.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <JobSettingsForm
            clientName={project.client.name}
            repCompanyName={project.repCompany?.name ?? null}
            canSetPay={canSetPay}
            project={{
              id: project.id,
              breakPaid: project.breakPaid,
              defaultJobTitle: project.defaultJobTitle,
              travelReimbursement:
                project.travelReimbursement?.toString() ?? null,
              defaultPayType: project.defaultPayType,
              defaultPayRate: project.defaultPayRate?.toString() ?? null,
              defaultBudgetType: project.defaultBudgetType,
              defaultBudgetFlat: project.defaultBudgetFlat?.toString() ?? null,
              defaultBudgetFlatHours:
                project.defaultBudgetFlatHours?.toString() ?? null,
              defaultBudgetHourly: project.defaultBudgetHourly?.toString() ?? null,
              defaultBudgetSplit: project.defaultBudgetSplit,
            }}
          />

          <div className="border-t border-border pt-4">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Paperwork
            </div>
            <p className="mb-3 text-xs text-muted-foreground">
              Which of the paying company&rsquo;s blanks a new job here starts
              with. Still changeable on the job before it is created.
            </p>
            {/* Keyed by the company: a change of paying company resets the
                choice on the server, and the form must start again from it. */}
            <ProjectTemplates
              key={project.clientId}
              projectId={project.id}
              clientName={project.client.name}
              templates={templates}
              own={project.ownTemplates}
              chosen={project.templates.map((template) => template.id)}
            />
          </div>

          <div className="border-t border-border pt-4">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Dispatch contacts
            </div>
            <p className="mb-3 text-xs text-muted-foreground">
              Bridge numbers and inboxes a tech may need mid-job. Their own
              supervisor is always shown first and does not need adding here.
            </p>
            <DispatchPanel
              projectId={project.id}
              canEdit
              contacts={project.dispatchContacts.map((contact) => ({
                ...contact,
                removable: true,
              }))}
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
            <DeliverableRules
              owner={{ field: "projectId", id: project.id }}
              rules={rules}
              save={saveDeliverableRule}
            />
          </div>

          <div className="border-t border-border pt-4">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Locations
            </div>
            <p className="mb-3 text-xs text-muted-foreground">
              The rooms every job here starts with, so the crew does not name
              them again at every site — which fields each is photographed in,
              and how many photos it needs if not the field&rsquo;s number.
              Jobs already raised keep their own.
            </p>
            <ProjectLocations
              projectId={project.id}
              locations={project.locations.map((location) => ({
                id: location.id,
                name: location.name,
                icon: location.icon,
                fields: location.fields,
                minPhotos: locationCounts(location.minPhotos),
              }))}
              fields={rules
                .filter(
                  (rule) => rule.enabled && rule.perLocation && rule.requiresPhoto,
                )
                .map((rule) => ({
                  key: ruleKey(rule),
                  label: deliverableLabel(rule.category, rule.customLabel),
                  minPhotos: rule.minPhotos,
                  required: rule.required,
                }))}
              known={known}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
