import { CircleCheck, MapPin } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { formatAddress, mapsUrl, siteLabel } from "@/lib/address";
import { getCompanySettings, intWoFieldLabel } from "@/lib/company";
import { usDateTimeInZone } from "@/lib/datetime";
import { db } from "@/lib/db";
import { deliverableLabel, resolveDeliverableRules } from "@/lib/deliverables";
import {
  INTERNAL_STATUS_META,
  LIFECYCLE_META,
  OUTCOME_META,
} from "@/lib/job-status";
import { formatRate } from "@/lib/pay-rates";
import { canOnJob } from "@/lib/scope";
import { can, getSessionUser } from "@/lib/session";
import { approveJob } from "../actions";
import { RevisitPanel } from "./revisit-panel";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const job = await db.job.findUnique({
    where: { id },
    select: { title: true, intWoId: true },
  });
  return { title: job ? `${job.title} · ${job.intWoId}` : "Job" };
}

export default async function JobPage({
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
      intWoId: true,
      title: true,
      externalAssignmentId: true,
      ticketNumber: true,
      incNumber: true,
      scheduledStart: true,
      estimateMinutes: true,
      techsRequired: true,
      scopeOfWork: true,
      breakPaid: true,
      lifecycle: true,
      outcome: true,
      internalStatus: true,
      revisitNumber: true,
      createdById: true,
      createdAt: true,
      createdBy: { select: { name: true } },
      parentJob: { select: { id: true, intWoId: true, title: true } },
      revisits: {
        orderBy: { revisitNumber: "asc" },
        select: { id: true, intWoId: true, revisitNumber: true, lifecycle: true },
      },
      client: { select: { name: true } },
      customer: { select: { code: true, name: true } },
      site: {
        select: {
          siteNumber: true,
          name: true,
          addressLine1: true,
          addressLine2: true,
          city: true,
          state: true,
          postalCode: true,
          country: true,
          timeZone: true,
          notes: true,
        },
      },
      project: {
        select: {
          id: true,
          name: true,
          externalProjectId: true,
          generalScopeOfWork: true,
          deliverableRules: {
            where: { jobId: null },
            select: {
              category: true,
              customLabel: true,
              enabled: true,
              required: true,
              requiresPhoto: true,
              requiresText: true,
              order: true,
            },
          },
        },
      },
      deliverableRules: {
        where: { projectId: null },
        select: {
          category: true,
          customLabel: true,
          enabled: true,
          required: true,
          requiresPhoto: true,
          requiresText: true,
          order: true,
        },
      },
      assignments: {
        orderBy: { isLead: "desc" },
        select: {
          id: true,
          isLead: true,
          payType: true,
          payRate: true,
          payRateNote: true,
          travelReimbursement: true,
          user: { select: { id: true, name: true, baseRole: true } },
          supervisor: { select: { name: true } },
        },
      },
    },
  });

  if (!job) notFound();

  const assigneeIds = job.assignments.map((a) => a.user.id);
  const jobRef = {
    projectId: job.project?.id ?? null,
    assigneeIds,
    createdById: job.createdById,
  };

  if (!(await canOnJob(user, "job.view", jobRef))) notFound();

  const company = await getCompanySettings();
  const zone = job.site.timeZone ?? company.defaultTimeZone;

  const showPay = await canOnJob(user, "pay.view_rates", jobRef);
  const canApprove =
    job.lifecycle === "PENDING_APPROVAL" &&
    (await canOnJob(user, "job.approve_report", jobRef));

  const rules = resolveDeliverableRules(
    job.deliverableRules,
    job.project?.deliverableRules ?? [],
  );

  const timeline = await db.auditEvent.findMany({
    where: { jobId: job.id },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: {
      id: true,
      action: true,
      createdAt: true,
      actor: { select: { name: true } },
    },
  });

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <PageHeader
        title={job.title}
        backHref="/jobs"
        description={`${intWoFieldLabel(company)}: ${job.intWoId}`}
        actions={
          canApprove ? (
            <form
              action={async (formData: FormData) => {
                "use server";
                await approveJob(formData);
              }}
            >
              <input type="hidden" name="jobId" value={job.id} />
              <Button type="submit" size="sm" variant="success">
                <CircleCheck /> Approve
              </Button>
            </form>
          ) : null
        }
      />

      <div className="flex flex-wrap gap-1.5">
        <Badge variant={LIFECYCLE_META[job.lifecycle].variant}>
          {LIFECYCLE_META[job.lifecycle].label}
        </Badge>
        {job.outcome ? (
          <Badge variant={OUTCOME_META[job.outcome].variant}>
            {OUTCOME_META[job.outcome].label}
          </Badge>
        ) : null}
        {job.internalStatus ? (
          <Badge variant={INTERNAL_STATUS_META[job.internalStatus].variant}>
            {INTERNAL_STATUS_META[job.internalStatus].label}
          </Badge>
        ) : null}
        {job.revisitNumber ? (
          <Badge variant="warning">Revisit {job.revisitNumber}</Badge>
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Assignment details</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
          <Detail label="Company" value={job.client.name} />
          <Detail label="Customer" value={job.customer.name} />
          <Detail
            label="Site ID"
            value={siteLabel(job.customer.code, job.site.siteNumber)}
          />
          <Detail
            label={intWoFieldLabel(company)}
            value={job.intWoId}
            mono
          />
          <Detail label="Assignment ID" value={job.externalAssignmentId} />
          <Detail label="Ticket #" value={job.ticketNumber} />
          <Detail label="INC #" value={job.incNumber} />
          <Detail
            label="Project"
            value={
              job.project
                ? `${job.project.name}${job.project.externalProjectId ? ` (${job.project.externalProjectId})` : ""}`
                : null
            }
          />

          <div className="sm:col-span-2">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Address
            </div>
            <a
              href={mapsUrl(job.site)}
              target="_blank"
              rel="noreferrer"
              className="mt-0.5 flex items-center gap-1 text-primary underline-offset-4 hover:underline"
            >
              <MapPin className="size-3.5 shrink-0" />
              {formatAddress(job.site)}
            </a>
            {job.site.notes ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {job.site.notes}
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Schedule</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-3">
          <Detail
            label="Scheduled"
            value={
              job.scheduledStart
                ? usDateTimeInZone(job.scheduledStart, zone)
                : null
            }
          />
          <Detail
            label="Estimate"
            value={
              job.estimateMinutes
                ? `${(job.estimateMinutes / 60).toFixed(2)} hrs`
                : null
            }
          />
          <Detail
            label="Techs"
            value={`${job.assignments.length} of ${job.techsRequired}`}
          />
          <Detail label="Time zone" value={zone} />
          <Detail label="Breaks" value={job.breakPaid ? "Paid" : "Unpaid"} />
        </CardContent>
      </Card>

      {job.project?.generalScopeOfWork || job.scopeOfWork ? (
        <Card>
          <CardHeader>
            <CardTitle>Scope of work</CardTitle>
            <CardDescription>
              Rich formatting and tickable checklists arrive with the job working
              page.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 text-sm">
            {job.project?.generalScopeOfWork ? (
              <div>
                <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Project general scope
                </div>
                <pre className="whitespace-pre-wrap font-sans">
                  {job.project.generalScopeOfWork}
                </pre>
              </div>
            ) : null}
            {job.scopeOfWork ? (
              <div>
                <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  This job
                </div>
                <pre className="whitespace-pre-wrap font-sans">
                  {job.scopeOfWork}
                </pre>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Assigned techs</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {job.assignments.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nobody assigned yet.</p>
          ) : (
            job.assignments.map((assignment) => (
              <div
                key={assignment.id}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-sm"
              >
                <span className="font-medium">{assignment.user.name}</span>
                {assignment.isLead ? (
                  <Badge variant="primary">Lead</Badge>
                ) : null}
                <span className="text-xs text-muted-foreground">
                  Approver: {assignment.supervisor?.name ?? "not set"}
                </span>
                {showPay ? (
                  <span className="ml-auto text-xs">
                    {formatRate(assignment.payType, assignment.payRate.toString())}
                    {assignment.travelReimbursement
                      ? ` · travel $${Number(assignment.travelReimbursement).toFixed(2)}`
                      : ""}
                    {assignment.payRateNote ? (
                      <span className="ml-1 text-warning">
                        {assignment.payRateNote}
                      </span>
                    ) : null}
                  </span>
                ) : null}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Deliverables required</CardTitle>
          <CardDescription>
            Uploading arrives with the job working page.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-1.5">
          {rules.length === 0 ? (
            <p className="text-sm text-muted-foreground">None configured.</p>
          ) : (
            rules.map((rule) => (
              <Badge
                key={rule.category}
                variant={rule.required ? "warning" : "neutral"}
              >
                {deliverableLabel(rule.category, rule.customLabel)}
                {rule.required ? " · required" : ""}
              </Badge>
            ))
          )}
        </CardContent>
      </Card>

      {job.parentJob || job.revisits.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Revisit chain</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {job.parentJob ? (
              <Link
                href={`/jobs/${job.parentJob.id}`}
                className="text-primary underline-offset-4 hover:underline"
              >
                Original: {job.parentJob.intWoId} — {job.parentJob.title}
              </Link>
            ) : null}
            {job.revisits.map((revisit) => (
              <Link
                key={revisit.id}
                href={`/jobs/${revisit.id}`}
                className="text-primary underline-offset-4 hover:underline"
              >
                Revisit {revisit.revisitNumber}: {revisit.intWoId} ·{" "}
                {LIFECYCLE_META[revisit.lifecycle].label}
              </Link>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {can(user, "job.create") ? (
        <RevisitPanel
          jobId={job.id}
          jobTitle={job.title}
          externalAssignmentId={job.externalAssignmentId}
        />
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Timeline</CardTitle>
          <CardDescription>
            Created by {job.createdBy.name} on{" "}
            {usDateTimeInZone(job.createdAt, zone)}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          {timeline.map((event) => (
            <div key={event.id} className="flex flex-wrap gap-2">
              <span className="tabular text-xs text-muted-foreground">
                {usDateTimeInZone(event.createdAt, zone)}
              </span>
              <span>{event.action.replace(/_/g, " ")}</span>
              <span className="text-xs text-muted-foreground">
                {event.actor?.name ?? "system"}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function Detail({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | null;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className={value ? (mono ? "tabular" : "") : "text-warning"}>
        {value ?? "Missing"}
      </div>
    </div>
  );
}
