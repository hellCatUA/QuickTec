"use server";

import { syncAll } from "@/lib/calendar/sync";
import { requirePermission } from "@/lib/session";
import type { SyncSummary } from "./calendar-panel";

export type SyncResult =
  | { ok: true; summary: SyncSummary }
  | { ok: false; error: string };

export async function runCalendarSync(): Promise<SyncResult> {
  const user = await requirePermission("settings.integrations");

  try {
    const outcome = await syncAll(user.id);
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
