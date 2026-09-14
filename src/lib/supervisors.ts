import { db } from "@/lib/db";
import type { BaseRole } from "@prisma-client";

/**
 * Who may be somebody's Direct Supervisor.
 *
 * The Direct Supervisor is not a job title, it is the person who approves and
 * pays a tech's week. So the only sensible answer is "somebody who can actually
 * approve payroll" — and the two roles that can are Manager and Administrator.
 *
 * This existed as a bug before it was a rule. Anybody who was not a tech could
 * be picked, including a supervisor with no payroll reach and including system
 * accounts, and the week would then sit forever reading "Waiting on 417 System"
 * with no way for anyone to act on it. A week that nobody can approve is worse
 * than a week with no supervisor at all, because the screen claims somebody is
 * dealing with it.
 */
export const SUPERVISOR_ROLES: BaseRole[] = ["MANAGER", "ADMINISTRATOR"];

export function canSupervise(role: BaseRole): boolean {
  return SUPERVISOR_ROLES.includes(role);
}

/** Everyone who may be picked as a Direct Supervisor. */
export async function eligibleSupervisors(): Promise<
  { id: string; name: string; baseRole: BaseRole }[]
> {
  return db.user.findMany({
    where: { active: true, baseRole: { in: SUPERVISOR_ROLES } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, baseRole: true },
  });
}

/**
 * People whose Direct Supervisor no longer qualifies.
 *
 * Deliberately reported rather than repaired. Reassigning somebody's approver
 * silently is a change to who signs off their money, and guessing at that is
 * worse than naming the ones that need a decision.
 */
export async function supervisionsToFix(): Promise<
  {
    id: string;
    name: string;
    supervisor: { id: string; name: string; baseRole: BaseRole };
  }[]
> {
  const rows = await db.user.findMany({
    where: {
      active: true,
      directSupervisorId: { not: null },
      directSupervisor: { baseRole: { notIn: SUPERVISOR_ROLES } },
    },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      directSupervisor: { select: { id: true, name: true, baseRole: true } },
    },
  });

  return rows
    .filter((row) => row.directSupervisor !== null)
    .map((row) => ({
      id: row.id,
      name: row.name,
      supervisor: row.directSupervisor!,
    }));
}
