import { ArrowRight, CircleCheck, Clock, FileQuestion, Wallet } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/page-header";
import { getCompanySettings } from "@/lib/company";
import { isoDateInZone, usDateTimeInZone } from "@/lib/datetime";
import { db } from "@/lib/db";
import { JOB_FIELDS, isJobField } from "@/lib/job-fields";
import { formatMoney } from "@/lib/money";
import { jobScopeWhere, reportIds } from "@/lib/scope";
import { getSessionUser, permissionScope } from "@/lib/session";
import { DecidedList, fieldKind, type DecidedRow } from "./decided";
import { NotificationsPanel } from "./notifications-panel";
import {
  ApprovalTabs,
  isApprovalTab,
  type ApprovalTab,
} from "./tabs";

export const metadata = { title: "Approvals" };

/**
 * Everything waiting on this person, in one place.
 *
 * Each section is scoped by the permission that would let them act on it, so
 * the page is empty for a tech and full for a supervisor — nobody is shown a
 * queue they cannot clear.
 */
export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/signin");

  const { tab } = await searchParams;
  const active: ApprovalTab = isApprovalTab(tab) ? tab : "waiting";

  const company = await getCompanySettings();
  const zone = company.defaultTimeZone;

  // Notifications are personal — no scope involved, they are addressed to you.
  const notifications = await db.notification.findMany({
    where: { userId: user.id, acknowledgedAt: null },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      title: true,
      body: true,
      href: true,
      createdAt: true,
      actor: { select: { name: true } },
    },
  });

  const changeWhere = await jobScopeWhere(user, "job.approve_change");
  const reportWhere = await jobScopeWhere(user, "job.approve_report");

  const [changeRequests, adHocJobs, pendingReview, payrollPeriods] =
    await Promise.all([
      changeWhere
        ? db.changeRequest.findMany({
            where: { status: "PENDING", job: changeWhere },
            orderBy: { createdAt: "asc" },
            take: 50,
            select: {
              id: true,
              fieldPath: true,
              oldValue: true,
              newValue: true,
              reason: true,
              createdAt: true,
              requestedBy: { select: { name: true } },
              job: { select: { id: true, title: true, intWoId: true } },
            },
          })
        : [],

      reportWhere
        ? db.job.findMany({
            where: { AND: [reportWhere, { lifecycle: "PENDING_APPROVAL" }] },
            orderBy: { createdAt: "asc" },
            take: 50,
            select: {
              id: true,
              title: true,
              intWoId: true,
              createdAt: true,
              createdBy: { select: { name: true } },
              customer: { select: { code: true } },
              site: { select: { siteNumber: true } },
            },
          })
        : [],

      reportWhere
        ? db.job.findMany({
            where: { AND: [reportWhere, { lifecycle: "PENDING_REVIEW" }] },
            orderBy: { updatedAt: "asc" },
            take: 50,
            select: {
              id: true,
              title: true,
              intWoId: true,
              outcome: true,
              updatedAt: true,
              assignments: {
                select: { user: { select: { name: true } } },
              },
            },
          })
        : [],

      (async () => {
        const scope = permissionScope(user, "payroll.approve");
        if (!scope) return [];

        // Payroll follows the direct-supervisor link, not job scope: a manager
        // sees every week, a supervisor only their own reports'.
        const ids =
          scope === "ALL" ? null : [...(await reportIds(user.id))];
        if (ids !== null && ids.length === 0) return [];

        return db.payrollPeriod.findMany({
          where: {
            status: "DRAFT",
            ...(ids ? { userId: { in: ids } } : {}),
          },
          orderBy: { weekStart: "asc" },
          take: 50,
          select: {
            id: true,
            weekStart: true,
            expectedAmount: true,
            user: { select: { id: true, name: true } },
            _count: { select: { lines: true } },
          },
        });
      })(),
    ]);

  // Notifications are counted apart: the headline is about decisions waiting,
  // and folding "you were put on a job" into that number would overstate it.
  const total =
    changeRequests.length +
    adHocJobs.length +
    pendingReview.length +
    payrollPeriods.length;

  // --- what you have asked for ----------------------------------------------
  // Yours by authorship, not by scope: a tech cannot approve their own request
  // but is the person most likely to be wondering where it got to.
  const outgoing: DecidedRow[] =
    active === "outgoing"
      ? (
          await db.changeRequest.findMany({
            where: { requestedById: user.id },
            orderBy: [{ status: "asc" }, { createdAt: "desc" }],
            take: 100,
            select: {
              id: true,
              fieldPath: true,
              oldValue: true,
              newValue: true,
              status: true,
              createdAt: true,
              reviewedAt: true,
              reviewedBy: { select: { name: true } },
              job: { select: { id: true, title: true, intWoId: true } },
            },
          })
        ).map((request) => ({
          id: request.id,
          href: `/jobs/${request.job.id}`,
          kind: fieldKind(request.fieldPath),
          title: request.job.title,
          subtitle: request.job.intWoId,
          from: request.oldValue,
          to: request.newValue,
          raisedBy: null,
          raisedAt: usDateTimeInZone(request.createdAt, zone),
          decidedBy: request.reviewedBy?.name ?? null,
          decidedAt: request.reviewedAt
            ? usDateTimeInZone(request.reviewedAt, zone)
            : null,
          outcome:
            request.status === "PENDING"
              ? ("PENDING" as const)
              : request.status === "APPROVED"
                ? ("APPROVED" as const)
                : ("REJECTED" as const),
        }))
      : [];

  // Counted even when the tab is not open, because the badge is how somebody
  // finds out their request is still sitting there.
  const outgoingPending = await db.changeRequest.count({
    where: { requestedById: user.id, status: "PENDING" },
  });

  // --- what has already been decided ----------------------------------------
  const archive: DecidedRow[] =
    active === "archive"
      ? [
          ...(changeWhere
            ? (
                await db.changeRequest.findMany({
                  where: { status: { not: "PENDING" }, job: changeWhere },
                  orderBy: { reviewedAt: "desc" },
                  take: 50,
                  select: {
                    id: true,
                    fieldPath: true,
                    oldValue: true,
                    newValue: true,
                    status: true,
                    createdAt: true,
                    reviewedAt: true,
                    requestedBy: { select: { name: true } },
                    reviewedBy: { select: { name: true } },
                    job: { select: { id: true, title: true, intWoId: true } },
                  },
                })
              ).map((request) => ({
                id: `change-${request.id}`,
                href: `/jobs/${request.job.id}`,
                kind: fieldKind(request.fieldPath),
                title: request.job.title,
                subtitle: request.job.intWoId,
                from: request.oldValue,
                to: request.newValue,
                raisedBy: request.requestedBy.name,
                raisedAt: usDateTimeInZone(request.createdAt, zone),
                decidedBy: request.reviewedBy?.name ?? null,
                decidedAt: request.reviewedAt
                  ? usDateTimeInZone(request.reviewedAt, zone)
                  : null,
                outcome:
                  request.status === "APPROVED"
                    ? ("APPROVED" as const)
                    : ("REJECTED" as const),
              }))
            : []),

          ...(reportWhere
            ? (
                await db.job.findMany({
                  where: { AND: [reportWhere, { approvedAt: { not: null } }] },
                  orderBy: { approvedAt: "desc" },
                  take: 50,
                  select: {
                    id: true,
                    title: true,
                    intWoId: true,
                    createdAt: true,
                    approvedAt: true,
                    createdBy: { select: { name: true } },
                    approvedBy: { select: { name: true } },
                  },
                })
              ).map((job) => ({
                id: `job-${job.id}`,
                href: `/jobs/${job.id}`,
                kind: "Job",
                title: job.title,
                subtitle: job.intWoId,
                raisedBy: job.createdBy.name,
                raisedAt: usDateTimeInZone(job.createdAt, zone),
                decidedBy: job.approvedBy?.name ?? null,
                decidedAt: job.approvedAt
                  ? usDateTimeInZone(job.approvedAt, zone)
                  : null,
                outcome: "APPROVED" as const,
              }))
            : []),
        ].sort((a, b) => (a.decidedAt ?? "") < (b.decidedAt ?? "") ? 1 : -1)
      : [];

  const heading =
    active === "waiting"
      ? total === 0
        ? "Nothing is waiting on you."
        : `${total} item${total === 1 ? "" : "s"} waiting on you.`
      : active === "outgoing"
        ? outgoingPending === 0
          ? "None of your requests are still waiting."
          : `${outgoingPending} of your requests ${outgoingPending === 1 ? "is" : "are"} still waiting.`
        : "Decisions already made, with when they were asked for.";

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <PageHeader title="Approvals" description={heading} />

      <ApprovalTabs
        active={active}
        counts={{ waiting: total, outgoing: outgoingPending }}
      />

      {active === "outgoing" ? (
        outgoing.length === 0 ? (
          <EmptyState
            title="You have not asked for anything"
            description="Suggest a change on a job you cannot edit directly and it appears here until somebody answers it."
          />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Your requests</CardTitle>
              <CardDescription>
                Changes you suggested, newest first. Pending ones are still with
                whoever can approve them.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DecidedList rows={outgoing} />
            </CardContent>
          </Card>
        )
      ) : null}

      {active === "archive" ? (
        archive.length === 0 ? (
          <EmptyState
            title="Nothing decided yet"
            description="Approved and rejected requests, and jobs you have approved, are kept here with both timestamps."
          />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Archive</CardTitle>
              <CardDescription>
                What was decided, when it was raised and when it was answered.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DecidedList rows={archive} />
            </CardContent>
          </Card>
        )
      ) : null}

      {active !== "waiting" ? null : (
      <>
      <NotificationsPanel
        rows={notifications.map((notification) => ({
          id: notification.id,
          title: notification.title,
          body: notification.body,
          href: notification.href,
          when: usDateTimeInZone(notification.createdAt, zone),
          actor: notification.actor?.name ?? null,
        }))}
      />

      {total === 0 && notifications.length === 0 ? (
        <EmptyState
          title="All clear"
          description="Change requests, ad-hoc jobs, finished reports and payroll weeks appear here when they need your decision — and so does anything you have been put on or taken off."
        />
      ) : null}

      {changeRequests.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileQuestion className="size-4 text-warning" />
              Suggested changes
            </CardTitle>
            <CardDescription>
              Raised by someone who cannot edit a planned field directly.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {changeRequests.map((request) => (
              <Link
                key={request.id}
                href={`/jobs/${request.job.id}`}
                className="flex flex-col gap-1 rounded-lg border border-border p-2 transition-colors hover:border-primary/50"
              >
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge variant="warning">
                    {isJobField(request.fieldPath)
                      ? JOB_FIELDS[request.fieldPath].label
                      : request.fieldPath}
                  </Badge>
                  <span className="font-medium">{request.job.title}</span>
                  <span className="tabular text-xs text-muted-foreground">
                    {request.job.intWoId}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-muted-foreground line-through">
                    {request.oldValue || "empty"}
                  </span>
                  <ArrowRight className="size-3 text-muted-foreground" />
                  <span>{request.newValue || "empty"}</span>
                  <span className="text-muted-foreground">
                    · {request.requestedBy.name} ·{" "}
                    {usDateTimeInZone(request.createdAt, zone)}
                  </span>
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {adHocJobs.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="size-4 text-warning" />
              Ad-hoc jobs
            </CardTitle>
            <CardDescription>
              Created by a tech rather than scheduled. Work may already be under
              way — approval is retroactive.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {adHocJobs.map((job) => (
              <Link
                key={job.id}
                href={`/jobs/${job.id}`}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-sm transition-colors hover:border-primary/50"
              >
                <span className="font-medium">{job.title}</span>
                <span className="tabular text-xs text-muted-foreground">
                  {job.intWoId}
                </span>
                <span className="text-xs text-muted-foreground">
                  {job.customer.code} #{job.site.siteNumber} ·{" "}
                  {job.createdBy.name} · {usDateTimeInZone(job.createdAt, zone)}
                </span>
              </Link>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {pendingReview.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CircleCheck className="size-4 text-primary" />
              Reports to review
            </CardTitle>
            <CardDescription>
              Clocked out and waiting on a final read-through.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {pendingReview.map((job) => (
              <Link
                key={job.id}
                href={`/jobs/${job.id}`}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-sm transition-colors hover:border-primary/50"
              >
                <span className="font-medium">{job.title}</span>
                <span className="tabular text-xs text-muted-foreground">
                  {job.intWoId}
                </span>
                {job.outcome ? (
                  <Badge variant="neutral">{job.outcome}</Badge>
                ) : null}
                <span className="text-xs text-muted-foreground">
                  {job.assignments.map((a) => a.user.name).join(", ")}
                </span>
              </Link>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {payrollPeriods.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wallet className="size-4 text-success" />
              Payroll weeks
            </CardTitle>
            <CardDescription>
              You are the direct supervisor for these techs, so their weeks are
              yours to approve.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {payrollPeriods.map((period) => (
              <Link
                key={period.id}
                href={`/pay?user=${period.user.id}&week=${isoDateInZone(period.weekStart, zone)}`}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-sm transition-colors hover:border-primary/50"
              >
                <span className="font-medium">{period.user.name}</span>
                <span className="text-xs text-muted-foreground">
                  {period._count.lines} job
                  {period._count.lines === 1 ? "" : "s"}
                </span>
                <span className="ml-auto tabular">
                  {formatMoney(period.expectedAmount.toString())}
                </span>
              </Link>
            ))}
          </CardContent>
        </Card>
      ) : null}
      </>
      )}
    </div>
  );
}
