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
import { loadTimeline } from "@/lib/timeline-data";
import { can, getSessionUser } from "@/lib/session";
import { loadJobForExport } from "@/lib/exports/job-data";
import { buildTextReport } from "@/lib/exports/text-report";
import { jobSpan } from "@/lib/time-tracking";
import { Timeline } from "@/components/timeline";
import { approveJob } from "../actions";
import { ChangeRequests } from "./change-requests";
import { CrewPanel } from "./crew-panel";
import { DispatchPanel } from "./dispatch-panel";
import { JobPay } from "./job-pay";
import { BreakPay } from "./break-pay";
import { JobDocuments } from "./job-documents";
import { EditableField } from "./editable-field";
import { PointsOfContact } from "./points-of-contact";
import { RevisitPanel } from "./revisit-panel";
import { ScopeOfWork } from "./scope-of-work";
import { SiteNumberPrompt } from "./site-number";
import { Deliverables } from "./deliverables";
import { ExportsPanel } from "./exports-panel";
import { Reimbursements } from "./reimbursements";
import { TimePanel } from "./time-panel";
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
      siteId: true,
      externalAssignmentId: true,
      ticketNumber: true,
      incNumber: true,
      scheduledStart: true,
      estimateMinutes: true,
      techsRequired: true,
      scopeOfWork: true,
      releaseCode: true,
      noReleaseCode: true,
      returnTrackingNumber: true,
      workPerformedMerged: true,
      breakPaid: true,
      payType: true,
      payRate: true,
      travelReimbursement: true,
      noWorkOrder: true,
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
      pmContact: {
        select: { name: true, title: true, phone: true, email: true },
      },
      documents: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          originalName: true,
          sizeBytes: true,
          jobDocumentKind: true,
          generated: true,
          // A blank whose boxes somebody mapped is one the job can fill in
          // itself. Counted here so the page knows whether to offer it.
          sourceTemplate: {
            select: {
              _count: { select: { placements: { where: { source: { not: null } } } } },
            },
          },
        },
      },
      customer: { select: { code: true, name: true } },
      site: {
        select: {
          siteNumber: true,
          numberPending: true,
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
      deliverables: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          category: true,
          customLabel: true,
          textValue: true,
          assignment: { select: { userId: true, user: { select: { name: true } } } },
          attachments: {
            select: { id: true, mimeType: true, originalName: true },
          },
        },
      },
      reimbursements: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          type: true,
          label: true,
          amount: true,
          note: true,
          assignment: { select: { userId: true } },
          attachments: { select: { id: true, mimeType: true } },
        },
      },
      signatures: {
        select: {
          id: true,
          kind: true,
          signerName: true,
          skipped: true,
          pointOfContactId: true,
          assignment: { select: { userId: true } },
        },
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
          payOverridden: true,
          workPerformed: true,
          // Anyone who has left a trace on the job cannot be unassigned, so
          // the button is not offered for them.
          _count: { select: { deliverables: true } },
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

  const [canAssign, canReassign, canEditRates] = await Promise.all([
    canOnJob(user, "job.assign", jobRef),
    canOnJob(user, "job.reassign", jobRef),
    canOnJob(user, "pay.edit_rates", jobRef),
  ]);

  // Only fetched for someone who can actually act on it, so a tech's job page
  // never carries the staff list.
  const crewCandidates = canAssign
    ? await db.user.findMany({
        where: { active: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true, baseRole: true },
      })
    : [];

  const [
    canUpload,
    canOverrideMissing,
    canSetOutcome,
    canExportText,
    canExportZip,
    canExportPdf,
  ] = await Promise.all([
    canOnJob(user, "deliverable.upload", jobRef),
    canOnJob(user, "job.override_missing_signoff", jobRef),
    canOnJob(user, "job.set_outcome_status", jobRef),
    canOnJob(user, "export.text", jobRef),
    canOnJob(user, "export.zip", jobRef),
    canOnJob(user, "export.internal_wo", jobRef),
  ]);

  // Rendered with the page rather than fetched, so the report is there to copy
  // even if the connection has dropped by the time someone wants it.
  const exportData = canExportText ? await loadJobForExport(job.id) : null;
  const textReport = exportData ? buildTextReport(exportData) : null;

  const mine = job.assignments.find(
    (assignment) => assignment.user.id === user.id,
  );

  const allVisits = job.assignments.flatMap((assignment) => assignment.visits);
  const span = jobSpan(allVisits, now);

  const rules = resolveDeliverableRules(
    job.deliverableRules,
    job.project?.deliverableRules ?? [],
  );

  const presentCategories = new Set(
    job.deliverables.map((item) => item.category),
  );
  const missingRequired = rules
    .filter((rule) => rule.required && !presentCategories.has(rule.category))
    .map((rule) => deliverableLabel(rule.category, rule.customLabel));

  const photoCount = job.deliverables.reduce(
    (total, item) => total + item.attachments.length,
    0,
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
            removable: false,
          },
        ]
      : []),
    // Their coordinator, as recorded when this job was raised. A tech at a
    // locked door needs them, and they are not a dispatch contact we keep on
    // the project — they belong to the other company.
    ...(job.pmContact
      ? [
          {
            id: "pm-contact",
            label: `${job.client.name} PM/PC`,
            name: job.pmContact.title
              ? `${job.pmContact.name} · ${job.pmContact.title}`
              : job.pmContact.name,
            phone: job.pmContact.phone,
            email: job.pmContact.email,
            note: null as string | null,
            removable: false,
          },
        ]
      : []),
    // Only the job's own can be taken off here. The project's belong to the
    // project, and the supervisor is a link rather than a row.
    ...job.dispatchContacts.map((contact) => ({ ...contact, removable: true })),
    ...(job.project?.dispatchContacts ?? []).map((contact) => ({
      ...contact,
      removable: false,
    })),
  ];

  const timeline = await loadTimeline({ jobId: job.id }, zone);

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
        <TimePanel
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
          checkout={{
            missingRequired,
            mods: job.pointsOfContact
              .filter((contact) => contact.type === "MOD")
              .map((contact) => ({
                id: contact.id,
                name: contact.name,
                signed: job.signatures.some(
                  (signature) =>
                    signature.kind === "MOD" &&
                    signature.pointOfContactId === contact.id,
                ),
              })),
            techName: user.name,
            techSigned: job.signatures.some(
              (signature) =>
                signature.kind === "TECH" &&
                signature.assignment?.userId === user.id,
            ),
            releaseCode: job.releaseCode,
            noReleaseCode: job.noReleaseCode,
            outcome: job.outcome,
            canOverrideMissing,
            canSetOutcome,
          }}
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
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Site ID
            </div>
            {job.site.numberPending ? (
              <SiteNumberPrompt jobId={job.id} canSet={canClockHere} />
            ) : (
              <Link
                href={`/sites/${job.siteId}`}
                className="text-primary underline-offset-4 hover:underline"
              >
                {siteLabel(job.customer.code, job.site.siteNumber)}
              </Link>
            )}
          </div>
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

      {dispatch.length > 0 || canEditPlanned ? (
        <Card>
          <CardHeader>
            <CardTitle>Dispatch info</CardTitle>
            <CardDescription>
              Numbers to reach mid-job. Tap to dial.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DispatchPanel
              jobId={job.id}
              canEdit={canEditPlanned}
              contacts={dispatch}
            />
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
          <CardTitle>{job.client.name} paperwork</CardTitle>
          <CardDescription>
            Their work order and their sign-off sheet. Either can be added now
            or when it turns up, by whoever has it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <JobDocuments
            jobId={job.id}
            noWorkOrder={job.noWorkOrder}
            canUpload={canUpload}
            canDeclare={canEditPlanned}
            documents={job.documents
              .filter((doc) => doc.jobDocumentKind !== null)
              .map((doc) => ({
                id: doc.id,
                kind: doc.jobDocumentKind as "CLIENT_WORK_ORDER" | "SIGN_OFF",
                originalName: doc.originalName,
                sizeBytes: doc.sizeBytes,
                generated: doc.generated,
                fillableBoxes: doc.sourceTemplate?._count.placements ?? 0,
              }))}
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
          <BreakPay
            jobId={job.id}
            paid={job.breakPaid}
            canChange={canEditPlanned}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Crew</CardTitle>
          {canAssign ? (
            <CardDescription>
              A revisit and an ad-hoc job both start empty. Adding someone
              copies their rate onto the job and puts it in their calendar.
            </CardDescription>
          ) : null}
        </CardHeader>
        <CardContent>
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
            crew={job.assignments.map((assignment) => ({
              id: assignment.id,
              userId: assignment.user.id,
              name: assignment.user.name,
              payType: assignment.payType,
              payRate: assignment.payRate.toString(),
              travelReimbursement:
                assignment.travelReimbursement?.toString() ?? null,
              payNote: showPay ? assignment.payRateNote : null,
              overridden: assignment.payOverridden,
              isLead: assignment.isLead,
              onSite: jobSpan(assignment.visits, now).open,
              hasWorked:
                assignment.visits.length > 0 ||
                assignment._count.deliverables > 0,
              supervisorName: assignment.supervisor?.name ?? null,
              rate: showPay
                ? `${formatRate(assignment.payType, assignment.payRate.toString())}${
                    assignment.travelReimbursement
                      ? ` · travel $${Number(assignment.travelReimbursement).toFixed(2)}`
                      : ""
                  }`
                : null,
            }))}
          />
        </CardContent>
      </Card>

      {canEditRates ? (
        <Card>
          <CardHeader>
            <CardTitle>Pay</CardTitle>
            <CardDescription>
              What this job pays, for everybody on it. Normally inherited from
              the tech, the project or the company — set it here when this job
              is none of those.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <JobPay
              jobId={job.id}
              canEdit={canEditRates}
              payType={job.payType ?? "HOURLY"}
              payRate={job.payRate?.toString() ?? ""}
              travelReimbursement={job.travelReimbursement?.toString() ?? null}
              note={
                job.payType
                  ? "Applies to everybody on this job, including anybody added later. Somebody put on their own rate keeps it."
                  : "Not set — everybody keeps their own rate, or the project's default where they have none."
              }
            />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Deliverables</CardTitle>
          <CardDescription>
            Photos are converted to JPEG, stamped bottom-right with the date,
            Assignment ID and site, and kept against whoever uploaded them.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Deliverables
            jobId={job.id}
            rules={rules}
            canUpload={canUpload}
            photoCount={photoCount}
            photoLimit={company.maxPhotosPerJob}
            items={job.deliverables.map((item) => ({
              id: item.id,
              category: item.category,
              customLabel: item.customLabel,
              textValue: item.textValue,
              uploadedBy: item.assignment?.user.name ?? null,
              isOwn: item.assignment?.userId === user.id,
              attachments: item.attachments,
            }))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Reimbursements</CardTitle>
          <CardDescription>
            Materials and parking reach the client report; hotels stay internal.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Reimbursements
            jobId={job.id}
            canEdit={canUpload}
            entries={job.reimbursements.map((entry) => ({
              id: entry.id,
              type: entry.type,
              label: entry.label,
              amount: entry.amount.toString(),
              note: entry.note,
              isOwn: entry.assignment?.userId === user.id,
              attachments: entry.attachments,
            }))}
          />
        </CardContent>
      </Card>

      {canExportText || canExportZip || canExportPdf ? (
        <Card>
          <CardHeader>
            <CardTitle>Exports</CardTitle>
            <CardDescription>
              The report is the client-facing form — nothing internal appears in
              it. The ZIP carries the photos foldered by section and tech.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ExportsPanel
              jobId={job.id}
              report={textReport}
              canText={canExportText}
              canZip={canExportZip}
              canPdf={canExportPdf}
            />
          </CardContent>
        </Card>
      ) : null}

      {job.signatures.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Signatures</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-1.5">
            {job.signatures.map((signature) => (
              <Badge
                key={signature.id}
                variant={signature.skipped ? "warning" : "success"}
              >
                {signature.kind} · {signature.signerName}
                {signature.skipped ? " · not signed" : ""}
              </Badge>
            ))}
          </CardContent>
        </Card>
      ) : null}

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
        <CardContent>
          <Timeline rows={timeline} />
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
