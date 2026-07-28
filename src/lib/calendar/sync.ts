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
  failures: { target: string; reason: string }[];
};

function emptyOutcome(): SyncOutcome {
  return { pushed: 0, removed: 0, skipped: 0, failures: [] };
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
): Promise<{ slug: string } | { error: string }> {
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
  // A failure here does not fail the sync — the events are still written.
  const shareWith = [
    user.email.split("@")[0],
    user.directSupervisor?.email.split("@")[0],
  ].filter((name): name is string => Boolean(name));

  for (const username of shareWith) {
    await shareCalendar(config, slug, username).catch(() => undefined);
  }

  return { slug };
}

/**
 * Pushes one job to everyone assigned, and removes it from anyone who is not.
 *
 * Safe to call after any change to a job — an unchanged event is recognised by
 * its hash and never re-uploaded.
 */
export async function syncJob(jobId: string): Promise<SyncOutcome> {
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

  for (const assignment of job.assignments) {
    const span = jobSpan(assignment.visits);
    const window = eventWindow(job as JobForCalendar, span);

    // Nothing to put in a calendar until someone has said when it happens.
    if (!window) {
      outcome.skipped += 1;
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

    if (existing?.contentHash === hash) {
      outcome.skipped += 1;
      continue;
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
  // jobs we have looked at.
  if (outcome.pushed > 0 || outcome.removed > 0) {
    await db.job.update({
      where: { id: job.id },
      data: { calendarSyncedAt: new Date() },
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
 * Pushes every job that could plausibly still change: anything scheduled from
 * a week ago onwards. Older work is finished and its calendar entry is history.
 */
export async function syncAll(actorId: string | null): Promise<SyncOutcome> {
  const total = emptyOutcome();
  const config = calDavConfigFromEnv();
  if (!config) {
    total.failures.push({ target: "config", reason: "CalDAV is not configured" });
    return total;
  }

  const since = new Date(Date.now() - 7 * 24 * 60 * 60_000);
  const jobs = await db.job.findMany({
    where: {
      OR: [
        { scheduledStart: { gte: since } },
        { scheduledStart: null, createdAt: { gte: since } },
      ],
    },
    select: { id: true },
  });

  for (const job of jobs) {
    const outcome = await syncJob(job.id);
    total.pushed += outcome.pushed;
    total.removed += outcome.removed;
    total.skipped += outcome.skipped;
    total.failures.push(...outcome.failures);
  }

  await recordAudit({
    actorId,
    entityType: "Calendar",
    entityId: "sync",
    action: "calendar_synced",
    detail: {
      jobs: jobs.length,
      pushed: total.pushed,
      removed: total.removed,
      skipped: total.skipped,
      failures: total.failures.length,
    },
  });

  return total;
}
