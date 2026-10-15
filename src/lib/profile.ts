import type { BaseRole, PreferredPhone, PrivacyLevel } from "@prisma-client";
import { db } from "@/lib/db";
import { formatPhone } from "@/lib/phone";
import {
  audienceSees,
  effectivePreferred,
  levelFor,
  privacySettings,
  type Audience,
  type Phones,
  type PrivacySettings,
  type ProfileField,
} from "@/lib/profile-privacy";
import { isGuest } from "@/lib/permissions";
import { can, permissionScope, reachableUserIds, type SessionUser } from "@/lib/session";
import { canSupervise } from "@/lib/supervisors";

/**
 * Somebody's profile, as one particular person may see it.
 *
 * The levels themselves live in profile-privacy.ts; this is the part that has
 * to ask the database — who the viewer is to the person they are looking at,
 * and what the company changed about the defaults.
 */

export async function loadPrivacySettings(): Promise<PrivacySettings> {
  const rows = await db.profilePrivacy.findMany({
    select: { field: true, level: true, allowPublic: true },
  });
  return privacySettings(rows);
}

/** Company managers: the roles a direct supervisor is picked from. */
const COMPANY_MANAGERS: BaseRole[] = ["MANAGER", "ADMINISTRATOR"];

type Subject = { id: string; directSupervisorId: string | null; baseRole: BaseRole };

/**
 * Whether the viewer is this person's direct supervisor and still one. The
 * link stays on the person's record when their supervisor is moved to a role
 * that cannot supervise, and it is a link that opens their Restricted lines.
 */
export function isDirectSupervisorOf(
  viewer: SessionUser,
  subject: { directSupervisorId: string | null },
): boolean {
  return subject.directSupervisorId === viewer.id && canSupervise(viewer.baseRole);
}

/**
 * Whether the viewer may see this person's Restricted lines: they are the
 * person's direct supervisor, a company manager or somebody who manages
 * users, or they manage this tech on work that is still going on — as the
 * PM or a supervisor of a project the tech works on, or the supervisor of a
 * job the tech is on.
 *
 * Only techs are managed through the work. A PM can put anybody on one of
 * their jobs, and doing so must not be a way to read a colleague's — or a
 * manager's — home address. And only open work counts: a PM from a project
 * that closed two years ago has no business with somebody's address today.
 */
export async function seesRestricted(viewer: SessionUser, subject: Subject): Promise<boolean> {
  if (isGuest(viewer)) return false;
  if (viewer.id === subject.id) return true;
  if (isDirectSupervisorOf(viewer, subject)) return true;
  if (COMPANY_MANAGERS.includes(viewer.baseRole)) return true;
  // Whoever may edit somebody's profile has to be able to read it.
  if (managesProfiles(viewer)) return true;

  if (subject.baseRole !== "TECH") return false;

  if (viewer.scopedProjectIds.length > 0) {
    const managed = await db.project.count({
      where: {
        id: { in: viewer.scopedProjectIds },
        status: { not: "CLOSED" },
        // Not somebody who runs the project themselves.
        members: { none: { userId: subject.id, role: { in: ["PROJECT_MANAGER", "SUPERVISOR"] } } },
        OR: [{ managerId: null }, { managerId: { not: subject.id } }],
        AND: [
          {
            OR: [
              { members: { some: { userId: subject.id, role: "TECH" } } },
              { jobs: { some: { assignments: { some: { userId: subject.id } } } } },
            ],
          },
        ],
      },
    });
    if (managed > 0) return true;
  }

  const supervised = await db.jobAssignment.count({
    where: {
      userId: subject.id,
      supervisorId: viewer.id,
      job: { lifecycle: { notIn: ["CLOSED", "REJECTED"] } },
    },
  });
  return supervised > 0;
}

/** Who the viewer is to the person whose profile they are looking at. */
export async function audienceFor(viewer: SessionUser, subject: Subject): Promise<Audience> {
  if (viewer.id === subject.id) return "SELF";
  if (isGuest(viewer)) return "PUBLIC";
  return (await seesRestricted(viewer, subject)) ? "RESTRICTED" : "FEDERATED";
}

/** Whether the history of somebody's profile is the viewer's to read. */
export function seesHistory(audience: Audience): boolean {
  return audience === "SELF" || audience === "RESTRICTED";
}

/**
 * Whether the viewer may change other people's profiles. Somebody's direct
 * supervisor always may; past them it is whoever manages users.
 */
