import { createHash } from "node:crypto";
import { formatAddress, siteLabel } from "@/lib/address";
import { recordAudit } from "@/lib/audit";
import {
  calDavConfigFromEnv,
  calendarSharees,
  calendarSlug,
  calendarUrl,
  deleteEvent,
  describeFailure,
  ensureCalendar,
  findPrincipal,
  putEvent,
  shareCalendar,
  shareKey,
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

/** Somebody a calendar is shared with, as QuickTec knows them. */
type Sharee = { email: string; nextcloudSub: string | null };

/** Why a calendar is not in front of somebody, said so a person can act on it. */
export type ShareFailure = { email: string; reason: string };

/** Provisions the calendar for one tech and shares it with their supervisor. */
export async function ensureUserCalendar(
  config: CalDavConfig,
  userId: string,
): Promise<{ slug: string; shareFailures: ShareFailure[] } | { error: string }> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      nextcloudSub: true,
      calendarUrl: true,
      directSupervisor: { select: { email: true, nextcloudSub: true } },
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
  const shareFailures = await shareCalendarWith(config, slug, [
    { email: user.email, nextcloudSub: user.nextcloudSub },
    ...(user.directSupervisor ? [user.directSupervisor] : []),
  ]);

  return { slug, shareFailures };
}

/**
 * Makes sure a calendar is shared with each of these people, and says why for
 * anybody it is not.
 *
 * Who it is shared with already is read first, so a calendar that is fine —
 * nearly every one, on every push — costs a single request rather than a
 * share for each person every time an event moves.
 */
async function shareCalendarWith(
  config: CalDavConfig,
  slug: string,
  sharees: Sharee[],
): Promise<ShareFailure[]> {
  const current = await calendarSharees(config, slug);
  if (!current.ok) {
    const reason = `QuickTec could not read who the calendar is shared with (${describeFailure(current.result)}).`;
    return sharees.map((sharee) => ({ email: sharee.email, reason }));
  }

  const failures: ShareFailure[] = [];
  for (const sharee of sharees) {
    const reason = await shareWithOne(config, slug, sharee, current.usernames);
    if (reason) failures.push({ email: sharee.email, reason });
  }
  return failures;
}

/**
 * The NextCloud usernames somebody might have, surest first.
 *
 * The one NextCloud signed them in with is theirs for certain. Before that
 * QuickTec only has their address, and installs give people one of two names:
 * the whole address, which is theirs too, or the part before the @ — which on
 * a NextCloud of any size can be somebody else's, and is only believed when
 * that user's address in NextCloud is theirs.
 */
