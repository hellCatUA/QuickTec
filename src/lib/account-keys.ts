import type { BaseRole } from "@prisma-client";
import { db } from "@/lib/db";
import { can, type SessionUser } from "@/lib/session";

/**
 * Whether somebody may hold the keys to an account with this role: create it
 * with a password they chose, be handed the link that sets one, or hand it to
 * whoever signs in to NextCloud with its email.
 *
 * Managing users is not managing roles. Without this an administrator — who
 * manages users but not the permission matrix — could make a manager's
 * account, sign in to it, and edit the matrix; or take a manager's own
 * account over through a reset link. The roles that can change what
 * everybody else may do are handed out only by somebody who already can.
 *
 * Read once for a whole page, so the Users screen can leave out the buttons
 * the server would refuse: it used to offer them, and answer a press with a
 * paragraph saying no.
 */
export async function keysCheckFor(
  actor: SessionUser,
): Promise<(target: { role: BaseRole | string; userId?: string }) => boolean> {
  if (can(actor, "roles.manage", { minScope: "ALL" })) return () => true;

  // Nor anybody else who can change the matrix — by what their role is
  // granted as it stands, or what they were granted themselves — rather than
  // by which roles happen to hold it today.
  const [grants, overrides] = await Promise.all([
    db.roleGrant.findMany({
      where: { permission: "roles.manage", scope: "ALL" },
      select: { role: true },
    }),
    db.permissionOverride.findMany({
      where: { permission: "roles.manage", granted: true, scope: "ALL", projectId: null },
      select: { userId: true },
    }),
  ]);
  const roles = new Set<string>(grants.map((grant) => grant.role));
  const people = new Set(overrides.map((override) => override.userId));

  return (target) => {
    if (target.role === "MANAGER" || target.role === "ADMINISTRATOR") return false;
    if (roles.has(target.role)) return false;
    return !(target.userId && people.has(target.userId));
  };
}

export async function mayHoldKeysTo(
  actor: SessionUser,
  target: { role: BaseRole; userId?: string },
): Promise<boolean> {
  return (await keysCheckFor(actor))(target);
}

export const KEYS_REFUSED =
  "Only somebody who manages roles can open a password way into an account that manages roles — a manager's, an administrator's, or anybody else's who can change the matrix.";
