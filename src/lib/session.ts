import { cache } from "react";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import {
  type Permission,
  scopeAtLeast,
  widestScope,
} from "@/lib/permissions";
import type { BaseRole, PermissionScope } from "@prisma-client";

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  baseRole: BaseRole;
  timeZone: string;
  directSupervisorId: string | null;
  /** permission -> scope, already merged from role grants and overrides. */
  grants: Map<Permission, PermissionScope>;
  /** permission -> projectId -> scope, for project-narrowed overrides. */
  projectGrants: Map<Permission, Map<string, PermissionScope>>;
  /** Projects where the user is PM or supervisor — the reach of PROJECT scope. */
  scopedProjectIds: string[];
};

/**
 * Loads the signed-in user with their effective permissions.
 *
 * Deliberately hits Postgres on every request instead of trusting the JWT:
 * a role change in NextCloud, a new override, or a deactivation must take
 * effect on the tech's next tap, not whenever the token happens to expire.
 * React's cache() keeps it to one query per request.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;

  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      avatarUrl: true,
      baseRole: true,
      active: true,
      timeZone: true,
      directSupervisorId: true,
      permissionOverrides: {
        select: {
          permission: true,
          granted: true,
          scope: true,
          projectId: true,
        },
      },
      projectMemberships: {
        where: { role: { in: ["PROJECT_MANAGER", "SUPERVISOR"] } },
        select: { projectId: true },
      },
      managedProjects: { select: { id: true } },
    },
  });

  if (!user || !user.active) return null;

  const roleGrants = await db.roleGrant.findMany({
    where: { role: user.baseRole },
    select: { permission: true, scope: true },
  });

  const grants = new Map<Permission, PermissionScope>();
  for (const grant of roleGrants) {
    grants.set(grant.permission as Permission, grant.scope);
  }

  const projectGrants = new Map<Permission, Map<string, PermissionScope>>();

  for (const override of user.permissionOverrides) {
    const permission = override.permission as Permission;

    if (override.projectId) {
      // Narrowed overrides never touch the global grant; they are consulted
      // only when the caller supplies a matching projectId.
      if (!override.granted) continue;
      const perProject =
        projectGrants.get(permission) ?? new Map<string, PermissionScope>();
      perProject.set(override.projectId, override.scope ?? "PROJECT");
      projectGrants.set(permission, perProject);
      continue;
    }

    if (!override.granted) {
      // An explicit revoke beats the role grant outright.
      grants.delete(permission);
      continue;
    }

    const current = grants.get(permission);
    const next = override.scope ?? "OWN";
    grants.set(permission, current ? widestScope(current, next) : next);
  }

  const scopedProjectIds = Array.from(
    new Set([
      ...user.projectMemberships.map((m) => m.projectId),
      ...user.managedProjects.map((p) => p.id),
    ]),
  );

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    baseRole: user.baseRole,
    timeZone: user.timeZone,
    directSupervisorId: user.directSupervisorId,
    grants,
    projectGrants,
    scopedProjectIds,
  };
});

/**
 * Effective scope for a permission, or null when the user does not have it.
 * Pass projectId to let a project-narrowed override apply.
 */
export function permissionScope(
  user: SessionUser,
  permission: Permission,
  projectId?: string | null,
): PermissionScope | null {
  const global = user.grants.get(permission) ?? null;

  if (!projectId) return global;

  const scoped = user.projectGrants.get(permission)?.get(projectId);
  if (!scoped) return global;

  return global ? widestScope(global, scoped) : scoped;
}

export function can(
  user: SessionUser | null,
  permission: Permission,
  options?: { minScope?: PermissionScope; projectId?: string | null },
): boolean {
  if (!user) return false;
  const scope = permissionScope(user, permission, options?.projectId);
  if (!scope) return false;
  if (!options?.minScope) return true;
  return scopeAtLeast(scope, options.minScope);
}

export class PermissionError extends Error {
  constructor(public permission: Permission) {
    super(`Missing permission: ${permission}`);
    this.name = "PermissionError";
  }
}

/** Throws unless the current user holds the permission. */
export async function requirePermission(
  permission: Permission,
  options?: { minScope?: PermissionScope; projectId?: string | null },
): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!can(user, permission, options)) {
    throw new PermissionError(permission);
  }
  return user as SessionUser;
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new Error("Not authenticated");
  return user;
}

/**
 * Which users' records a given scope lets this user reach.
 * `null` means "no restriction" — callers must treat it as unfiltered.
 */
export async function reachableUserIds(
  user: SessionUser,
  scope: PermissionScope,
): Promise<string[] | null> {
  if (scope === "ALL") return null;
  if (scope === "OWN") return [user.id];

  const reports = await db.user.findMany({
    where: { directSupervisorId: user.id },
    select: { id: true },
  });
  const ids = new Set([user.id, ...reports.map((r) => r.id)]);

  if (scope === "PROJECT" && user.scopedProjectIds.length > 0) {
    const members = await db.projectMember.findMany({
      where: { projectId: { in: user.scopedProjectIds } },
      select: { userId: true },
    });
    for (const member of members) ids.add(member.userId);
  }

  return Array.from(ids);
}
