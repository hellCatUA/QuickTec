import { BaseRole } from "@prisma-client";

/**
 * NextCloud group -> base role. The mapping is hard: it is re-read on every
 * login, so changing someone's role means changing their NextCloud group.
 * Fine-grained exceptions are made in-app through PermissionOverride, which
 * survives re-login because it is keyed on the user, not the role.
 */
export const GROUP_TO_ROLE: Record<string, BaseRole> = {
  "quicktec-admin": "ADMINISTRATOR",
  "quicktec-manager": "MANAGER",
  "quicktec-supervisor": "SUPERVISOR",
  "quicktec-tech": "TECH",
  "quicktec-accountant": "ACCOUNTANT",
};

/**
 * A user can sit in several groups. Highest precedence wins.
 *
 * MANAGER outranks ADMINISTRATOR because a Manager runs the business side of
 * every job, while Administrator is a narrow technical role (integrations,
 * users, backups). Someone who genuinely needs both gets `settings.integrations`
 * as a per-user override rather than a second base role.
 */
const ROLE_PRECEDENCE: BaseRole[] = [
  "MANAGER",
  "ADMINISTRATOR",
  "SUPERVISOR",
  "ACCOUNTANT",
  "TECH",
];

/** Returns null when the user is in none of the quicktec-* groups. */
export function resolveBaseRole(groups: string[]): BaseRole | null {
  const roles = new Set(
    groups
      .map((group) => GROUP_TO_ROLE[group.trim().toLowerCase()])
      .filter((role): role is BaseRole => Boolean(role)),
  );

  return ROLE_PRECEDENCE.find((role) => roles.has(role)) ?? null;
}

/**
 * NextCloud's OIDC provider app puts group membership in `roles` when the
 * `roles` scope is requested, but deployments differ — some emit `groups`.
 * Accept either, and tolerate a space/comma separated string.
 */
export function extractGroups(profile: Record<string, unknown>): string[] {
  const raw = profile.roles ?? profile.groups ?? [];

  if (Array.isArray(raw)) {
    return raw.filter((entry): entry is string => typeof entry === "string");
  }
  if (typeof raw === "string") {
    return raw.split(/[,\s]+/).filter(Boolean);
  }
  return [];
}
