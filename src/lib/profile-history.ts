import type { Prisma } from "@prisma-client";
import { recordAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { isProfileField, PROFILE_FIELDS, type ProfileField } from "@/lib/profile-privacy";

/**
 * The history of somebody's profile, field by field.
 *
 * Kept in the audit trail like every other change to a person, one event per
 * field, so a single field's story is a filter rather than a search through
 * diffs. Values are stored the way they read on screen: the history shows
 * what somebody saw, not what the database held.
 *
 * Only the person, their direct supervisor and managers read it — the
 * audience that sees Restricted lines anyway — so the values are not masked.
 */

export type ProfileEventKind =
  | "changed"
  | "requested"
  | "withdrawn"
  | "approved"
  | "denied"
  | "imported";

const ACTION: Record<ProfileEventKind, string> = {
  changed: "profile.changed",
  requested: "profile.requested",
  withdrawn: "profile.withdrawn",
  approved: "profile.approved",
  denied: "profile.denied",
  imported: "profile.imported",
};

export type ProfileChange = {
  field: ProfileField;
  from: string | null;
  to: string | null;
};

/**
 * Records changes to somebody's profile, one event each.
 *
 * `warned` marks a change made by a manager who is not the person's direct
 * supervisor, past the warning that said so.
 */
export async function recordProfileEvents(input: {
  actorId: string | null;
  userId: string;
  kind: ProfileEventKind;
  changes: ProfileChange[];
  note?: string | null;
  warned?: boolean;
  source?: string;
}): Promise<void> {
  for (const change of input.changes) {
    const detail: Record<string, Prisma.InputJsonValue> = { field: change.field };
    if (change.from !== null) detail.from = change.from;
    if (change.to !== null) detail.to = change.to;
    if (input.note) detail.reason = input.note;
    if (input.warned) detail.warned = true;
    if (input.source) detail.source = input.source;
    await recordAudit({
      actorId: input.actorId,
      entityType: "User",
      entityId: input.userId,
      action: ACTION[input.kind],
      detail,
    });
  }
}

/** Only what actually moved, ready to record. */
export function profileChanges(
  before: Partial<Record<ProfileField, string | null>>,
  after: Partial<Record<ProfileField, string | null>>,
): ProfileChange[] {
  const changes: ProfileChange[] = [];
  for (const [field, to] of Object.entries(after) as [ProfileField, string | null][]) {
    const from = before[field] ?? null;
    if ((from ?? "") !== (to ?? "")) changes.push({ field, from, to: to ?? null });
  }
  return changes;
}

export type HistoryEntry = {
  id: string;
  at: Date;
  field: ProfileField | null;
  fieldLabel: string;
  kind: ProfileEventKind;
  actor: string | null;
  from: string | null;
  to: string | null;
  note: string | null;
  warned: boolean;
  source: string | null;
};

/**
 * Columns changed before profiles existed, through the users page or the old
 * account form, and the field each one now is. Their events go on the same
 * timeline, so nothing anybody did before today drops out of the story.
 */
const LEGACY_COLUMNS: Record<string, ProfileField> = {
  name: "name",
  legalName: "legalName",
  phone: "personalPhone",
  addressLine1: "street",
  addressLine2: "street",
  city: "city",
  state: "state",
  postalCode: "zip",
  timeZone: "timeZone",
  directSupervisorId: "directSupervisor",
};

function text(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

function entriesFrom(event: {
  id: string;
  action: string;
  createdAt: Date;
  detail: Prisma.JsonValue;
  actor: { name: string } | null;
}): HistoryEntry[] {
  const detail = (event.detail ?? {}) as Record<string, unknown>;
  const actor = event.actor?.name ?? null;

  const kind = (Object.entries(ACTION).find(([, action]) => action === event.action)?.[0] ??
    null) as ProfileEventKind | null;

  if (kind) {
    const field = isProfileField(detail.field) ? detail.field : null;
    return [
      {
        id: event.id,
        at: event.createdAt,
        field,
        fieldLabel: field ? PROFILE_FIELDS[field].label : String(detail.field ?? "Profile"),
        kind,
        actor,
        from: text(detail.from),
        to: text(detail.to),
        note: text(detail.reason),
        warned: detail.warned === true,
        source: text(detail.source),
      },
    ];
  }

  // The users page records a diff, { column: { from, to } }; the old account
  // form recorded only the new values, { column: value }.
  if (event.action !== "updated" && event.action !== "contact_updated") return [];
  const entries: HistoryEntry[] = [];
  for (const [column, value] of Object.entries(detail)) {
    const field = LEGACY_COLUMNS[column];
    if (!field) continue;
    const diff =
      value && typeof value === "object" && "to" in (value as object)
        ? (value as { from?: unknown; to?: unknown })
        : { to: value };
    // A supervisor change is recorded as ids; the name is what anybody wants,
    // and the change itself is the news.
    const ids = column === "directSupervisorId";
    entries.push({
      id: `${event.id}:${column}`,
      at: event.createdAt,
      field,
      fieldLabel: PROFILE_FIELDS[field].label,
      kind: "changed",
      actor,
      from: ids ? null : text(diff.from),
      to: ids ? null : text(diff.to),
      note: null,
      warned: false,
      source: null,
    });
  }
  return entries;
}

/** Newest first. Pass a field for that field's story alone. */
export async function profileHistory(
  userId: string,
  field?: ProfileField | null,
): Promise<HistoryEntry[]> {
  const events = await db.auditEvent.findMany({
    where: {
      entityType: "User",
      entityId: userId,
      action: { in: [...Object.values(ACTION), "updated", "contact_updated"] },
    },
    orderBy: { createdAt: "desc" },
    take: 300,
    select: {
      id: true,
      action: true,
      createdAt: true,
      detail: true,
      actor: { select: { name: true } },
    },
  });

  const entries = events.flatMap(entriesFrom);
  return field ? entries.filter((entry) => entry.field === field) : entries;
}
