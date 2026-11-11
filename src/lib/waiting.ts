import { cache } from "react";
import { db } from "@/lib/db";
import { isGuest } from "@/lib/permissions";
import { managesProfiles } from "@/lib/profile";
import { jobScopeWhere, reportIds } from "@/lib/scope";
import { permissionScope, type SessionUser } from "@/lib/session";
import { canSupervise } from "@/lib/supervisors";

/**
 * What is waiting on somebody, counted.
 *
 * The dashboard's "Waiting on you" and the count on the Approvals tab are the
 * same question and must give the same answer, so it is asked in one place.
 * Each count uses the scope that would let them act on the thing — the same
 * filter the Approvals page lists it with — so nobody is counted a queue they
 * cannot clear.
 *
 * Cached for the request: the dashboard and the app shell around it both ask.
 */
export type Waiting = {
  /** Suggested changes they may approve. */
  changes: number;
  /** Jobs a tech raised for themselves, waiting to be approved. */
  adHoc: number;
  /** Reports checked out and waiting on a read-through. */
  reviews: number;
  /** Payroll weeks built for their reports and not yet approved. */
  payroll: number;
  /** Legal names and pictures their reports asked for. */
  profileRequests: number;
  /** Things that happened to them, not yet acknowledged. Not decisions. */
  notices: number;
  /** Their own suggestions, still with somebody else. Not theirs to act on. */
  mine: number;
};

/** The decisions among them: what the Approvals page counts as waiting. */
export function decisionsWaiting(waiting: Waiting): number {
  return (
    waiting.changes +
    waiting.adHoc +
    waiting.reviews +
    waiting.payroll +
    waiting.profileRequests
  );
}

export const waitingOnYou = cache(
  async (user: SessionUser): Promise<Waiting> => {
    const [changeWhere, reportWhere] = await Promise.all([
      jobScopeWhere(user, "job.approve_change"),
      jobScopeWhere(user, "job.approve_report"),
    ]);
    const payrollScope = permissionScope(user, "payroll.approve");

    const [changes, adHoc, reviews, payroll, notices, mine, profileRequests] =
      await Promise.all([
        changeWhere
          ? db.changeRequest.count({
              where: { status: "PENDING", job: changeWhere },
            })
          : 0,
        reportWhere
          ? db.job.count({
              where: { AND: [reportWhere, { lifecycle: "PENDING_APPROVAL" }] },
            })
          : 0,
        reportWhere
          ? db.job.count({
              where: { AND: [reportWhere, { lifecycle: "PENDING_REVIEW" }] },
            })
          : 0,
        (async () => {
          if (!payrollScope) return 0;
          // Payroll follows the direct-supervisor link, not job scope.
          const ids =
            payrollScope === "ALL" ? null : [...(await reportIds(user.id))];
          if (ids !== null && ids.length === 0) return 0;
          return db.payrollPeriod.count({
            where: { status: "DRAFT", ...(ids ? { userId: { in: ids } } : {}) },
          });
        })(),
        db.notification.count({
          where: { userId: user.id, acknowledgedAt: null },
        }),
        db.changeRequest.count({
          where: { requestedById: user.id, status: "PENDING" },
        }),
        // The same queue Approvals shows: what their reports asked for, or
        // every request for whoever manages users.
        isGuest(user)
          ? 0
          : db.profileRequest.count({
              where: {
                status: "PENDING",
                // Somebody whose role no longer supervises keeps the link on
                // their old reports' records, but not the queue.
                ...(managesProfiles(user)
                  ? {}
                  : canSupervise(user.baseRole)
                    ? { user: { directSupervisorId: user.id } }
                    : { id: "" }),
              },
            }),
      ]);

    return { changes, adHoc, reviews, payroll, profileRequests, notices, mine };
  },
);

/**
 * What the Approvals tab shows: how many decisions, and whether anything new
 * happened to them besides.
 *
 * Notices are a dot rather than part of the number. A tech decides nothing
 * here, and "You are on …" is news to read, not a queue to clear; folded into
 * the count, a few unread notices would have made the number mean nothing to
 * the manager it is for.
 */
export type ApprovalsBadge = { decisions: number; notices: boolean };

export async function approvalsBadge(
  user: SessionUser,
): Promise<ApprovalsBadge> {
  if (isGuest(user)) return { decisions: 0, notices: false };
  const waiting = await waitingOnYou(user);
  return {
    decisions: decisionsWaiting(waiting),
    notices: waiting.notices > 0,
  };
}
