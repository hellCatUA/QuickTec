"use server";

import { getCompanySettings } from "@/lib/company";
import { usDateTimeInZone } from "@/lib/datetime";
import { audienceFor, loadProfile, seesHistory, seesPayOf } from "@/lib/profile";
import { isHistoryField, profileHistory, type HistoryEntry } from "@/lib/profile-history";
import { getSessionUser } from "@/lib/session";

export type FieldHistoryEntry = {
  id: string;
  /** "10-19-2026 8:56 AM", on the company's clock. */
  at: string;
  action: string;
  from: string | null;
  to: string | null;
  list: HistoryEntry["list"];
  requested: string | null;
  by: string;
  approvedBy: string | null;
  source: string | null;
  reason: string | null;
};

export type FieldHistoryResult =
  | { ok: true; entries: FieldHistoryEntry[] }
  | { ok: false; error: string };

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

  // On the company's clock, written as every other time in the app is. It
  // had a stamp of its own — "08:58 AM", in whatever zone the reader was in —
  // so two managers reading one change saw two different times.
  const [entries, company] = await Promise.all([profileHistory(userId, field), getCompanySettings()]);
  return {
    ok: true,
    entries: entries.map((entry) => ({
      ...entry,
      at: usDateTimeInZone(entry.at, company.defaultTimeZone),
    })),
  };
}