export function managesProfiles(viewer: SessionUser): boolean {
  return can(viewer, "users.manage", { minScope: "ALL" });
}

export function mayEditProfileOf(
  viewer: SessionUser,
  subject: { id: string; directSupervisorId: string | null },
): boolean {
  if (isGuest(viewer) || viewer.id === subject.id) return false;
  return isDirectSupervisorOf(viewer, subject) || managesProfiles(viewer);
}

/**
 * Whether changing this person's legal name, years of service or picture is
 * somebody else's to do: they have a direct supervisor, and it is not the
 * viewer. Allowed, but only past a warning, and their supervisor is told.
 */
export function notTheirEmployee(
  viewer: SessionUser,
  subject: { directSupervisorId: string | null },
): boolean {
  return Boolean(subject.directSupervisorId) && subject.directSupervisorId !== viewer.id;
}

export const PROFILE_SELECT = {
  id: true,
  name: true,
  email: true,
  legalName: true,
  legalNameSetAt: true,
  baseRole: true,
  active: true,
  signInMethod: true,
  directSupervisorId: true,
  directSupervisor: { select: { id: true, name: true } },
  serviceStartDate: true,
  phone: true,
  workPhone: true,
  voipPhone: true,
  preferredPhone: true,
  addressLine1: true,
  addressLine2: true,
  city: true,
  state: true,
  postalCode: true,
  country: true,
  timeZone: true,
  timeZoneManual: true,
  primaryRegion: true,
  statesOfOperation: true,
  avatarPath: true,
  avatarVisibility: true,
  pictureSetAt: true,
  defaultPayType: true,
  defaultPayRate: true,
} as const;

export type ProfileRecord = {
  id: string;
  name: string;
  email: string;
  legalName: string | null;
  legalNameSetAt: Date | null;
  baseRole: BaseRole;
  active: boolean;
  signInMethod: "SSO" | "LOCAL";
  directSupervisorId: string | null;
  directSupervisor: { id: string; name: string } | null;
  serviceStartDate: Date | null;
  phone: string | null;
  workPhone: string | null;
  voipPhone: string | null;
  preferredPhone: PreferredPhone | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  timeZone: string;
  timeZoneManual: boolean;
  primaryRegion: string | null;
  statesOfOperation: string[];
  avatarPath: string | null;
  avatarVisibility: PrivacyLevel;
  pictureSetAt: Date | null;
  defaultPayType: string | null;
  defaultPayRate: { toString(): string } | null;
};

export function phonesOf(profile: {
  phone: string | null;
  workPhone: string | null;
  voipPhone: string | null;
}): Phones {
  return { personal: profile.phone, work: profile.workPhone, voip: profile.voipPhone };
}

/** The level of each field for this person. */
export function levelsFor(
  profile: ProfileRecord,
  settings: PrivacySettings,
): Record<ProfileField, PrivacyLevel> {
  const subject = {
    preferredPhone: profile.preferredPhone,
    phones: phonesOf(profile),
    avatarVisibility: profile.avatarVisibility,
  };
  const levels = {} as Record<ProfileField, PrivacyLevel>;
  for (const field of Object.keys(settings) as ProfileField[]) {
    levels[field] = levelFor(field, settings, subject);
  }
  return levels;
}

/**
 * Whether a field may be shown to this audience. Use with levelsFor — every
 * read of a profile for somebody other than its owner goes through here.
 */
export function shows(
  levels: Record<ProfileField, PrivacyLevel>,
  audience: Audience,
  field: ProfileField,
): boolean {
  return audienceSees(audience, levels[field]);
}

export type ContactPhone = { kind: PreferredPhone; number: string; preferred: boolean };

/**
 * The phones that go with somebody's name to a given audience: the preferred
 * one, then the VoIP line beside it. When the VoIP line is the preferred one
 * it goes alone, and says it is VoIP.
 */
export function contactPhones(
  profile: ProfileRecord,
  levels: Record<ProfileField, PrivacyLevel>,
  audience: Audience,
): ContactPhone[] {
  const phones = phonesOf(profile);
  const preferred = effectivePreferred(profile.preferredPhone, phones);
  const result: ContactPhone[] = [];

  if (preferred && shows(levels, audience, "preferredPhone")) {
    const number = { PERSONAL: phones.personal, WORK: phones.work, VOIP: phones.voip }[preferred];
    if (number) result.push({ kind: preferred, number, preferred: true });
  }
  if (preferred !== "VOIP" && phones.voip && shows(levels, audience, "voipPhone")) {
    result.push({ kind: "VOIP", number: phones.voip, preferred: false });
  }
  return result;
}

