import { jobTerms } from "@/lib/budget";
import { db } from "@/lib/db";
import { formatRate } from "@/lib/money";
import { canOnJob } from "@/lib/scope";
import { assignmentTotals } from "@/lib/time-tracking";
import type { SessionUser } from "@/lib/session";
import { can } from "@/lib/session";

/**
 * One door for everything done *to* a job, and what is behind it.
 *
 * The portal is a list of destinations, and every one of them answers three
 * questions before it is pressed: what state the job is in on that front,
 * whether this person may open it yet, and whether changing anything there
 * needs somebody else's yes.
 *
 * All three are read off permission flags rather than off roles. The rework of
 * permissions that is coming will change what the flags say; it should not
 * have to touch a word of the interface.
 *
 * It lives here rather than on the page because the job's own "..." menu asks
 * the same question, and two answers to "what can this person do to this job"
 * is one too many.
 */

export type PortalIcon =
  | "requests"
  | "review"
  | "details"
  | "schedule"
  | "revisit";

export type PortalItem = {
  key: string;
  href: string;
  label: string;
  /**
   * The state, written for a tile: one line, telegraphic, never a clause.
   * It is the reason to open the portal before anything has gone wrong.
   */
  state: string;
  group: "action" | "admin";
  icon: PortalIcon;
  /** Why it cannot be opened yet — shown on the tile, which stays in place. */
  locked: string | null;
  /** Changing something here can need approval. */
  needsApproval: boolean;
  /** Shown as a badge, and only when there is something to count. */
  count?: number;
  /** Extra lines under the state, for the one item that earns them. */
  more?: string[];
};

export type Portal = {
  jobId: string;
  title: string;
  intWoId: string;
  /** Where the job sits, in the words the badge uses. */
  stage: string;
  /** How far this person's hands reach, in one sentence. Null when fully. */
  reach: string | null;
  /**
   * Whether this person has any business behind the door.
   *
   * Suggesting a correction is not it: a tech has one destination and it keeps
   * its own line on the job's menu, so a portal holding a single tile would be
   * a door into a corridor.
   */
  open: boolean;
  items: PortalItem[];
};

const STAGE: Record<string, string> = {
  DRAFT: "Draft",
  PENDING_APPROVAL: "Pending approval",
  SCHEDULED: "Scheduled",
  IN_PROGRESS: "In progress",
  PENDING_REVIEW: "Pending review",
  CHANGES_REQUESTED: "Sent back",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  BILLED: "Billed",
};

/** Work is done and the report is in somebody's hands. */
const AFTER_CHECKOUT = new Set([
  "PENDING_REVIEW",
  "CHANGES_REQUESTED",
  "APPROVED",
  "REJECTED",
  "BILLED",
]);

