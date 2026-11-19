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
    supervisor: { id: string; name: string; baseRole: BaseRole; active: boolean };
  }[]
> {
  // A supervisor deactivated is one who can no longer approve anything too.
  // Checked by role alone, their people were never listed here, and every
  // save of their row was refused for naming somebody deactivated.
  const rows = await db.user.findMany({
    where: {
      active: true,
      directSupervisorId: { not: null },
      directSupervisor: {
        OR: [{ baseRole: { notIn: SUPERVISOR_ROLES } }, { active: false }],
      },
    },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      directSupervisor: { select: { id: true, name: true, baseRole: true, active: true } },
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
