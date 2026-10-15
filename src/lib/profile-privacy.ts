import type { PreferredPhone, PrivacyLevel } from "@prisma-client";

/**
 * Who may see each line of somebody's profile.
 *
 * Three levels, nested: everybody who may see a Restricted line may see a
 * Federated one, and everybody who may see a Federated line may see a Public
 * one. A person cannot move their own lines between them — the company sets
 * that, under Settings → Roles & permissions → Privacy — with one exception:
 * the picture, where they pick between the levels the company allows.
 *
 * The defaults below are the optimized defaults, and restoring them is
 * forgetting every change the company made. Pure, so the profile page and the
 * settings page can label things with it in the browser.
 */

export const PRIVACY_LEVELS: PrivacyLevel[] = ["RESTRICTED", "FEDERATED", "PUBLIC"];

export const LEVEL_INFO: Record<PrivacyLevel, { label: string; description: string }> = {
  RESTRICTED: {
    label: "Restricted",
    description:
      "Only visible to you, your direct supervisor & company/project/team/job managers",
  },
  FEDERATED: {
    label: "Federated",
    description: "Only visible to users on QuickTec",
  },
  PUBLIC: {
    label: "Public",
    description:
      "Visible to all users on QuickTec, Vendors, Partners, Buyers & Clients",
  },
};

export function isPrivacyLevel(value: unknown): value is PrivacyLevel {
  return PRIVACY_LEVELS.includes(value as PrivacyLevel);
}

/** How open a level is: Restricted 0, Federated 1, Public 2. */
function openness(level: PrivacyLevel): number {
  return PRIVACY_LEVELS.indexOf(level);
}

/** The more closed of two levels. */
export function narrowest(a: PrivacyLevel, b: PrivacyLevel): PrivacyLevel {
  return openness(a) <= openness(b) ? a : b;
}

export const PROFILE_GROUPS = [
  "Name & role",
  "Phone & email",
  "Home address",
  "Work & pay",
] as const;

export type ProfileGroup = (typeof PROFILE_GROUPS)[number];

type FieldDefinition = {
  label: string;
  group: ProfileGroup;
  /** The optimized default. */
  level: PrivacyLevel;
  /**
   * The narrowest level the company may set. Some lines are shown all over
   * the app — the name on every job, the role and email in every picker — and
   * offering to restrict them would be a promise the rest of the app does
   * not keep.
   */
  minLevel?: PrivacyLevel;
  /** The field's one switch, where it has one: what it says, and its default. */
  allowPublic?: { label: string; default: boolean };
  /** Who changes it. Said, not configured. */
  changedBy: string;
};

export const PROFILE_FIELDS = {
  picture: {
    label: "Profile picture",
    group: "Name & role",
    level: "FEDERATED",
    allowPublic: { label: "Let the person make it Public", default: true },
    changedBy: "Direct supervisor; the person at onboarding, then by request",
  },
  name: {
    label: "Preferred name",
    group: "Name & role",
    level: "PUBLIC",
    // On the paperwork, the WM Form and every list: it is who they are.
    minLevel: "PUBLIC",
    changedBy: "The person; managers, on the users page",
  },
  legalName: {
    label: "Legal name",
    group: "Name & role",
    level: "RESTRICTED",
    changedBy: "Direct supervisor; the person at onboarding, then by request",
  },
  role: {
    label: "Role",
    group: "Name & role",
    level: "FEDERATED",
    minLevel: "FEDERATED",
    changedBy: "NextCloud groups; for an account held here, set when it is made",
  },
  directSupervisor: {
    label: "Direct supervisor",
    group: "Name & role",
    level: "FEDERATED",
    minLevel: "FEDERATED",
    changedBy: "Managers",
  },
  yearsOfService: {
    label: "Years of service",
    group: "Name & role",
    level: "FEDERATED",
    changedBy: "Direct supervisor",
  },
  preferredPhone: {
    label: "Preferred phone",
    group: "Phone & email",
    level: "PUBLIC",
    changedBy: "The person",
  },
  personalPhone: {
    label: "Personal phone",
    group: "Phone & email",
    level: "RESTRICTED",
    allowPublic: { label: "Public while it is the preferred phone", default: true },
    changedBy: "The person; managers, on the users page",
  },
  workPhone: {
    label: "Work phone",
    group: "Phone & email",
    level: "PUBLIC",
    changedBy: "The person, managers",
  },
  voipPhone: {
    label: "VoIP",
    group: "Phone & email",
    level: "PUBLIC",
    changedBy: "The person, managers",
  },
  email: {
    label: "Work email",
    group: "Phone & email",
    level: "PUBLIC",
    minLevel: "FEDERATED",
    changedBy: "NextCloud; for an account held here, set when it is made",
  },
  street: {
    label: "Street address",
    group: "Home address",
    level: "RESTRICTED",
    changedBy: "The person; managers, on the users page",
  },
  city: {
    label: "City",
    group: "Home address",
    level: "PUBLIC",
    changedBy: "The person; managers, on the users page",
  },
  state: {
    label: "State",
    group: "Home address",
    level: "PUBLIC",
    changedBy: "The person; managers, on the users page",
  },
  zip: {
    label: "ZIP",
    group: "Home address",
    level: "PUBLIC",
    changedBy: "The person; managers, on the users page",
  },
  timeZone: {
    label: "Time zone",
    group: "Home address",
    level: "PUBLIC",
    changedBy: "The person — from the ZIP until they pick one; managers, on the users page",
  },
  primaryRegion: {
    label: "Primary region",
    group: "Work & pay",
    level: "FEDERATED",
    changedBy: "The person, managers",
  },
  statesOfOperation: {
    label: "States of operation",
    group: "Work & pay",
    level: "FEDERATED",
    changedBy: "The person, managers",
  },
  defaultPayRate: {
    label: "Default pay rate",
    group: "Work & pay",
    level: "RESTRICTED",
    changedBy: "Managers who edit pay rates",
  },
} satisfies Record<string, FieldDefinition>;