export async function loadPortal(
  jobId: string,
  user: SessionUser,
): Promise<Portal | null> {
  const job = await db.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      title: true,
      intWoId: true,
      lifecycle: true,
      outcome: true,
      internalStatus: true,
      projectId: true,
      createdById: true,
      ticketNumber: true,
      incNumber: true,
      budgetType: true,
      budgetFlat: true,
      budgetFlatHours: true,
      budgetHourly: true,
      project: { select: { managerId: true } },
      assignments: {
        select: {
          userId: true,
          supervisorId: true,
          user: { select: { name: true, directSupervisorId: true } },
          visits: {
            select: {
              clockInAt: true,
              clockOutAt: true,
              breaks: { select: { startAt: true, endAt: true, paid: true } },
            },
          },
        },
      },
      changeRequests: {
        where: { status: "PENDING" },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true, requestedBy: { select: { name: true } } },
      },
    },
  });
  if (!job) return null;

  const jobRef = {
    projectId: job.projectId,
    assigneeIds: job.assignments.map((one) => one.userId),
    createdById: job.createdById,
  };
  if (!(await canOnJob(user, "job.view", jobRef))) return null;

  const [
    canEditPlanned,
    canFillMissing,
    canSuggest,
    canApproveChange,
    canApproveJob,
    canEditRates,
    canAdjustTime,
  ] = await Promise.all([
    canOnJob(user, "job.edit_planned_fields", jobRef),
    canOnJob(user, "job.fill_missing_field", jobRef),
    canOnJob(user, "job.suggest_change", jobRef),
    canOnJob(user, "job.approve_change", jobRef),
    canOnJob(user, "job.approve_report", jobRef),
    canOnJob(user, "pay.edit_rates", jobRef),
    canOnJob(user, "job.adjust_time", jobRef),
  ]);

  // Whoever the time and money are actually charged to: the crew's own
  // supervisor, or the manager of the project it was booked under.
  const paysForThis =
    job.assignments.some(
      (one) =>
        one.supervisorId === user.id ||
        one.user.directSupervisorId === user.id,
    ) || Boolean(job.project && job.project.managerId === user.id);

  const canSetPay = canEditRates && (paysForThis || job.createdById === user.id);
  const canFixClocks = canAdjustTime && (canEditPlanned || paysForThis);
  const canRevisit =
    can(user, "job.create") &&
    (paysForThis ||
      user.baseRole === "MANAGER" ||
      user.baseRole === "ADMINISTRATOR");

  const afterCheckout = AFTER_CHECKOUT.has(job.lifecycle);
  const items: PortalItem[] = [];

  // --- what is waiting on this person -------------------------------------

  const pending = job.changeRequests.length;
  const askedBy = job.changeRequests[0]?.requestedBy.name ?? "";
  const foldedIntoReview = afterCheckout && job.lifecycle !== "APPROVED";

  if (pending > 0 && canApproveChange && !foldedIntoReview) {
    items.push({
      key: "requests",
      href: `/jobs/${job.id}#suggested`,
      label: "Change requests",
      state: askedBy ? `From ${askedBy}` : "Waiting on you",
      group: "action",
      icon: "requests",
      locked: null,
      needsApproval: false,
      count: pending,
    });
  }

  if (canApproveJob) {
    // There is no column for when a report was handed in, and inventing one
    // to print a time is not worth a migration: the last clock-out is the
    // moment the crew stopped, which is what anybody reading this wants.
    const lastOut = job.assignments
      .flatMap((one) => one.visits)
      .map((visit) => visit.clockOutAt)
      .filter((at): at is Date => at !== null)
      .sort((a, b) => b.getTime() - a.getTime())[0];
    const submitted = lastOut ? `Submitted @ ${timeOnly(lastOut)}` : "Submitted";
    const who = job.assignments[0]?.user.name;
    items.push({
      key: "review",
      href: `/jobs/${job.id}/review`,
      label: "Review report",
      state:
        job.lifecycle === "PENDING_REVIEW"
          ? who
            ? `${submitted} by ${who}`
            : submitted
          : job.lifecycle === "CHANGES_REQUESTED"
            ? "Sent back to the crew"
            : job.lifecycle === "APPROVED"
              ? "Approved"
              : "Available after checkout",
      more:
        job.lifecycle === "PENDING_REVIEW" && pending > 0
          ? [`${pending} Change Request(s)`]
          : undefined,
      group: job.lifecycle === "PENDING_REVIEW" ? "action" : "admin",
      icon: "review",
      locked: afterCheckout
        ? job.lifecycle === "CHANGES_REQUESTED"
          ? "The crew have it back"
          : job.lifecycle === "PENDING_REVIEW"
            ? null
            : "Read-only now"
        : "Available after checkout",
      needsApproval: false,
    });
  }

  // --- the job itself ------------------------------------------------------

  if (canEditPlanned || canFillMissing || canSuggest) {
    const blank = [
      job.ticketNumber ? null : "Ticket #",
      job.incNumber ? null : "INC #",
    ].filter(Boolean);
    items.push({
      key: "details",
      href: `/jobs/${job.id}/edit`,
      label: "Job details",
      state: blank.length > 0 ? `${blank.join(", ")} blank` : "Complete",
      group: "admin",
      icon: "details",
      locked: null,
      needsApproval: !canEditPlanned,
    });
  }

  if (canFixClocks || canSetPay) {
    const onTheClock = job.assignments.flatMap((one) =>
      one.visits.filter((visit) => visit.clockOutAt === null),
    );
    const minutes = job.assignments.reduce(
      (sum, one) => sum + assignmentTotals(one.visits).paidMinutes,
      0,
    );
    const terms = jobTerms(job);
    const crew = `${job.assignments.length} tech${job.assignments.length === 1 ? "" : "s"}`;
    items.push({
      key: "schedule",
      href: `/jobs/${job.id}/manage/schedule`,
      label: "Schedule & Budget",
      state: onTheClock.length > 0
        ? `${crew} · on the clock ${hoursAndMinutes(minutes)}`
        : terms
          ? `${crew} · ${formatRate(
              terms.payType,
              (terms.hourlyCents / 100).toFixed(2),
              {
                amount: (terms.flatCents / 100).toFixed(2),
                minutes: terms.flatMinutes,
              },
            )}`
          : `${crew} · no budget set`,
      group: "admin",
      icon: "schedule",
      locked: null,
      needsApproval: !canEditPlanned,
    });
  }

  if (canRevisit) {
    items.push({
      key: "revisit",
      href: `/jobs/${job.id}/revisit`,
      label: "Revisit planner",
      state:
        job.internalStatus === "REVISIT_REQUIRED"
          ? "Revisit required"
          : afterCheckout
            ? "No revisit raised"
            : "After checkout",
      group: "admin",
      icon: "revisit",
      // A return trip cannot be planned from a job still being worked: what
      // is left to come back for is not known until somebody closes it out.
      locked: afterCheckout ? null : "Available after checkout",
      needsApproval: false,
    });
  }

  return {
    jobId: job.id,
    title: job.title,
    intWoId: job.intWoId,
    stage: STAGE[job.lifecycle] ?? job.lifecycle,
    open: canFixClocks || canSetPay || canRevisit || canApproveJob,
    reach: reachSentence({
      canEditPlanned,
      canFillMissing,
      canSuggest,
      canFixClocks,
      canSetPay,
    }),
    items,
  };
}

/**
 * Where this person's hands reach on this job, in one sentence.
 *
 * Said once at the top rather than discovered one refusal at a time. Null for
 * somebody who can do all of it — a banner telling a manager they are a
 * manager is noise.
 */
function reachSentence(flags: {
  canEditPlanned: boolean;
  canFillMissing: boolean;
  canSuggest: boolean;
  canFixClocks: boolean;
  canSetPay: boolean;
}): string | null {
  if (flags.canEditPlanned) return null;

  const direct = [
    flags.canFixClocks ? "punches" : null,
    flags.canSetPay ? "crew and pay" : null,
  ].filter(Boolean);

  if (direct.length === 0) {
    return "Everything here is a request. A supervisor decides what changes.";
  }
  if (flags.canSuggest || flags.canFillMissing) {
    return `You change ${direct.join(" and ")} outright. The job's own details require approval — the items that do are marked.`;
  }
  return `You change ${direct.join(" and ")} outright. The rest is read-only.`;
}

function hoursAndMinutes(minutes: number): string {
  const whole = Math.round(minutes);
  return `${Math.floor(whole / 60)}h ${String(whole % 60).padStart(2, "0")}m`;
}

function timeOnly(at: Date): string {
  return at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
