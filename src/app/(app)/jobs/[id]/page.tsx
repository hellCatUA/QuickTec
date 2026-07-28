import { CircleCheck, Mail, MapPin, Phone } from "lucide-react";
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
import {
  toDatetimeLocalInZone,
  usDateTimeInZone,
  usTimeInZone,
} from "@/lib/datetime";
import { db } from "@/lib/db";
import { deliverableLabel, resolveDeliverableRules } from "@/lib/deliverables";
import { fieldAction, JOB_FIELDS, type JobFieldName } from "@/lib/job-fields";
import {
  INTERNAL_STATUS_META,
  LIFECYCLE_META,
  OUTCOME_META,
} from "@/lib/job-status";
import { formatRate } from "@/lib/money";
import { canOnJob } from "@/lib/scope";
import { can, getSessionUser } from "@/lib/session";
import { jobSpan } from "@/lib/time-tracking";
import { approveJob } from "../actions";
import { ChangeRequests } from "./change-requests";
import { EditableField } from "./editable-field";
import { PointsOfContact } from "./points-of-contact";
import { RevisitPanel } from "./revisit-panel";
import { ScopeOfWork } from "./scope-of-work";
import { TimeClock } from "./time-clock";
import { WorkPerformed } from "./work-performed";

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
      releaseCode: true,
      returnTrackingNumber: true,
      workPerformedMerged: true,
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
      pointsOfContact: {
        orderBy: [{ type: "asc" }, { order: "asc" }],
        select: {
          id: true,
          type: true,
          name: true,
          phone: true,
          email: true,
        },
      },
      scopeChecks: {
        where: { checked: true },
        select: { lineKey: true },
      },
      changeRequests: {
        where: { status: "PENDING" },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          fieldPath: true,
          oldValue: true,
          newValue: true,
          reason: true,
          createdAt: true,
          requestedBy: { select: { name: true } },
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
          workPerformed: true,
          user: {
            select: {
              id: true,
              name: true,
              baseRole: true,
              directSupervisor: {
                select: { name: true, phone: true, email: true },
              },
            },
          },
          supervisor: { select: { name: true } },
          visits: {
            orderBy: { clockInAt: "asc" },
            select: {
              id: true,
              clockInAt: true,
              clockOutAt: true,
              breaks: {
                select: { startAt: true, endAt: true, paid: true },
              },
            },
          },
        },
      },
    },
  });

  if (!job) notFound();

  const assigneeIds = job.assignments.map((assignment) => assignment.user.id);
  const jobRef = {
    projectId: job.project?.id ?? null,
    assigneeIds,
    createdById: job.createdById,
  };

  if (!(await canOnJob(user, "job.view", jobRef))) notFound();

  const company = await getCompanySettings();
  const zone = job.site.timeZone ?? company.defaultTimeZone;
  const now = new Date();

  const [
    showPay,
    canEditPlanned,
    canFillMissing,
    canSuggest,
    canApproveChange,
    canClockHere,
    canApproveJob,
  ] = await Promise.all([
    canOnJob(user, "pay.view_rates", jobRef),
    canOnJob(user, "job.edit_planned_fields", jobRef),
    canOnJob(user, "job.fill_missing_field", jobRef),
    canOnJob(user, "job.suggest_change", jobRef),
    canOnJob(user, "job.approve_change", jobRef),
    canOnJob(user, "job.clock_in", jobRef),
    canOnJob(user, "job.approve_report", jobRef),
  ]);

  const mine = job.assignments.find(
    (assignment) => assignment.user.id === user.id,
  );

  const allVisits = job.assignments.flatMap((assignment) => assignment.visits);
  const span = jobSpan(allVisits, now);

  const rules = resolveDeliverableRules(
    job.deliverableRules,
    job.project?.deliverableRules ?? [],
  );

  /** Read-only, editable, fill-in or suggest — decided per field. */
  function actionFor(field: JobFieldName, value: string) {
    return fieldAction({
      planned: JOB_FIELDS[field].planned,
      isEmpty: value.trim() === "",
      canEditPlanned,
      canFillMissing,
      canSuggest,
    });
  }

  function editable(field: JobFieldName, rawValue: string, display?: string) {
    return (
      <EditableField
        jobId={job!.id}
        field={field}
        label={JOB_FIELDS[field].label}
        value={rawValue}
        displayValue={display}
        action={actionFor(field, rawValue)}
        kind={JOB_FIELDS[field].kind}
      />
    );
  }

  // The tech's own supervisor always heads the dispatch block — the one number
  // they are most likely to need and least likely to have to hand.
  const supervisor = mine?.user.directSupervisor;
  const dispatch = [
    ...(supervisor
      ? [
          {
            id: "supervisor",
            label: "Your supervisor",
            name: supervisor.name,
            phone: supervisor.phone,
            email: supervisor.email,
            note: null as string | null,
          },
        ]
      : []),
    ...job.dispatchContacts,
    ...(job.project?.dispatchContacts ?? []),
  ];

  const timeline = await db.auditEvent.findMany({
    where: { jobId: job.id },
    orderBy: { createdAt: "desc" },
    take: 40,
    select: {
      id: true,
      action: true,
      detail: true,
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
          job.lifecycle === "PENDING_APPROVAL" && canApproveJob ? (
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

      {mine ? (
        <TimeClock
          jobId={job.id}
          timeZone={zone}
          intervalMinutes={company.timeRoundingMinutes}
          visits={mine.visits.map((visit) => ({
            clockInAt: visit.clockInAt.toISOString(),
            clockOutAt: visit.clockOutAt?.toISOString() ?? null,
            breaks: visit.breaks.map((entry) => ({
              startAt: entry.startAt.toISOString(),
              endAt: entry.endAt?.toISOString() ?? null,
              paid: entry.paid,
            })),
          }))}
          payType={mine.payType}
          payRate={Number(mine.payRate)}
          showPay={showPay}
          breakPaid={job.breakPaid}
          clientName={job.client.name}
          customerName={job.customer.name}
          canClock={canClockHere}
          serverNow={now.toISOString()}
        />
      ) : null}

      {job.changeRequests.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Suggested changes</CardTitle>
            <CardDescription>
              Raised by someone who cannot edit a planned field directly.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ChangeRequests
              canReview={canApproveChange}
              requests={job.changeRequests.map((request) => ({
                id: request.id,
                fieldPath: request.fieldPath,
                oldValue: request.oldValue,
                newValue: request.newValue,
                reason: request.reason,
                requestedBy: request.requestedBy.name,
                createdAt: usDateTimeInZone(request.createdAt, zone),
              }))}
            />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Assignment details</CardTitle>
          <CardDescription>
            Planned fields are read-only. Blank ones can be completed by anyone
            on the job; changing a filled one goes to a supervisor.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm sm:grid-cols-2">
          <Static label="Company" value={job.client.name} />
          <Static label="Customer" value={job.customer.name} />
          <Static
            label="Site ID"
            value={siteLabel(job.customer.code, job.site.siteNumber)}
          />
          <Static label={intWoFieldLabel(company)} value={job.intWoId} mono />

          {editable("externalAssignmentId", job.externalAssignmentId ?? "")}
          {editable("ticketNumber", job.ticketNumber ?? "")}
          {editable("incNumber", job.incNumber ?? "")}
          <Static
            label="Project"
            value={
              job.project
                ? `${job.project.name}${job.project.externalProjectId ? ` (${job.project.externalProjectId})` : ""}`
                : "No project"
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

      {dispatch.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Dispatch info</CardTitle>
            <CardDescription>
              Numbers to reach mid-job. Tap to dial.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {dispatch.map((contact) => (
              <div
                key={contact.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border p-2"
              >
                <span className="text-sm font-medium">{contact.label}</span>
                {contact.name ? (
                  <span className="text-xs text-muted-foreground">
                    {contact.name}
                  </span>
                ) : null}
                {contact.phone ? (
                  <a
                    href={`tel:${contact.phone}`}
                    className="flex items-center gap-1 text-xs text-primary underline-offset-4 hover:underline"
                  >
                    <Phone className="size-3" />
                    {contact.phone}
                  </a>
                ) : null}
                {contact.email ? (
                  <a
                    href={`mailto:${contact.email}`}
                    className="flex items-center gap-1 text-xs text-primary underline-offset-4 hover:underline"
                  >
                    <Mail className="size-3" />
                    {contact.email}
                  </a>
                ) : null}
                {contact.note ? (
                  <span className="w-full text-xs text-muted-foreground">
                    {contact.note}
                  </span>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Points of contact</CardTitle>
          <CardDescription>
            Recorded on site as you go. MOD is required to close the job.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PointsOfContact
            jobId={job.id}
            contacts={job.pointsOfContact}
            canEdit={canFillMissing}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Scope of work</CardTitle>
          {actionFor("scopeOfWork", job.scopeOfWork ?? "") !== "none" ? (
            <CardDescription>
              <EditableField
                jobId={job.id}
                field="scopeOfWork"
                label="Edit scope"
                value={job.scopeOfWork ?? ""}
                action={actionFor("scopeOfWork", job.scopeOfWork ?? "")}
                kind="markdown"
              />
            </CardDescription>
          ) : null}
        </CardHeader>
        <CardContent>
          <ScopeOfWork
            jobId={job.id}
            generalScope={job.project?.generalScopeOfWork ?? null}
            jobScope={job.scopeOfWork}
            checkedKeys={job.scopeChecks.map((check) => check.lineKey)}
            canCheck={canClockHere}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Work performed</CardTitle>
        </CardHeader>
        <CardContent>
          <WorkPerformed
            jobId={job.id}
            own={mine?.workPerformed ?? null}
            others={job.assignments
              .filter(
                (assignment) =>
                  assignment.user.id !== user.id && assignment.workPerformed,
              )
              .map((assignment) => ({
                name: assignment.user.name,
                text: assignment.workPerformed as string,
              }))}
            merged={job.workPerformedMerged}
            canWrite={Boolean(mine) && canClockHere}
            canMerge={Boolean(mine?.isLead) || canApproveJob}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Time &amp; schedule</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm sm:grid-cols-3">
          {editable(
            "scheduledStart",
            job.scheduledStart ? toDatetimeLocalInZone(job.scheduledStart, zone) : "",
            job.scheduledStart
              ? usDateTimeInZone(job.scheduledStart, zone)
              : undefined,
          )}
          {editable(
            "estimateMinutes",
            job.estimateMinutes ? String(job.estimateMinutes) : "",
            job.estimateMinutes
              ? `${(job.estimateMinutes / 60).toFixed(2)} hrs`
              : undefined,
          )}
          {editable("techsRequired", String(job.techsRequired))}

          <Static
            label="Onsite (check in)"
            value={span.onsiteAt ? usTimeInZone(span.onsiteAt, zone) : null}
          />
          <Static
            label="Offsite (check out)"
            value={
              span.offsiteAt
                ? usTimeInZone(span.offsiteAt, zone)
                : span.open
                  ? "Still on site"
                  : null
            }
          />
          <Static
            label="Total time"
            value={
              span.totalMinutes > 0
                ? `${(span.totalMinutes / 60).toFixed(2)} hrs`
                : null
            }
          />

          {editable("releaseCode", job.releaseCode ?? "")}
          {editable("returnTrackingNumber", job.returnTrackingNumber ?? "")}
          <Static label="Breaks" value={job.breakPaid ? "Paid" : "Unpaid"} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Crew</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {job.assignments.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nobody assigned yet.</p>
          ) : (
            job.assignments.map((assignment) => {
              const totals = jobSpan(assignment.visits, now);
              return (
                <div
                  key={assignment.id}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-sm"
                >
                  <span className="font-medium">{assignment.user.name}</span>
                  {assignment.isLead ? (
                    <Badge variant="primary">Lead</Badge>
                  ) : null}
                  {totals.open ? (
                    <Badge variant="success">On site</Badge>
                  ) : null}
                  <span className="text-xs text-muted-foreground">
                    Approver: {assignment.supervisor?.name ?? "not set"}
                  </span>
                  {showPay ? (
                    <span className="ml-auto text-xs">
                      {formatRate(
                        assignment.payType,
                        assignment.payRate.toString(),
                      )}
                      {assignment.travelReimbursement
                        ? ` · travel $${Number(assignment.travelReimbursement).toFixed(2)}`
                        : ""}
                    </span>
                  ) : null}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Deliverables required</CardTitle>
          <CardDescription>
            Uploading arrives with the photo pipeline.
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
          {timeline.map((event) => {
            const detail = event.detail as { field?: string } | null;
            return (
              <div key={event.id} className="flex flex-wrap items-baseline gap-2">
                <span className="tabular text-xs text-muted-foreground">
                  {usDateTimeInZone(event.createdAt, zone)}
                </span>
                <span>
                  {event.action.replace(/_/g, " ")}
                  {detail?.field ? ` · ${detail.field}` : ""}
                </span>
                <span className="text-xs text-muted-foreground">
                  {event.actor?.name ?? "system"}
                </span>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}

function Static({
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
      <div className={value ? (mono ? "tabular" : "") : "text-muted-foreground"}>
        {value ?? "—"}
      </div>
    </div>
  );
}
