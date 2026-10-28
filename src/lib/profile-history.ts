import type { Prisma } from "@prisma-client";
import { recordAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { LEVEL_INFO } from "@/lib/profile-privacy";

/**
 * The history of somebody's profile, line by line.
 *
 * Kept in the audit trail like every other change to a person, one event per
 * line, so a line's story is a filter rather than a search through diffs.
 * Values are stored the way they read on screen: the history shows what
 * somebody saw, not what the database held.
 *
 * Each entry says what happened to the line, the value before and after
 * where there is one, who did it, who approved it when that was somebody
 * else, where it came from when it was not typed in, and why when there is a
 * why. A request is one entry once it is approved — by whoever asked, approved
 * by whoever answered. Waiting or withdrawn, it is not history yet; turned
 * down, it is an entry of its own.
 *
 * Only the person, their direct supervisor and managers read it — the
 * audience that sees Restricted lines anyway — so the values are not masked.
 */

/** The lines a history is kept for. Street and Home region are one line each, as on the page. */
export const HISTORY_FIELDS = {
  picture: "Profile picture",
  name: "Preferred name",
  legalName: "Legal name",
  role: "Role",
  directSupervisor: "Direct supervisor",
  yearsOfService: "Years of service",
  preferredPhone: "Preferred phone",
  personalPhone: "Personal phone",
  workPhone: "Work phone",
  voipPhone: "VoIP",
  email: "Work email",
  street: "Street address",
  homeRegion: "Home region",
  timeZone: "Time zone",
  primaryRegion: "Primary region",
  statesOfOperation: "States of operation",
  defaultPayRate: "Default pay rate",
} as const;

export type HistoryField = keyof typeof HISTORY_FIELDS;

export function isHistoryField(value: unknown): value is HistoryField {
  return typeof value === "string" && value in HISTORY_FIELDS;
}

/**
 * What happened to the line. Added, updated and removed follow from the
 * values and need not be said; the rest are their own kind of event.
 */
export type HistoryVerb =
  | "added"
  | "updated"
  | "removed"
  | "restored"
  | "visibility"
  | "reset"
  | "denied";

export type ProfileChange = {
  field: HistoryField;
  from: string | null;
  to: string | null;
  verb?: HistoryVerb;
};

/** Who approved a change, when it was not whoever made it. */
export type Approval = { byId: string } | { bySystem: true };

/** What a manager who is not the direct supervisor did past the warning, said as the reason. */
const PAST_THE_WARNING = "Not their direct supervisor — changed past the warning";

/**
 * Records changes to somebody's profile, one event each.
 *
 * `actorId` is who did it, or asked for it — null for QuickTec itself.
 * `warned` marks a manager who is not the person's direct supervisor, past
 * the warning that said so; it is shown as the reason when there is no other.
 */
export async function recordProfileEvents(input: {
  actorId: string | null;
  userId: string;
  changes: ProfileChange[];
  /** A request turned down: an entry of its own. */
  denied?: boolean;
  approval?: Approval | null;
  source?: string | null;
  reason?: string | null;
  warned?: boolean;
}): Promise<void> {
  for (const change of input.changes) {
    const detail: Record<string, Prisma.InputJsonValue> = { field: change.field };
    if (change.verb) detail.verb = change.verb;
    if (input.denied) detail.verb = "denied";
    if (change.from !== null) detail.from = change.from;
    if (change.to !== null) detail.to = change.to;
    if (input.reason) detail.reason = input.reason;
    if (input.warned) detail.warned = true;
    if (input.source) detail.source = input.source;
    if (input.approval && "byId" in input.approval) detail.approvedById = input.approval.byId;
    if (input.approval && "bySystem" in input.approval) detail.approvedBySystem = true;
    await recordAudit({
      actorId: input.actorId,
      entityType: "User",
      entityId: input.userId,
      action: input.denied ? "profile.denied" : "profile.changed",
      detail,
    });
  }
}

/** Only what actually moved, ready to record. */
export function profileChanges(
  before: Partial<Record<HistoryField, string | null>>,
  after: Partial<Record<HistoryField, string | null>>,
): ProfileChange[] {
  const changes: ProfileChange[] = [];
  for (const [field, to] of Object.entries(after) as [HistoryField, string | null][]) {
    const from = before[field] ?? null;
    if ((from ?? "") !== (to ?? "")) changes.push({ field, from, to: to ?? null });
  }
  return changes;
}

/**
 * States of operation as what was added and what was taken off, rather than
 * two lists to compare by eye.
 */
export function statesChange(before: string[], after: string[], name: (code: string) => string): ProfileChange[] {
  const added = after.filter((code) => !before.includes(code)).map(name);
  const removed = before.filter((code) => !after.includes(code)).map(name);
  if (added.length === 0 && removed.length === 0) return [];
  return [
    {
      field: "statesOfOperation",
      from: removed.length > 0 ? removed.join(", ") : null,
      to: added.length > 0 ? added.join(", ") : null,
    },
  ];
}

export type HistoryEntry = {
  id: string;
  at: Date;
  field: HistoryField;
  /** "Profile picture updated" — what happened, as the entry's heading. */
  action: string;
  /** The value line: the old one struck through, the new one after an arrow. */
  from: string | null;
  to: string | null;
  /**
   * What a request turned down asked for. Said as its own line, not as the
   * value line, so it cannot be read as a change that was made.
   */
  requested: string | null;
  by: string;
  approvedBy: string | null;
  source: string | null;
  reason: string | null;
};

function text(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

function heading(field: HistoryField, verb: HistoryVerb, from: string | null): string {
  const label = HISTORY_FIELDS[field];
  switch (verb) {
    case "visibility":
      return `${label} visibility changed`;
    case "reset":
      return `${label} reset to NextCloud`;
    case "denied":
      return `${label} ${from ? "update" : "add"} request denied`;
    default:
      return `${label} ${verb}`;
  }
}

function verbOf(from: string | null, to: string | null): HistoryVerb {
  if (!from) return "added";
  if (!to) return "removed";
  return "updated";
}

/** The level names a picture's visibility was recorded with, old and new. */
const LEVEL_LABELS = new Set(Object.values(LEVEL_INFO).map((info) => info.label));
function levelText(value: string | null): string | null {
  if (!value) return null;
  const bare = value.replace(/^Shown to /, "");
  return LEVEL_LABELS.has(bare) ? bare : null;
}

/**
 * Columns the users page recorded as a diff before it wrote history of its
 * own, and the line each one is. Their events stay on the timeline.
 */
const LEGACY_COLUMNS: Record<string, HistoryField> = {
  name: "name",
  legalName: "legalName",
  phone: "personalPhone",
  addressLine1: "street",
  addressLine2: "street",
  city: "homeRegion",
  state: "homeRegion",
  postalCode: "homeRegion",
  timeZone: "timeZone",
  directSupervisorId: "directSupervisor",
};

/** Lines recorded before they were combined. */
const LEGACY_FIELDS: Record<string, HistoryField> = {
  city: "homeRegion",
  state: "homeRegion",
  zip: "homeRegion",
};

type RawEvent = {
  id: string;
  action: string;
  createdAt: Date;
  detail: Prisma.JsonValue;
  actor: { name: string } | null;
};

function entriesFrom(
  event: RawEvent,
  subjectName: string,
  names: Map<string, string>,
): Array<HistoryEntry & { legacyPart?: boolean }> {
  const detail = (event.detail ?? {}) as Record<string, unknown>;
  const actor = event.actor?.name ?? "System";

  if (event.action.startsWith("profile.")) {
    // Asked for and not yet answered, or taken back: not history.
    if (event.action === "profile.requested" || event.action === "profile.withdrawn") return [];

    const field = isHistoryField(detail.field)
      ? detail.field
      : (LEGACY_FIELDS[String(detail.field)] ?? null);
    if (!field) return [];
    const legacyPart = !isHistoryField(detail.field);

    let from = text(detail.from);
    let to = text(detail.to);
    let verb: HistoryVerb = (text(detail.verb) as HistoryVerb | null) ?? verbOf(from, to);
    let by = actor;
    let approvedBy = text(detail.approvedById)
      ? (names.get(String(detail.approvedById)) ?? "Someone since removed")
      : detail.approvedBySystem === true
        ? "System"
        : null;
    let source = text(detail.source);

    // Before requests were one entry, an answer was recorded under whoever
    // gave it, with no word of who approved. The request was always the
    // person's own.
    const legacyAnswer =
      (event.action === "profile.approved" || event.action === "profile.denied") &&
      detail.approvedById === undefined;
    if (event.action === "profile.denied") verb = "denied";
    if (legacyAnswer) {
      by = subjectName;
      approvedBy = actor;
    }
    if (event.action === "profile.imported") {
      by = "System";
      source = "Auto-Import: NC";
      verb = "added";
    }

    if (field === "picture") {
      // A picture has no value to show — except who sees it.
      const fromLevel = levelText(from);
      const toLevel = levelText(to);
      if (verb === "visibility" || (fromLevel && toLevel)) {
        verb = "visibility";
        from = fromLevel ?? from;
        to = toLevel ?? to;
      } else {
        if (!source && verb !== "denied" && verb !== "removed") {
          source = /Photo ID/i.test(to ?? "") ? "Manual Import: ID" : `Manual Import: ${by}`;
        }
        if (source === "NextCloud") source = "Auto-Import: NC";
        from = null;
        to = null;
      }
    }

    const reasons = [
      text(detail.reason),
      detail.warned === true ? PAST_THE_WARNING : null,
    ].filter(Boolean);

    // Turned down, nothing changed: what was asked for, and no value line.
    const denied = verb === "denied";

    return [
      {
        id: event.id,
        at: event.createdAt,
        field,
        action: heading(field, verb, text(detail.from)),
        from: denied ? null : from,
        to: denied ? null : to,
        requested: denied ? to : null,
        by,
        approvedBy,
        source,
        reason: reasons.length > 0 ? reasons.join(" · ") : null,
        ...(legacyPart ? { legacyPart: true } : {}),
      },
    ];
  }

  // The users page's diffs, { column: { from, to } }, and the old account
  // form's new values, { column: value }. A diff written alongside history
  // of its own is marked, and left to that history.
  if (event.action !== "updated" && event.action !== "contact_updated") return [];
  if (detail._profile === true) return [];
  // The old account form recorded only the new values; a value it cleared
  // says nothing worth reading.
  const valuesOnly = event.action === "contact_updated";
  // Columns that are one line now — city, state and ZIP; the two street
  // lines — become one entry, their parts joined as the line reads.
  const parts = new Map<HistoryField, { from: string[]; to: string[] }>();
  for (const [column, value] of Object.entries(detail)) {
    const field = LEGACY_COLUMNS[column];
    if (!field) continue;
    const diff =
      value && typeof value === "object" && "to" in (value as object)
        ? (value as { from?: unknown; to?: unknown })
        : { to: value };
    // A supervisor is recorded by id; the name is what anybody reads.
    const person = (id: unknown) =>
      text(id) ? (names.get(String(id)) ?? "Someone since removed") : null;
    const ids = column === "directSupervisorId";
    const from = ids ? person(diff.from) : text(diff.from);
    const to = ids ? person(diff.to) : text(diff.to);
    if (valuesOnly && !to) continue;
    const line = parts.get(field) ?? { from: [], to: [] };
    if (from) line.from.push(from);
    if (to) line.to.push(to);
    parts.set(field, line);
  }
  return [...parts].map(([field, line]) => {
    const from = line.from.length > 0 ? line.from.join(", ") : null;
    const to = line.to.length > 0 ? line.to.join(", ") : null;
    return {
      id: `${event.id}:${field}`,
      at: event.createdAt,
      field,
      action: heading(field, valuesOnly ? "updated" : verbOf(from, to), from),
      from,
      to,
      requested: null,
      by: actor,
      approvedBy: null,
      source: null,
      reason: null,
    };
  });
}

/**
 * Home region parts recorded as separate events before the line was one —
 * city, state and ZIP saved together — read back as one entry.
 */
function joinLegacyParts(entries: Array<HistoryEntry & { legacyPart?: boolean }>): HistoryEntry[] {
  const joined: Array<HistoryEntry & { legacyPart?: boolean }> = [];
  for (const entry of entries) {
    const last = joined[joined.length - 1];
    if (
      entry.legacyPart &&
      last?.legacyPart &&
      last.field === entry.field &&
      last.by === entry.by &&
      Math.abs(last.at.getTime() - entry.at.getTime()) < 2000
    ) {
      const from = [last.from, entry.from].filter(Boolean).join(", ") || null;
      const to = [last.to, entry.to].filter(Boolean).join(", ") || null;
      joined[joined.length - 1] = {
        ...last,
        from,
        to,
        action: heading(entry.field, verbOf(from, to), from),
      };
      continue;
    }
    joined.push(entry);
  }
  return joined.map(({ legacyPart: _part, ...entry }) => entry);
}

/** Newest first. Pass a line for that line's story alone. */
export async function profileHistory(
  userId: string,
  field?: HistoryField | null,
): Promise<HistoryEntry[]> {
  // One line's story is asked for by its name — and the names it had before
  // it was one line — so a busy line does not push a quiet one's out.
  const fieldNames = field
    ? [field, ...Object.entries(LEGACY_FIELDS).filter(([, to]) => to === field).map(([from]) => from)]
    : null;
  const [subject, events] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { name: true } }),
    db.auditEvent.findMany({
      where: {
        entityType: "User",
        entityId: userId,
        OR: [
          {
            action: { startsWith: "profile." },
            ...(fieldNames
              ? { OR: fieldNames.map((name) => ({ detail: { path: ["field"], equals: name } })) }
              : {}),
          },
          { action: { in: ["updated", "contact_updated"] } },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 500,
      select: {
        id: true,
        action: true,
        createdAt: true,
        detail: true,
        actor: { select: { name: true } },
      },
    }),
  ]);

  // Names for whoever approved, and for supervisors recorded by id.
  const ids = new Set<string>();
  for (const event of events) {
    const detail = (event.detail ?? {}) as Record<string, unknown>;
    if (typeof detail.approvedById === "string") ids.add(detail.approvedById);
    const supervisor = detail.directSupervisorId as { from?: unknown; to?: unknown } | undefined;
    if (supervisor && typeof supervisor === "object") {
      if (typeof supervisor.from === "string") ids.add(supervisor.from);
      if (typeof supervisor.to === "string") ids.add(supervisor.to);
    }
  }
  const people =
    ids.size > 0
      ? await db.user.findMany({ where: { id: { in: [...ids] } }, select: { id: true, name: true } })
      : [];
  const names = new Map(people.map((person) => [person.id, person.name]));

  const entries = joinLegacyParts(
    events.flatMap((event) => entriesFrom(event, subject?.name ?? "", names)),
  );
  return field ? entries.filter((entry) => entry.field === field) : entries;
}
