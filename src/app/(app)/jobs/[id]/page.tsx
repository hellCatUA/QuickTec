import { CircleCheck, Mail, MapPin, Phone, Printer } from "lucide-react";
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
import { deliverableLabel, effectiveRules } from "@/lib/deliverables";
import {
  fieldAction,
  isOptionalField,
  JOB_FIELDS,
  type JobFieldName,
} from "@/lib/job-fields";
import {
  INTERNAL_STATUS_META,
  LIFECYCLE_META,
  OUTCOME_META,
} from "@/lib/job-status";
import {
  reviewDeliverables,
  reviewReimbursements,
  reviewTimes,
  reviewWork,
} from "@/lib/job-review";
import { formatRate } from "@/lib/money";
import { canOnJob } from "@/lib/scope";
import { loadTimeline } from "@/lib/timeline-data";
import { can, getSessionUser, permissionScope } from "@/lib/session";
import { loadJobForExport } from "@/lib/exports/job-data";
import { buildTextReport } from "@/lib/exports/text-report";
import { jobSpan, visitTotals } from "@/lib/time-tracking";
import { Timeline } from "@/components/timeline";
import { approveJob } from "../actions";
import { ChangeRequests } from "./change-requests";
import { CrewPanel } from "./crew-panel";
import { DispatchPanel } from "./dispatch-panel";
import { JobMenu, JobMenuSection } from "./job-menu";
import { JobPay } from "./job-pay";
import { JobReview, type ReviewStep } from "./job-review";
import { VisitTimes } from "./visit-times";
import { BreakPay } from "./break-pay";
import { JobDocuments } from "./job-documents";
import { JobTickets } from "./tickets";
import { BlockBody, BlockEditToggle, EditableBlock } from "./editable-block";
import { EditableField } from "./editable-field";
import { PointsOfContact } from "./points-of-contact";
import { RevisitPanel } from "./revisit-panel";
import { ScopeOfWork } from "./scope-of-work";
import { SiteNumberPrompt } from "./site-number";
import { Deliverables } from "./deliverables";
import { DeliverableSections } from "./deliverable-sections";
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
      extraTickets: {
        orderBy: { order: "asc" },
        select: { id: true, number: true, order: true },
      },
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
          sourceTemplateId: true,
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
          // Who runs the project answers for what it pays, so the settings
          // menu opens for them whatever their rank elsewhere.
          managerId: true,
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
              directSupervisorId: true,
              directSupervisor: {
                select: { name: true, phone: true, email: true },
              },
            },
          },
          supervisorId: true,
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

  const [canAssign, canReassign, canEditRates, canAdjustTime] =
    await Promise.all([
      canOnJob(user, "job.assign", jobRef),
      canOnJob(user, "job.reassign", jobRef),
      canOnJob(user, "pay.edit_rates", jobRef),
      canOnJob(user, "job.adjust_time", jobRef),
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

  // The whole sheet for the planner to change; the sections that are on are
  // what the tech is shown and what checkout asks for.
  const sections = effectiveRules(
    job.deliverableRules,
    job.project?.deliverableRules ?? [],
  );
  const rules = sections.filter((rule) => rule.enabled);

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
        optional={isOptionalField(field)}
      />
    );
  }

  // "A supervisor or above, or the person leading this job." The lead is on
  // site and answerable for what the job records, so the corner pencils follow
  // them as well as the rank.
  const canManageJob = canEditPlanned || Boolean(mine?.isLead);

  // What sits behind the settings menu is not answered by rank. Whoever pays
  // for the time is either the crew's own supervisor or the manager of the
  // project it was booked under, and that is who each item below asks for.
  const isDirectSupervisor = job.assignments.some(
    (assignment) =>
      assignment.supervisorId === user.id ||
      assignment.user.directSupervisorId === user.id,
  );
  const isProjectManager = Boolean(
    job.project && job.project.managerId === user.id,
  );
  const paysForThis = isDirectSupervisor || isProjectManager;

  // The same test clock-limits.ts calls "unbounded": whoever the time is
  // charged to. Deleting a punch is theirs; the job's lead may only move one.
  const canRemovePunch =
    permissionScope(user, "job.adjust_time") === "ALL" || paysForThis;

  // A rate is the job's own money: their supervisor, the project's manager, or
  // whoever raised it and negotiated the number in the first place.
  const canSetPay =
    canEditRates && (paysForThis || job.createdById === user.id);

  // A revisit is a new job on somebody's calendar, so it stops at the people
  // who schedule: the same two, or a manager.
  const canRevisit =
    can(user, "job.create") &&
    (paysForThis ||
      user.baseRole === "MANAGER" ||
      user.baseRole === "ADMINISTRATOR");

  // Every clock on the job, not only the reader's own — a lead fixes the
  // crew's, and correcting your own from the panel above stops at your limit.
  const editableVisits = job.assignments.flatMap((assignment) =>
    assignment.visits.map((visit, index) => ({
      id: visit.id,
      who:
        assignment.visits.length > 1
          ? `${assignment.user.name} · visit ${index + 1}`
          : assignment.user.name,
      clockIn: {
        value: toDatetimeLocalInZone(visit.clockInAt, zone),
        text: usDateTimeInZone(visit.clockInAt, zone),
      },
      clockOut: visit.clockOutAt
        ? {
            value: toDatetimeLocalInZone(visit.clockOutAt, zone),
            text: usDateTimeInZone(visit.clockOutAt, zone),
          }
        : null,
    })),
  );

  // The menu itself stops at a supervisor or the job's lead. A tech may adjust
  // their own clock, but from the time panel they are already looking at —
  // this is the place the crew's times are changed, and that is not theirs.
  const showMenu =
    canManageJob && [canAdjustTime, canSetPay, canRevisit].some(Boolean);

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

  // What a reviewer is shown before signing the job off. Built here rather
  // than in the panel so the flags come from the same numbers the page does.
  const reviewSteps: ReviewStep[] =
    job.lifecycle === "PENDING_REVIEW" && canApproveJob
      ? buildReview()
      : [];

  function buildReview(): ReviewStep[] {
    const perTech = job!.assignments.map((assignment) => {
      const totals = assignment.visits.map((visit) =>
        visitTotals(
          {
            clockInAt: visit.clockInAt,
            clockOutAt: visit.clockOutAt,
            breaks: visit.breaks,
          },
          now,
        ),
      );
      const first = assignment.visits[0];

      return {
        who: assignment.user.name,
        clockInAt: first?.clockInAt ?? null,
        clockOutAt: first?.clockOutAt ?? null,
        paidMinutes: totals.reduce((sum, one) => sum + one.paidMinutes, 0),
      };
    });

    const worked = perTech.filter((entry) => entry.clockInAt !== null);

    const sections = rules.map((rule) => ({
      label: deliverableLabel(rule.category, rule.customLabel),
      required: rule.required,
      filled: job!.deliverables.some(
        (item) =>
          item.category === rule.category &&
          (rule.category !== "CUSTOM" || item.customLabel === rule.customLabel),
      ),
    }));

    const claims = job!.reimbursements.map((entry) => ({
      label: entry.label ?? entry.type,
      amount: Number(entry.amount),
      hasReceipt: entry.attachments.length > 0,
    }));

    const written = job!.assignments.map((assignment) => ({
      who: assignment.user.name,
      text: assignment.workPerformed,
    }));

    return [
      {
        key: "times",
        title: "Times",
        rows: [
          {
            label: "Scheduled",
            value: job!.scheduledStart
              ? usDateTimeInZone(job!.scheduledStart, zone)
              : "Not scheduled",
          },
          {
            label: "Estimate",
            value: job!.estimateMinutes
              ? `${(job!.estimateMinutes / 60).toFixed(2)} hrs`
              : "None",
          },
          ...worked.map((entry) => ({
            label: entry.who,
            value: `${usTimeInZone(entry.clockInAt!, zone)} – ${
              entry.clockOutAt ? usTimeInZone(entry.clockOutAt, zone) : "still on"
            } · ${(entry.paidMinutes / 60).toFixed(2)} hrs`,
          })),
        ],
        flags: reviewTimes({
          scheduledStart: job!.scheduledStart,
          estimateMinutes: job!.estimateMinutes,
          visits: worked.map((entry) => ({
            who: entry.who,
            clockInAt: entry.clockInAt!,
            clockOutAt: entry.clockOutAt,
            paidMinutes: entry.paidMinutes,
          })),
        }),
      },
      {
        key: "deliverables",
        title: "Deliverables",
        rows: sections.map((section) => ({
          label: section.label,
          value: section.filled ? "Recorded" : "Empty",
        })),
        flags: reviewDeliverables({
          sections,
          photoCount,
          hasSignOff: job!.documents.some(
            (doc) => doc.jobDocumentKind === "SIGN_OFF",
          ),
        }),
      },
      {
        key: "reimbursements",
        title: "Reimbursements",
        rows: claims.map((claim) => ({
          label: claim.label,
          value: `$${claim.amount.toFixed(2)}${claim.hasReceipt ? "" : " · no receipt"}`,
        })),
        flags: reviewReimbursements({ entries: claims }),
      },
      {
        key: "work",
        title: "Work performed",
        rows: job!.workPerformedMerged
          ? [{ label: "To the client", value: job!.workPerformedMerged }]
          : written
              .filter((entry) => entry.text?.trim())
              .map((entry) => ({ label: entry.who, value: entry.text! })),
        flags: reviewWork({
          merged: job!.workPerformedMerged,
          entries: written,
        }),
      },
    ];
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <PageHeader
        title={job.title}
        backHref="/jobs"
        description={`${intWoFieldLabel(company)}: ${job.intWoId}`}
        actions={
          <>
            {/* Two different approvals, and the job is only ever waiting on
                one of them: that the ad-hoc job should exist at all, or that
                the finished report stands. */}
            {canApproveJob && job.lifecycle === "PENDING_APPROVAL" ? (
              <form
                action={async (formData: FormData) => {
                  "use server";
                  await approveJob(formData);
                }}
              >
                <input type="hidden" name="jobId" value={job.id} />
                <Button type="submit" size="sm" variant="success">
                  <CircleCheck /> Approve job
                </Button>
              </form>
            ) : null}

            {/* A finished report is not approved from the header. It is
                approved at the bottom of a read-through, which is the panel
                below. */}

            {showMenu ? (
              <JobMenu>
                {canAdjustTime ? (
                  <JobMenuSection
                    title="Clock times"
                    hint="A crew that forgot to clock out is the usual reason. Anything past your limit becomes a request for whoever pays for the time."
                  >
                    <VisitTimes visits={editableVisits} canRemove={canRemovePunch} />
                  </JobMenuSection>
                ) : null}

                {canSetPay ? (
                  <JobMenuSection
                    title="Pay"
                    hint="What this job pays, for everybody on it. Normally inherited from the tech, the project or the company — set it here when this job is none of those."
                  >
                    <JobPay
                      jobId={job.id}
                      canEdit={canSetPay}
                      payType={job.payType ?? "HOURLY"}
                      payRate={job.payRate?.toString() ?? ""}
                      travelReimbursement={
                        job.travelReimbursement?.toString() ?? null
                      }
                      note={
                        job.payType
                          ? "Applies to everybody on this job, including anybody added later. Somebody put on their own rate keeps it."
                          : "Not set — everybody keeps their own rate, or the project's default where they have none."
                      }
                    />
                  </JobMenuSection>
                ) : null}

                {canRevisit ? (
                  <JobMenuSection
                    title="Revisit"
                    hint="Creates a new job carrying the same internal number with an -R suffix, in the month the revisit happens. Site, scope and deliverable rules are copied across."
                  >
                    <RevisitPanel
                      jobId={job.id}
                      jobTitle={job.title}
                      externalAssignmentId={job.externalAssignmentId}
                    />
                  </JobMenuSection>
                ) : null}
              </JobMenu>
            ) : null}
          </>
        }
      />

      {reviewSteps.length > 0 ? (
        <JobReview jobId={job.id} steps={reviewSteps} />
      ) : null}

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
            revisitRequired: job.internalStatus === "REVISIT_REQUIRED",
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
        <EditableBlock label="assignment details" canEdit={canManageJob}>
        <CardHeader className="flex-row items-start justify-between gap-2">
          <CardTitle>Assignment details</CardTitle>
          <BlockEditToggle />
        </CardHeader>
        <CardContent>
          <BlockBody>
            <div className="grid gap-4 text-sm sm:grid-cols-2">
              <Static label="Company" value={job.client.name} />
              <Static label="Customer" value={job.customer.name} />

              {/* Where it is, in the order somebody driving there wants it:
                  which site, then the address, then when they are due. */}
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

              {editable(
                "scheduledStart",
                job.scheduledStart
                  ? toDatetimeLocalInZone(job.scheduledStart, zone)
                  : "",
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

              {editable("externalAssignmentId", job.externalAssignmentId ?? "")}
              {editable("ticketNumber", job.ticketNumber ?? "")}
              {/* One job routinely answers to more than one ticket. The first
                  is the field above; these are the ones after it, and the plus
                  stays offered even once there is one — a second turns up
                  mid-job often enough. */}
              <JobTickets
                jobId={job.id}
                primary={job.ticketNumber}
                extras={job.extraTickets}
                canEdit={canFillMissing}
              />
              {editable("incNumber", job.incNumber ?? "")}
              <Static
                label="Project"
                value={
                  job.project
                    ? `${job.project.name}${job.project.externalProjectId ? ` (${job.project.externalProjectId})` : ""}`
                    : "No project"
                }
              />
            </div>
          </BlockBody>

          {/* The paperwork the job answers to, with the job it belongs to
              rather than in a block of its own further down the scroll. */}
          <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4">
            {canExportPdf ? (
              <div className="flex flex-col gap-1">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {company.intWoLabel} work order
                </div>
                <a
                  href={`/api/jobs/${job.id}/export/pdf?inline=1`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 text-sm text-primary underline-offset-4 hover:underline"
                >
                  <Printer className="size-3.5 shrink-0" />
                  {job.intWoId}.pdf
                </a>
              </div>
            ) : null}

            <JobDocuments
              jobId={job.id}
              only="CLIENT_WORK_ORDER"
              canUpload={canUpload}
              documents={job.documents
                .filter((doc) => doc.jobDocumentKind !== null)
                .map((doc) => ({
                  id: doc.id,
                  kind: doc.jobDocumentKind as "CLIENT_WORK_ORDER" | "SIGN_OFF",
                  originalName: doc.originalName,
                  sizeBytes: doc.sizeBytes,
                  generated: doc.generated,
                  fillableBoxes: doc.sourceTemplate?._count.placements ?? 0,
                  templateId: doc.sourceTemplateId,
                }))}
            />
          </div>
        </CardContent>
        </EditableBlock>
      </Card>

      {dispatch.length > 0 || canFillMissing ? (
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-2">
            <CardTitle>Dispatch info</CardTitle>
          </CardHeader>
          <CardContent>
            {/* A number picked up mid-job is worth having whoever finds it, so
                anyone on the job may add one. Changing or removing one that is
                already there is a different matter — that is the number the
                rest of the crew is dialling. */}
            <DispatchPanel
              jobId={job.id}
              canEdit={canManageJob}
              canAdd={canFillMissing}
              contacts={dispatch}
            />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-2">
          <CardTitle>Scope of work</CardTitle>
          {/* The editor holds Markdown, which is worth writing and not worth
              reading: it used to sit above the rendered scope showing the same
              text with its punctuation still in. */}
          {canManageJob &&
          actionFor("scopeOfWork", job.scopeOfWork ?? "") !== "none" ? (
            <EditableField
              jobId={job.id}
              field="scopeOfWork"
              label="scope of work"
              value={job.scopeOfWork ?? ""}
              action={actionFor("scopeOfWork", job.scopeOfWork ?? "")}
              kind="markdown"
              hideValue
            />
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
          <CardTitle>Points of contact</CardTitle>
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
          {/* When it was planned for now sits with the address, where somebody
              on their way there is already looking. */}
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

          {/* Return tracking is not here any more. It is recorded against the
              Return Labels deliverable, with the photo of the label beside it,
              which is where somebody standing at the box already is. The
              report still reads "Return track #" from either. */}
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

      <Card>
        <CardHeader>
          <CardTitle>Deliverables</CardTitle>
          {canUpload ? (
            <DeliverableSections
              jobId={job.id}
              rules={sections}
              canRequire={canManageJob}
            />
          ) : null}
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {/* Their sheet is one of the deliverables and the last thing signed,
              so it sits with them rather than in a paperwork block of its own.
              First, because it is what the customer is standing there for. */}
          <JobDocuments
            jobId={job.id}
            only="SIGN_OFF"
            canUpload={canUpload}
            documents={job.documents
              .filter((doc) => doc.jobDocumentKind !== null)
              .map((doc) => ({
                id: doc.id,
                kind: doc.jobDocumentKind as "CLIENT_WORK_ORDER" | "SIGN_OFF",
                originalName: doc.originalName,
                sizeBytes: doc.sizeBytes,
                generated: doc.generated,
                fillableBoxes: doc.sourceTemplate?._count.placements ?? 0,
                templateId: doc.sourceTemplateId,
              }))}
          />

          {/* Often known before anybody starts checking out — dispatch gives it
              on the call. Recorded where the tech already is rather than found
              again three blocks up at the end of the day. */}
          <div className="border-t border-border pt-4">
            {editable("releaseCode", job.releaseCode ?? "")}
          </div>

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

          {job.signatures.length > 0 ? (
            <div className="flex flex-col gap-2 border-t border-border pt-4">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Signatures
              </span>
              <div className="flex flex-wrap gap-1.5">
                {job.signatures.map((signature) => (
                  <Badge
                    key={signature.id}
                    variant={signature.skipped ? "warning" : "success"}
                  >
                    {signature.kind} · {signature.signerName}
                    {signature.skipped ? " · not signed" : ""}
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}
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
