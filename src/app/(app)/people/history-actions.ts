"use server";

import { pad, zonedParts } from "@/lib/datetime";
import { audienceFor, loadProfile, seesHistory, seesPayOf } from "@/lib/profile";
import { isHistoryField, profileHistory } from "@/lib/profile-history";
import { getSessionUser } from "@/lib/session";

export type FieldHistoryEntry = {
  id: string;
  /** "10-19-2026 08:56 AM", in the reader's own zone. */
  at: string;
  action: string;
  from: string | null;
  to: string | null;
  by: string;
  approvedBy: string | null;
  source: string | null;
  reason: string | null;
};

export type FieldHistoryResult =
  | { ok: true; entries: FieldHistoryEntry[] }
  | { ok: false; error: string };

function stamp(at: Date, timeZone: string): string {
  const parts = zonedParts(at, timeZone);
  const hour = parts.hour % 12 || 12;
  return `${pad(parts.month)}-${pad(parts.day)}-${parts.year} ${pad(hour)}:${pad(parts.minute)} ${parts.hour < 12 ? "AM" : "PM"}`;
}

/**
 * One line's history, for whoever may read it: the person, their direct
 * supervisor and managers — and for the pay rate, only those who may see the
 * rate. Asked for when the line's history is opened, not with the page.
 */
export async function loadFieldHistory(userId: string, field: string): Promise<FieldHistoryResult> {
  const viewer = await getSessionUser();
  if (!viewer) return { ok: false, error: "Not signed in." };
  if (!isHistoryField(field)) return { ok: false, error: "No such line." };

  const profile = await loadProfile(userId);
  if (!profile) return { ok: false, error: "No such person." };
  if (!seesHistory(await audienceFor(viewer, profile))) {
    return { ok: false, error: "Their history is not yours to read." };
  }
  if (field === "defaultPayRate" && !(await seesPayOf(viewer, userId))) {
    return { ok: false, error: "Their pay rate is not yours to read." };
  }

  const entries = await profileHistory(userId, field);
  return {
    ok: true,
    entries: entries.map((entry) => ({ ...entry, at: stamp(entry.at, viewer.timeZone) })),
  };
}
