import { Mail, MapPin, Phone, Plus, Settings } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { formatPhone, telHref } from "@/lib/phone";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Markdown } from "@/components/markdown";
import { Timeline } from "@/components/timeline";
import { PageHeader } from "@/components/ui/page-header";
import { siteLabel } from "@/lib/address";
import { getCompanySettings } from "@/lib/company";
import { usDateTimeInZone } from "@/lib/datetime";
import { db } from "@/lib/db";
import { deliverableLabel } from "@/lib/deliverables";
import { formatRate } from "@/lib/money";
import { can, getSessionUser } from "@/lib/session";
import { loadTimeline } from "@/lib/timeline-data";
import { ProjectJobs } from "./project-jobs";

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

/** One labelled fact. */
function Fact({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className={mono ? "tabular text-sm" : "text-sm"}>
        {value ?? <span className="text-muted-foreground">—</span>}
      </div>
    </div>
  );
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

  const project = await db.project.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      externalProjectId: true,
      status: true,
      intWoCounter: true,
      generalScopeOfWork: true,
      breakPaid: true,
      travelReimbursement: true,
      defaultJobTitle: true,
      defaultPayType: true,
      defaultPayRate: true,
      client: { select: { id: true, name: true } },
      customer: { select: { id: true, name: true, code: true } },
      manager: { select: { id: true, name: true } },
      pmContact: {
        select: { name: true, title: true, phone: true, email: true },
      },
      members: {
        orderBy: { role: "asc" },
        select: {
          userId: true,
          role: true,
          user: { select: { name: true, baseRole: true } },
        },
      },
      deliverableRules: {
        where: { jobId: null, enabled: true },
        orderBy: { order: "asc" },
        select: { category: true, customLabel: true, required: true },
      },
      dispatchContacts: {
        orderBy: { order: "asc" },
        select: { id: true, label: true, name: true, phone: true, email: true },
      },
      jobs: {
        orderBy: [{ scheduledStart: "asc" }, { createdAt: "desc" }],
        select: {
          id: true,
          intWoId: true,
          title: true,
          externalAssignmentId: true,
          scheduledStart: true,
          lifecycle: true,
          outcome: true,
          customer: { select: { code: true } },
          site: {
            select: {
              siteNumber: true,
              numberPending: true,
              city: true,
              state: true,
              timeZone: true,
            },
          },
          assignments: {
            orderBy: { isLead: "desc" },
            select: { user: { select: { name: true } } },
          },
        },
      },
    },
  });

  if (!project) notFound();

  const company = await getCompanySettings();
  const timeline = await loadTimeline(
    { projectId: project.id },
    company.defaultTimeZone,
  );

  const jobs = project.jobs.map((job) => {
    const zone = job.site.timeZone ?? company.defaultTimeZone;
    return {
      id: job.id,
      intWoId: job.intWoId,
      title: job.title,
      externalAssignmentId: job.externalAssignmentId,
      siteLabel: job.site.numberPending
        ? `${job.customer.code} — number pending`
        : siteLabel(job.customer.code, job.site.siteNumber),
      city: job.site.city,
      state: job.site.state,
      scheduledLabel: job.scheduledStart
        ? usDateTimeInZone(job.scheduledStart, zone)
        : null,
      lifecycle: job.lifecycle,
      outcome: job.outcome,
      crew: job.assignments.map((assignment) => assignment.user.name),
    };
  });

  const required = project.deliverableRules.filter((rule) => rule.required);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <PageHeader
        title={project.name}
        backHref="/projects"
        description={`Next work order in this project: #${String(project.intWoCounter + 1).padStart(4, "0")}`}
        actions={
          <>
            <Link
              href={`/projects/${project.id}/settings`}
              className={buttonVariants({ variant: "secondary", size: "sm" })}
            >
              <Settings /> Settings
            </Link>
            <Link
              href="/jobs/new"
              className={buttonVariants({ size: "sm" })}
            >
              <Plus /> New job
            </Link>
          </>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Overview</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Fact label="Representing company" value={project.client.name} />
          <Fact
            label="Customer"
            value={
              project.customer
                ? `${project.customer.name} (${project.customer.code})`
                : "Any"
            }
          />
          <Fact
            label="Their project ID"
            value={project.externalProjectId ?? "0000"}
            mono
          />
          <Fact
            label="Status"
            value={
              <Badge
                variant={
                  project.status === "ACTIVE"
                    ? "success"
                    : project.status === "ON_HOLD"
                      ? "warning"
                      : "neutral"
                }
              >
                {project.status === "ON_HOLD"
                  ? "On hold"
                  : project.status === "ACTIVE"
                    ? "Active"
                    : "Closed"}
              </Badge>
            }
          />
          <Fact label="Jobs" value={String(jobs.length)} mono />
          <Fact
            label="Project manager"
            value={project.manager?.name ?? "Not set"}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Rep Company PM/PC</CardTitle>
          <CardDescription>
            Their coordinator, not ours. Recorded onto each job as it is raised.
            The client-facing report carries the name only.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {project.pmContact ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <span className="font-medium">{project.pmContact.name}</span>
              {project.pmContact.title ? (
                <span className="text-muted-foreground">
                  {project.pmContact.title}
                </span>
              ) : null}
              {project.pmContact.phone ? (
                <a
                  href={telHref(project.pmContact.phone)}
                  className="flex items-center gap-1 text-primary underline-offset-4 hover:underline"
                >
                  <Phone className="size-3.5" /> {formatPhone(project.pmContact.phone)}
                </a>
              ) : null}
              {project.pmContact.email ? (
                <a
                  href={`mailto:${project.pmContact.email}`}
                  className="flex items-center gap-1 text-primary underline-offset-4 hover:underline"
                >
                  <Mail className="size-3.5" /> {project.pmContact.email}
                </a>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Nobody recorded. Set it in Settings so a tech at a locked door has
              somebody to ring.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Job defaults</CardTitle>
          <CardDescription>
            What a job under this project starts as. Change them in Settings.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Fact
            label="Job title"
            value={project.defaultJobTitle ?? "Not prefilled"}
          />
          <Fact label="Paid Breaks" value={project.breakPaid ? "Yes" : "No"} />
          <Fact
            label="Travel reimbursement"
            value={
              project.travelReimbursement
                ? `$${Number(project.travelReimbursement).toFixed(2)}`
                : "None"
            }
          />
          <Fact
            label="Default pay"
            value={
              project.defaultPayType
                ? formatRate(
                    project.defaultPayType,
                    project.defaultPayRate?.toString() ?? "0",
                  )
                : "Each tech's own rate"
            }
          />
          <Fact
            label="Required deliverables"
            value={
              required.length > 0
                ? required
                    .map((rule) =>
                      deliverableLabel(rule.category, rule.customLabel),
                    )
                    .join(", ")
                : "None"
            }
          />
          <Fact
            label="Dispatch contacts"
            value={
              project.dispatchContacts.length > 0
                ? String(project.dispatchContacts.length)
                : "None"
            }
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Crew</CardTitle>
          <CardDescription>
            Everybody with PROJECT-scoped access here. Offered first when a job
            in this project is crewed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {project.members.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nobody yet.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {project.members.map((member) => (
                <span
                  key={member.userId}
                  className="flex items-center gap-2 rounded-lg border border-border px-2 py-1 text-sm"
                >
                  {member.user.name}
                  <Badge
                    variant={
                      member.role === "PROJECT_MANAGER" ? "primary" : "neutral"
                    }
                  >
                    {member.role === "PROJECT_MANAGER"
                      ? "PM"
                      : member.role.toLowerCase()}
                  </Badge>
                </span>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {project.generalScopeOfWork ? (
        <Card>
          <CardHeader>
            <CardTitle>General scope of work</CardTitle>
            <CardDescription>
              Shown above each job&rsquo;s own scope.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Markdown source={project.generalScopeOfWork} />
          </CardContent>
        </Card>
      ) : null}

      {project.dispatchContacts.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Dispatch contacts</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {project.dispatchContacts.map((contact) => (
              <div
                key={contact.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border p-2 text-sm"
              >
                <span className="font-medium">{contact.label}</span>
                {contact.name ? (
                  <span className="text-muted-foreground">{contact.name}</span>
                ) : null}
                {contact.phone ? (
                  <a
                    href={telHref(contact.phone)}
                    className="flex items-center gap-1 text-primary underline-offset-4 hover:underline"
                  >
                    <Phone className="size-3.5" /> {formatPhone(contact.phone)}
                  </a>
                ) : null}
                {contact.email ? (
                  <a
                    href={`mailto:${contact.email}`}
                    className="flex items-center gap-1 text-primary underline-offset-4 hover:underline"
                  >
                    <Mail className="size-3.5" /> {contact.email}
                  </a>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Jobs</CardTitle>
          <CardDescription>
            <MapPin className="mr-1 inline size-3.5" />
            What is still coming, and what is behind us.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProjectJobs jobs={jobs} />
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