/** What goes out to clients as the tech's contact details. */
export type ContactCard = {
  name: string;
  phones: ContactPhone[];
  email: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  timeZone: string | null;
  hasPicture: boolean;
};

export function contactCard(
  profile: ProfileRecord,
  settings: PrivacySettings,
  audience: Audience = "PUBLIC",
): ContactCard {
  const levels = levelsFor(profile, settings);
  const show = (field: ProfileField) => shows(levels, audience, field);
  return {
    name: show("name") ? profile.name : "",
    phones: contactPhones(profile, levels, audience),
    email: show("email") ? profile.email : null,
    city: show("city") ? profile.city : null,
    state: show("state") ? profile.state : null,
    zip: show("zip") ? profile.postalCode : null,
    timeZone: show("timeZone") ? profile.timeZone : null,
    hasPicture: Boolean(profile.avatarPath) && show("picture"),
  };
}

export async function loadProfile(userId: string): Promise<ProfileRecord | null> {
  return db.user.findUnique({ where: { id: userId }, select: PROFILE_SELECT });
}

/**
 * The contact details that go out to clients for each of these people — only
 * their Public lines, whatever anybody here may see.
 */
export async function loadContactCards(userIds: string[]): Promise<Map<string, ContactCard>> {
  const cards = new Map<string, ContactCard>();
  if (userIds.length === 0) return cards;
  const [people, settings] = await Promise.all([
    db.user.findMany({ where: { id: { in: userIds } }, select: PROFILE_SELECT }),
    loadPrivacySettings(),
  ]);
  for (const person of people) cards.set(person.id, contactCard(person, settings, "PUBLIC"));
  return cards;
}

/** "559-555-0110", or "559-555-0199 (VoIP)" when the VoIP line is the one. */
export function preferredPhoneLine(card: ContactCard): string | null {
  const preferred = card.phones.find((phone) => phone.preferred) ?? card.phones[0];
  if (!preferred) return null;
  const number = formatPhone(preferred.number) || preferred.number;
  return preferred.kind === "VOIP" ? `${number} (VoIP)` : number;
}

/** Every Public phone, the VoIP line named: "559-555-0110, VoIP 559-555-0199". */
export function phonesLine(card: ContactCard): string | null {
  const parts = card.phones.map((phone) => {
    const number = formatPhone(phone.number) || phone.number;
    return phone.kind === "VOIP" ? `VoIP ${number}` : number;
  });
  return parts.length > 0 ? parts.join(", ") : null;
}

/**
 * How the viewer may reach somebody: the phone and email their profile lets
 * this viewer see. The preferred phone first; failing that, whichever other
 * number this viewer may see — a tech whose supervisor never chose one still
 * needs a number, but not one the supervisor keeps Restricted.
 */
export async function reachableContact(
  viewer: SessionUser,
  userId: string,
): Promise<{ phone: string | null; email: string | null }> {
  const profile = await loadProfile(userId);
  if (!profile) return { phone: null, email: null };
  const [audience, settings] = await Promise.all([
    audienceFor(viewer, profile),
    loadPrivacySettings(),
  ]);
  const levels = levelsFor(profile, settings);
  const preferred = contactPhones(profile, levels, audience)[0]?.number ?? null;
  const fallback = (
    [
      ["workPhone", profile.workPhone],
      ["voipPhone", profile.voipPhone],
      ["personalPhone", profile.phone],
    ] as [ProfileField, string | null][]
  ).find(([field, number]) => number && shows(levels, audience, field))?.[1];
  return {
    phone: preferred ?? fallback ?? null,
    email: shows(levels, audience, "email") ? profile.email : null,
  };
}

/**
 * Whether the viewer may see this person's pay rate. Its privacy level says
 * who may in principle; "View pay rates" in the permission matrix says who
 * may in fact, and how far it reaches. A profile is not a way round the
 * matrix.
 */
export async function seesPayOf(viewer: SessionUser, subjectId: string): Promise<boolean> {
  if (viewer.id === subjectId) return true;
  const scope = permissionScope(viewer, "pay.view_rates");
  if (!scope || scope === "OWN") return false;
  const reach = await reachableUserIds(viewer, scope);
  return reach === null || reach.includes(subjectId);
}
