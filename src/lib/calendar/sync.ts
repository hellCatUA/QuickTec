import { createHash } from "node:crypto";
import { formatAddress, siteLabel } from "@/lib/address";
import { recordAudit } from "@/lib/audit";
import {
  calDavConfigFromEnv,
  calendarSlug,
  calendarUrl,
  deleteEvent,
  describeFailure,
  ensureCalendar,
  putEvent,
  shareCalendar,
  type CalDavConfig,
} from "@/lib/calendar/caldav";
import { buildCalendar, eventFileName, eventUid } from "@/lib/calendar/ical";
import { db } from "@/lib/db";
import { jobSpan } from "@/lib/time-tracking";

/**
 * One-way push of jobs into NextCloud calendars.
 *
 * A system account owns every calendar and shares it read-only with the tech
 * and their supervisor, which is what makes the direction safe to enforce: an
 * event edited or deleted in NextCloud is simply restored on the next sync,
 * and nobody has been misled into thinking their change meant anything.
 *
 * The event runs for the estimate until the tech actually clocks out, and then
 * for the real time — so a supervisor's day view stops lying about who is
 * still on site.
 */

const DEFAULT_ESTIMATE_MINUTES = 120;

export type SyncOutcome = {
  pushed: number;
  removed: number;
  skipped: number;
  /** Why nothing was pushed, counted so "0 pushed" is never a mystery. */
  reasons: Partial<Record<SkipReason, number>>;
  failures: { target: string; reason: string }[];
};

/**
 * Why a job produced no event.
 *
 * Counted rather than swallowed: a sweep that reports "0 pushed, 0 failed" is
 * indistinguishable from a broken one, and the answer is nearly always one of
 * these four rather than anything going wrong.
 */
export type SkipReason =
  | "unchanged"
  | "nobody assigned"
  | "no date and nobody on site yet";

function emptyOutcome(): SyncOutcome {
  return { pushed: 0, removed: 0, skipped: 0, reasons: {}, failures: [] };
}

function skip(outcome: SyncOutcome, reason: SkipReason): void {
  outcome.skipped += 1;
  outcome.reasons[reason] = (outcome.reasons[reason] ?? 0) + 1;
}

/**
 * Fingerprint of an event, used to decide whether it needs re-uploading.
 *
 * Three lines are excluded because they move on their own: DTSTAMP is "now",
 * SEQUENCE counts the pushes rather than describing the job, and LAST-MODIFIED
 * follows the job row — including the calendarSyncedAt written at the end of a
 * sync. Leaving any of them in would make every event look changed on every
 * run and re-upload the lot.
 */
function contentHash(ics: string): string {
  return createHash("sha256")
    .update(ics.replace(/^(?:DTSTAMP|SEQUENCE|LAST-MODIFIED):.*\r?\n/gm, ""))
    .digest("hex");
}

/** The calendar a tech's events live in: "417-SYS: QuickTec (name@host)". */
export function calendarDisplayName(email: string): string {
  return `417-SYS: QuickTec (${email})`;
}

type JobForCalendar = {
  id: string;
  title: string;
  scheduledStart: Date | null;
  estimateMinutes: number | null;
  scopeOfWork: string | null;
  createdAt: Date;
  updatedAt: Date;
  client: { name: string };
  customer: { name: string; code: string };
  site: Parameters<typeof formatAddress>[0] & { siteNumber: string };
  project: { name: string; generalScopeOfWork: string | null } | null;
  dispatchContacts: {
    label: string;
    name: string | null;
    phone: string | null;
    email: string | null;
    note: string | null;
  }[];
};

/** Customer, company, site, dispatch numbers and the scope, in that order. */
export function describeJob(job: JobForCalendar): string {
  const parts = [
    `Customer: ${job.customer.name}`,
    `Company: ${job.client.name}`,
    `Site: ${siteLabel(job.customer.code, job.site.siteNumber)}`,
  ];

  if (job.dispatchContacts.length > 0) {
    parts.push(
      "",
      "Dispatch:",
      ...job.dispatchContacts.map((contact) =>
        [contact.label, contact.name, contact.phone, contact.email, contact.note]
          .filter(Boolean)
          .join(" · "),
      ),
    );
  }

  const scope = [job.project?.generalScopeOfWork, job.scopeOfWork]
    .filter(Boolean)
    .join("\n\n");
  if (scope) parts.push("", "Scope of work:", scope);

  return parts.join("\n");
}