function shareCandidates(sharee: Sharee): { username: string; sure: boolean }[] {
  const candidates: { username: string; sure: boolean }[] = [];
  if (sharee.nextcloudSub) candidates.push({ username: sharee.nextcloudSub, sure: true });
  candidates.push({ username: sharee.email, sure: true });
  const localPart = sharee.email.split("@")[0];
  if (localPart) candidates.push({ username: localPart, sure: false });

  // The surer spelling wins where two are the same name.
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = shareKey(candidate.username);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Shares a calendar with one person, or says why it could not be.
 *
 * The share request is never taken at its word. NextCloud answers it with
 * success for a username nobody has, and for a user its sharing policy rules
 * out, and in both cases shares with nobody — so the user is looked up before
 * anything is sent, and the share is read back afterwards.
 *
 * Returns null when they can see it, and the reason otherwise.
 */
async function shareWithOne(
  config: CalDavConfig,
  slug: string,
  sharee: Sharee,
  current: Set<string>,
): Promise<string | null> {
  const candidates = shareCandidates(sharee);

  // Already shared under a name that is certainly theirs: nothing to send.
  if (candidates.some((c) => c.sure && current.has(shareKey(c.username)))) return null;

  const missing: string[] = [];
  const somebodyElse: string[] = [];

  for (const candidate of candidates) {
    const principal = await findPrincipal(config, candidate.username);
    if (!principal.found) {
      if (principal.result.status === 404) {
        missing.push(candidate.username);
        continue;
      }
      return `QuickTec could not look up "${candidate.username}" in NextCloud (${describeFailure(principal.result)}).`;
    }

    if (!candidate.sure && principal.email !== sharee.email.toLowerCase()) {
      somebodyElse.push(
        `"${candidate.username}" in NextCloud has ${principal.email ? `the address ${principal.email}` : "no address"}, so is not taken to be them`,
      );
      continue;
    }

    // A guess just confirmed, under which it was already shared.
    if (current.has(shareKey(candidate.username))) return null;

    const sent = await shareCalendar(config, slug, candidate.username);
    if (!sent.ok) {
      return `NextCloud refused to share it with "${candidate.username}" (${describeFailure(sent)}).`;
    }

    const after = await calendarSharees(config, slug);
    if (!after.ok) {
      return `QuickTec could not check the share with "${candidate.username}" (${describeFailure(after.result)}).`;
    }
    // Kept up to date for whoever is shared with next.
    for (const username of after.usernames) current.add(username);

    if (after.usernames.has(shareKey(candidate.username))) return null;
    return `NextCloud answered the share with "${candidate.username}" but did not keep it — check that ${config.username} may share with them; NextCloud can limit sharing to people in the same group.`;
  }

  const findings = [
    missing.length > 0
      ? `NextCloud has no user ${missing.map((name) => `"${name}"`).join(" or ")}`
      : null,
    ...somebodyElse,
  ].filter(Boolean);
  const later = sharee.nextcloudSub
    ? ""
    : " It will be shared once they sign in to QuickTec through NextCloud.";
  return `${findings.join("; ")}.${later}`;
}

/**
 * The calendars made ready during one sweep, by tech. A tech on forty jobs has
 * one calendar, and a sweep asks NextCloud about it once rather than forty
 * times.
 */
type CalendarsReady = Map<string, ReturnType<typeof ensureUserCalendar>>;

/**
 * Pushes one job to everyone assigned, and removes it from anyone who is not.
 *
 * Safe to call after any change to a job — an unchanged event is recognised by
 * its hash and never re-uploaded.
 */
export async function syncJob(
  jobId: string,
  options: { force?: boolean; calendars?: CalendarsReady } = {},
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

    let ready = options.calendars?.get(assignment.userId);
    const firstInSweep = !ready;
    if (!ready) {
      ready = ensureUserCalendar(config, assignment.userId);
      options.calendars?.set(assignment.userId, ready);
    }
    const calendar = await ready;
    if ("error" in calendar) {
      outcome.failures.push({
        target: assignment.user.email,
        reason: calendar.error,
      });
      continue;
    }

    // Said once a sweep. A calendar not reaching somebody is one problem
    // however many jobs are pushed to it, and repeated for each it would fill
    // the few lines a sweep's result shows, hiding everybody else's.
    if (firstInSweep) {
      for (const failure of calendar.shareFailures) {
        outcome.failures.push({
          target: failure.email,
          reason: `The calendar was written but could not be shared with them: ${failure.reason}`,
        });
      }
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

/**
 * Shares the calendars somebody should see — their own, and their crew's if
 * they supervise one — under the username NextCloud has just signed them in
 * with.
 *
 * A calendar is shared as its events are pushed, under whatever QuickTec then
 * knows the person by. Until they have signed in through this NextCloud that
 * is a guess from their address, and a guess can miss: a whole crew moved to a
 * new NextCloud is exactly that, all at once. Signing in is where it stops
 * being a guess. Only calendars already in this NextCloud are touched; one
 * QuickTec has not made here yet is shared when the next push makes it.
 *
 * Returns what could not be shared, by calendar.
 */
export async function shareCalendarsOnSignIn(
  userId: string,
): Promise<(ShareFailure & { calendar: string })[]> {
  const config = calDavConfigFromEnv();
  if (!config) return [];

  const person = await db.user.findUnique({
    where: { id: userId },
    select: {
      email: true,
      nextcloudSub: true,
      calendarUrl: true,
      directReports: { select: { email: true, calendarUrl: true } },
    },
  });
  if (!person) return [];

  const failures: (ShareFailure & { calendar: string })[] = [];
  for (const owner of [person, ...person.directReports]) {
    const slug = calendarSlug(owner.email);
    // Where it would be made now is where a calendar made here was made.
    if (owner.calendarUrl !== calendarUrl(config, slug)) continue;

    const missed = await shareCalendarWith(config, slug, [
      { email: person.email, nextcloudSub: person.nextcloudSub },
    ]);
    failures.push(...missed.map((failure) => ({ ...failure, calendar: slug })));
  }
  return failures;
}

/**
 * Fire-and-forget shareCalendarsOnSignIn, for the sign-in itself: a slow or
 * unreachable NextCloud calendar must not hold somebody at the door.
 */
export function shareCalendarsInBackground(userId: string): void {
  if (!calDavConfigFromEnv()) return;
  void shareCalendarsOnSignIn(userId)
    .then((failures) => {
      for (const failure of failures) {
        console.error(
          `[calendar] ${failure.calendar} is not shared with ${failure.email}: ${failure.reason}`,
        );
      }
    })
    .catch((error: unknown) => {
      console.error(`[calendar] sharing at sign-in failed for ${userId}:`, error);
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

  const calendars: CalendarsReady = new Map();
  for (const job of jobs) {
    // A rebuild is what somebody presses when the calendars are wrong, so it
    // writes every event again rather than trusting the fingerprints.
    const outcome = await syncJob(job.id, {
      force: scope === "everything",
      calendars,
    });
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
