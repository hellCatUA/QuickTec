"use server";

import {
  calDavConfigFromEnv,
  calendarHome,
  checkAccess,
  describeFailure,
} from "@/lib/calendar/caldav";
import { syncAll, type SyncScope } from "@/lib/calendar/sync";
import { requirePermission } from "@/lib/session";
import type { SyncSummary } from "./calendar-panel";

export type SyncResult =
  | { ok: true; summary: SyncSummary }
  | { ok: false; error: string };

export async function runCalendarSync(scope: SyncScope): Promise<SyncResult> {
  const user = await requirePermission("settings.integrations");

  try {
    const outcome = await syncAll(user.id, scope);
    return { ok: true, summary: outcome };
  } catch (error) {
    // A CalDAV server that is down should read as a failed sync, not a crashed
    // settings page — nothing here is destructive and it can simply be retried.
    return {
      ok: false,
      error:
        error instanceof Error
          ? `Sync failed: ${error.message}`
          : "Sync failed for an unknown reason.",
    };
  }
}

export type CheckResult = { ok: boolean; message: string };

/**
 * One request to the system account's calendar list.
 *
 * The point is to separate "QuickTec cannot reach NextCloud" from "the jobs
 * have nothing to put in a calendar" without anybody reading container logs.
 * It answers in the words of whatever refused: an app password that was never
 * set, a proxy in the way, DNS that does not resolve from inside the container.
 */
export async function checkCalendarAccess(): Promise<CheckResult> {
  await requirePermission("settings.integrations");

  const config = calDavConfigFromEnv();
  if (!config) {
    return {
      ok: false,
      message:
        "CalDAV is not configured. Set CALDAV_USERNAME and CALDAV_PASSWORD, using a NextCloud app password.",
    };
  }

  const result = await checkAccess(config);
  if (result.ok) {
    return {
      ok: true,
      message: `Signed in to ${calendarHome(config)} as ${config.username}.`,
    };
  }

  if (result.status === 401) {
    return {
      ok: false,
      message: `${config.username} was refused (HTTP 401). CALDAV_PASSWORD has to be an app password generated for that account, not its login password.`,
    };
  }

  if (result.status === 404) {
    return {
      ok: false,
      message: `No calendar home at ${calendarHome(config)} (HTTP 404). Check that CALDAV_USERNAME is the NextCloud username exactly, including its case.`,
    };
  }

  return {
    ok: false,
    message: `Could not reach ${calendarHome(config)}: ${describeFailure(result)}`,
  };
}