/**
 * When the event runs. Falls back to a two hour block for a job scheduled
 * without an estimate, because a zero-length event is invisible in most
 * clients — worse than a rough one.
 */
function eventWindow(
  job: JobForCalendar,
  actual: { onsiteAt: Date | null; offsiteAt: Date | null },
): { start: Date; end: Date } | null {
  const start = actual.onsiteAt ?? job.scheduledStart;
  if (!start) return null;

  if (actual.offsiteAt) return { start, end: actual.offsiteAt };

  const minutes = job.estimateMinutes ?? DEFAULT_ESTIMATE_MINUTES;
  return { start, end: new Date(start.getTime() + minutes * 60_000) };
}

/** Provisions the calendar for one tech and shares it with their supervisor. */
export async function ensureUserCalendar(
  config: CalDavConfig,
  userId: string,
): Promise<{ slug: string; shareFailures: string[] } | { error: string }> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      calendarUrl: true,
      directSupervisor: { select: { email: true } },
    },
  });
  if (!user) return { error: "User not found" };

  const slug = calendarSlug(user.email);
  const created = await ensureCalendar(
    config,
    slug,
    calendarDisplayName(user.email),
  );
  if (!created.ok) {
    return { error: `Could not create calendar: ${describeFailure(created)}` };
  }

  const url = calendarUrl(config, slug);
  if (user.calendarUrl !== url) {
    await db.user.update({
      where: { id: user.id },
      data: { calendarUrl: url, calendarName: calendarDisplayName(user.email) },
    });
  }

  // The tech reads their own calendar; the supervisor reads their crew's.
  // A failure here does not fail the sync — the events are still written, and
  // a calendar nobody can see is a better outcome than a job nobody has.
  const shareWith = [user.email, user.directSupervisor?.email].filter(
    (email): email is string => Boolean(email),
  );

  const shareFailures: string[] = [];
  for (const email of shareWith) {
    if (!(await share(config, slug, email))) shareFailures.push(email);
  }

  return { slug, shareFailures };
}

/**
 * Shares with a NextCloud user, whose username we have to guess at.
 *
 * QuickTec knows people by email; NextCloud knows them by a username that is
 * usually one of two things — the whole email, or the part before the @. Both
 * are tried rather than picking one and leaving the other set of installs with
 * calendars their techs cannot see.
 */
async function share(
  config: CalDavConfig,
  slug: string,
  email: string,
): Promise<boolean> {
  const candidates = [email, email.split("@")[0]].filter(Boolean);

  for (const username of candidates) {
    const result = await shareCalendar(config, slug, username).catch(() => null);
    if (result?.ok) return true;
  }
  return false;
}

/**
 * Pushes one job to everyone assigned, and removes it from anyone who is not.
 *
 * Safe to call after any change to a job — an unchanged event is recognised by
 * its hash and never re-uploaded.
 */