export type ProfileField = keyof typeof PROFILE_FIELDS;

export const PROFILE_FIELD_KEYS = Object.keys(PROFILE_FIELDS) as ProfileField[];

export function isProfileField(value: unknown): value is ProfileField {
  return typeof value === "string" && value in PROFILE_FIELDS;
}

export function fieldDefinition(field: ProfileField): FieldDefinition {
  return PROFILE_FIELDS[field];
}

/** The levels the company may choose for a field, narrowest first. */
export function levelsAllowed(field: ProfileField): PrivacyLevel[] {
  const min = fieldDefinition(field).minLevel ?? "RESTRICTED";
  return PRIVACY_LEVELS.filter((level) => openness(level) >= openness(min));
}

/** The company's level for every field, the defaults filled in. */
export type PrivacySettings = Record<
  ProfileField,
  { level: PrivacyLevel; allowPublic: boolean }
>;

export type PrivacyOverride = {
  field: string;
  level: PrivacyLevel;
  allowPublic: boolean | null;
};

/**
 * The optimized defaults with the company's changes laid over them. A row for
 * a field this code no longer knows is ignored rather than trusted.
 */
export function privacySettings(overrides: PrivacyOverride[]): PrivacySettings {
  const settings = {} as PrivacySettings;
  for (const field of PROFILE_FIELD_KEYS) {
    const definition = fieldDefinition(field);
    settings[field] = {
      level: definition.level,
      allowPublic: definition.allowPublic?.default ?? false,
    };
  }
  for (const row of overrides) {
    if (!isProfileField(row.field)) continue;
    const definition = fieldDefinition(row.field);
    settings[row.field] = {
      // A row from before a field gained a floor is held to it.
      level: levelsAllowed(row.field).includes(row.level) ? row.level : definition.level,
      allowPublic: definition.allowPublic
        ? (row.allowPublic ?? definition.allowPublic.default)
        : false,
    };
  }
  return settings;
}

/** Whether a field differs from its optimized default. */
export function differsFromDefault(
  field: ProfileField,
  value: { level: PrivacyLevel; allowPublic: boolean },
): boolean {
  const definition = fieldDefinition(field);
  if (value.level !== definition.level) return true;
  return Boolean(definition.allowPublic) && value.allowPublic !== definition.allowPublic!.default;
}

// ---------------------------------------------------------------------------
// Phones
// ---------------------------------------------------------------------------

export type Phones = {
  personal: string | null;
  work: string | null;
  voip: string | null;
};

export const PHONE_LABEL: Record<PreferredPhone, string> = {
  PERSONAL: "Personal",
  WORK: "Work",
  VOIP: "VoIP",
};