export async function syncJob(
  jobId: string,
  options: { force?: boolean } = {},
): Promise<SyncOutcome> {
  const outcome = emptyOutcome();
  const config = calDavConfigFromEnv();
  if (!config) {
    outcome.failures.push({
      target: jobId,
      reason: "CalDAV is not configured",
    });
    return outcome;
  }

  const job = await db.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      title: true,
      scheduledStart: true,
      estimateMinutes: true,
      scopeOfWork: true,
      createdAt: true,
      updatedAt: true,
      lifecycle: true,
      calendarSyncError: true,
      client: { select: { name: true } },
      customer: { select: { name: true, code: true } },
      site: {
        select: {
          siteNumber: true,
          addressLine1: true,
          addressLine2: true,
          city: true,
          state: true,
          postalCode: true,
          country: true,
        },
      },
      project: { select: { name: true, generalScopeOfWork: true } },
      dispatchContacts: {
        orderBy: { order: "asc" },
        select: {
          label: true,
          name: true,
          phone: true,
          email: true,
          note: true,
        },
      },
      assignments: {
        select: {
          userId: true,
          user: { select: { id: true, email: true } },
          visits: { select: { clockInAt: true, clockOutAt: true, breaks: true } },
        },
      },
      calendarEvents: {
        select: { id: true, userId: true, sequence: true, contentHash: true },
      },
    },
  });

  if (!job) {
    outcome.failures.push({ target: jobId, reason: "Job not found" });
    return outcome;
  }

  const assignedIds = new Set(job.assignments.map((a) => a.userId));

  // Nobody to put it in front of. Said out loud, because a job planned but not
  // crewed is the commonest reason a calendar looks empty and the only one the
  // person reading the sweep can do anything about.
  if (job.assignments.length === 0 && job.calendarEvents.length === 0) {
    skip(outcome, "nobody assigned");
  }

  for (const assignment of job.assignments) {
    const span = jobSpan(assignment.visits);
    const window = eventWindow(job as JobForCalendar, span);

    // Nothing to put in a calendar until someone has said when it happens.
    if (!window) {
      skip(outcome, "no date and nobody on site yet");
      continue;
    }

    const existing = job.calendarEvents.find(
      (event) => event.userId === assignment.userId,
    );

    const ics = buildCalendar([
      {
        uid: eventUid(job.id, assignment.userId),
        start: window.start,
        end: window.end,
        summary: job.title,
        location: formatAddress(job.site),
        description: describeJob(job as JobForCalendar),
        url: process.env.AUTH_URL
          ? `${process.env.AUTH_URL.replace(/\/$/, "")}/jobs/${job.id}`
          : null,
        sequence: (existing?.sequence ?? 0) + 1,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
      },
    ]);

    const hash = contentHash(ics);

    // Decided before anything is sent, so a sweep over work that has not moved
    // costs one query rather than a round trip for every tech on every job.
    // The fingerprint is of what we last sent, though, not of what is on the
    // server — so an event somebody edited or deleted in NextCloud looks
    // unchanged from here. That is what force is for.
    if (!options.force && existing?.contentHash === hash) {
      skip(outcome, "unchanged");
      continue;
    }

    const calendar = await ensureUserCalendar(config, assignment.userId);
    if ("error" in calendar) {
      outcome.failures.push({
        target: assignment.user.email,
        reason: calendar.error,
      });
      continue;
    }

    for (const email of calendar.shareFailures) {
      outcome.failures.push({
        target: email,
        reason:
          "The calendar was written but could not be shared with them — NextCloud did not recognise that username.",
      });
    }

    const fileName = eventFileName(job.id, assignment.userId);
    const result = await putEvent(config, calendar.slug, fileName, ics);

    if (!result.ok) {
      outcome.failures.push({
        target: assignment.user.email,
        reason: `Upload failed: ${describeFailure(result)}`,
      });
      continue;
    }

    const path = `${calendarUrl(config, calendar.slug)}/${fileName}`;
    await db.calendarEvent.upsert({
      where: { jobId_userId: { jobId: job.id, userId: assignment.userId } },
      update: {
        calendarPath: path,
        sequence: (existing?.sequence ?? 0) + 1,
        contentHash: hash,
        syncedAt: new Date(),
      },
      create: {
        jobId: job.id,
        userId: assignment.userId,
        calendarPath: path,
        sequence: 1,
        contentHash: hash,
      },
    });

    outcome.pushed += 1;
  }

  // Somebody taken off the job should stop seeing it in their calendar.
  for (const event of job.calendarEvents) {
    if (assignedIds.has(event.userId)) continue;

    const user = await db.user.findUnique({
      where: { id: event.userId },
      select: { email: true },
    });
    if (!user) continue;

    const result = await deleteEvent(
      config,
      calendarSlug(user.email),
      eventFileName(job.id, event.userId),
    );
    if (!result.ok) {
      outcome.failures.push({
        target: user.email,
        reason: `Removal failed: ${describeFailure(result)}`,
      });
      continue;
    }

    await db.calendarEvent.delete({ where: { id: event.id } });
    outcome.removed += 1;
  }

  // Stamped only when something actually reached the server, so the figure on
  // the settings page counts jobs that are really in a calendar rather than
  // jobs we have looked at. The reason for a failure is kept on the job for
  // the same purpose: nobody awaits a background sync, so this is the only
  // place its answer survives.
  if (outcome.failures.length > 0) {
    await db.job.update({
      where: { id: job.id },
      data: { calendarSyncError: outcome.failures[0].reason.slice(0, 500) },
    });
  } else if (outcome.pushed > 0 || outcome.removed > 0) {
    await db.job.update({
      where: { id: job.id },
      data: { calendarSyncedAt: new Date(), calendarSyncError: null },
    });
  } else if (job.calendarSyncError) {
    await db.job.update({
      where: { id: job.id },
      data: { calendarSyncError: null },
    });
  }

  return outcome;
}