/**
 * Which phones may be the preferred one. A number has to be on file to be
 * chosen, and the personal one cannot be while there is a work phone: a
 * company phone is the one a client should have.
 */
export function preferableKinds(phones: Phones): PreferredPhone[] {
  const kinds: PreferredPhone[] = [];
  if (phones.personal && !phones.work) kinds.push("PERSONAL");
  if (phones.work) kinds.push("WORK");
  if (phones.voip) kinds.push("VOIP");
  return kinds;
}

/** Why a phone cannot be the preferred one, or null when it can. */
export function whyNotPreferable(kind: PreferredPhone, phones: Phones): string | null {
  if (kind === "PERSONAL" && phones.work) {
    return "Not available while a work phone is filled in";
  }
  const number = { PERSONAL: phones.personal, WORK: phones.work, VOIP: phones.voip }[kind];
  return number ? null : "No number on file";
}

/**
 * The preferred phone as it stands: the one chosen when it still may be, and
 * otherwise the work phone or the VoIP line, whichever is on file.
 *
 * Never the personal phone unless somebody chose it. Being the preferred phone
 * is what makes a personal number Public, so falling back to it would put a
 * number nobody agreed to share on a client's paperwork — the person who only
 * ever gave the company their own number, or whose work phone a manager just
 * took away. Null when there is nothing it may be.
 */
export function effectivePreferred(
  chosen: PreferredPhone | null,
  phones: Phones,
): PreferredPhone | null {
  const allowed = preferableKinds(phones);
  if (chosen && allowed.includes(chosen)) return chosen;
  return allowed.find((kind) => kind !== "PERSONAL") ?? null;
}

// ---------------------------------------------------------------------------
// The level of a field for one person
// ---------------------------------------------------------------------------

export type PrivacySubject = {
  preferredPhone: PreferredPhone | null;
  phones: Phones;
  avatarVisibility: PrivacyLevel;
};

/**
 * The level a field sits at for this person. The same as the company's level
 * except for the two that move: the picture, which is Public when they chose
 * it and the company lets them, and the personal phone, which is Public while
 * it is the preferred one and the company lets it be.
 */
export function levelFor(
  field: ProfileField,
  settings: PrivacySettings,
  subject: PrivacySubject,
): PrivacyLevel {
  const { level, allowPublic } = settings[field];

  if (field === "picture") {
    return allowPublic && subject.avatarVisibility === "PUBLIC" ? "PUBLIC" : level;
  }
  if (field === "personalPhone") {
    const preferred = effectivePreferred(subject.preferredPhone, subject.phones);
    return allowPublic && preferred === "PERSONAL" ? "PUBLIC" : level;
  }
  if (field === "preferredPhone") {
    // The preferred phone is one of the three numbers, so it can be no more
    // open than that number is: setting the work phone to Federated has to
    // keep it off the paperwork even while it is the preferred one.
    const preferred = effectivePreferred(subject.preferredPhone, subject.phones);
    if (!preferred) return level;
    const underlying = levelFor(
      preferred === "PERSONAL" ? "personalPhone" : preferred === "WORK" ? "workPhone" : "voipPhone",
      settings,
      subject,
    );
    return narrowest(level, underlying);
  }
  return level;
}

/** Who is looking: the person, somebody who may see Restricted lines, anybody signed in, or the outside world. */
export type Audience = "SELF" | "RESTRICTED" | "FEDERATED" | "PUBLIC";

export function audienceSees(audience: Audience, level: PrivacyLevel): boolean {
  if (audience === "SELF" || audience === "RESTRICTED") return true;
  if (audience === "FEDERATED") return level !== "RESTRICTED";
  return level === "PUBLIC";
}

// ---------------------------------------------------------------------------
// Years of service
// ---------------------------------------------------------------------------

/** Whole years from a start date to today. */
export function yearsSince(start: Date, today: Date = new Date()): number {
  let years = today.getUTCFullYear() - start.getUTCFullYear();
  const month = today.getUTCMonth() - start.getUTCMonth();
  if (month < 0 || (month === 0 && today.getUTCDate() < start.getUTCDate())) years -= 1;
  return Math.max(0, years);
}

export function yearsLabel(start: Date | null, today: Date = new Date()): string | null {
  if (!start) return null;
  const years = yearsSince(start, today);
  if (years === 0) return "Less than a year";
  return years === 1 ? "1 year" : `${years} years`;
}