/**
 * Fire-and-forget push after a change that a calendar should know about.
 *
 * Not awaited by the caller: a slow or unreachable NextCloud must not make
 * clocking out feel broken, and the sync button on the settings page is the
 * safety net for anything a background push loses.
 */
export function syncJobInBackground(jobId: string): void {
  if (!calDavConfigFromEnv()) return;
  void syncJob(jobId).catch((error: unknown) => {
    console.error(`[calendar] background sync failed for ${jobId}:`, error);
  });
}

/** How far back a sweep reaches. */
export type SyncScope =
  /** The month around today: everything anybody is looking at. */
  | "recent"
  /** Every job there has ever been. For filling a calendar that came up empty. */
  | "everything";

const RECENT_DAYS = 30;

/**
 * The jobs a sweep covers.
 *
 * A week was too short in both directions. Work finished a fortnight ago still
 * belongs in the history a supervisor scrolls back through, and a job entered
 * late — scheduled for last month, clocked yesterday — was never reachable at
 * all, because the window was measured against the planned date rather than
 * against anything that had happened since.
 */
function sweepFilter(scope: SyncScope) {
  if (scope === "everything") return {};

  const since = new Date(Date.now() - RECENT_DAYS * 24 * 60 * 60_000);
  return {
    OR: [
      { scheduledStart: { gte: since } },
      { updatedAt: { gte: since } },
      // Anything already in a calendar stays true to the job, however old:
      // this is what removes an event from somebody taken off the work.
      { calendarEvents: { some: {} } },
    ],
  };
}

/**
 * Pushes every job in scope.
 *
 * The ordinary sweep is cheap to run over a lot of jobs: an event whose content
 * has not changed is recognised from the row we already hold and costs no
 * request at all. A rebuild deliberately gives that up — it is the answer to
 * calendars that are wrong, including ones somebody has edited or emptied at
 * the NextCloud end, which nothing here can see from a fingerprint.
 */
export async function syncAll(
  actorId: string | null,
  scope: SyncScope = "recent",
): Promise<SyncOutcome> {
  const total = emptyOutcome();
  const config = calDavConfigFromEnv();
  if (!config) {
    total.failures.push({ target: "config", reason: "CalDAV is not configured" });
    return total;
  }

  const jobs = await db.job.findMany({
    where: sweepFilter(scope),
    select: { id: true },
  });

  for (const job of jobs) {
    // A rebuild is what somebody presses when the calendars are wrong, so it
    // writes every event again rather than trusting the fingerprints.
    const outcome = await syncJob(job.id, { force: scope === "everything" });
    total.pushed += outcome.pushed;
    total.removed += outcome.removed;
    total.skipped += outcome.skipped;
    total.failures.push(...outcome.failures);
    for (const [reason, count] of Object.entries(outcome.reasons)) {
      const key = reason as SkipReason;
      total.reasons[key] = (total.reasons[key] ?? 0) + count;
    }
  }

  await recordAudit({
    actorId,
    entityType: "Calendar",
    entityId: "sync",
    action: "calendar_synced",
    detail: {
      scope,
      jobs: jobs.length,
      pushed: total.pushed,
      removed: total.removed,
      skipped: total.skipped,
      failures: total.failures.length,
    },
  });

  return total;
}
