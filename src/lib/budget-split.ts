import {
  type CrewMember,
  jobTerms,
  manualSurvives,
  rescaleManual,
  splitTerms,
  termsColumns,
} from "@/lib/budget";
import { db } from "@/lib/db";
import { toCents } from "@/lib/money";
import type { SplitMode } from "@prisma-client";
import { Prisma } from "@prisma-client";

/**
 * Rewriting the whole crew's pay, together, whenever either side moves.
 *
 * The budget and the lines are the same number seen from two ends, so they
 * cannot be written separately: a tech joining changes what everybody else is
 * on, and a tech leaving hands their share back. Doing that one row at a time
 * is exactly how a job ends up with a total nobody's lines add to.
 *
 * So this is the only writer. Every path that can change either side calls
 * it — assigning, unassigning, editing the budget, changing the split — and
 * none of them writes a pay column itself.
 *
 * Jobs with no budget are left entirely alone. Their lines were resolved
 * individually when each tech was assigned, and that is still how they are
 * meant to read; a job raised last spring does not acquire a split because we
 * shipped one.
 */
export async function resplitJob(
  jobId: string,
  client: Prisma.TransactionClient | typeof db = db,
): Promise<void> {
  const job = await client.job.findUnique({
    where: { id: jobId },
    select: {
      budgetType: true,
      budgetFlat: true,
      budgetFlatHours: true,
      budgetHourly: true,
      budgetSplit: true,
      assignments: {
        orderBy: [{ isLead: "desc" }, { createdAt: "asc" }],
        select: {
          id: true,
          isLead: true,
          shareBasisPoints: true,
          user: { select: { defaultPayRate: true } },
        },
      },
    },
  });

  const total = job ? jobTerms(job) : null;
  if (!job || !total) return;

  const crew: CrewMember[] = job.assignments.map((assignment) => ({
    id: assignment.id,
    isLead: assignment.isLead,
    // A share of zero is how somebody is non-billable on a job that pays, and
    // re-splitting must not quietly put them back on the payroll.
    excluded: assignment.shareBasisPoints === 0,
    defaultRateCents: assignment.user.defaultPayRate
      ? toCents(assignment.user.defaultPayRate)
      : 0,
    basisPoints: assignment.shareBasisPoints ?? undefined,
  }));

  // A hand-made split only survives a crew change while it still describes
  // the crew. When it does not, the job goes back to an even one; when it
  // does but somebody left, what is left is scaled back to the whole.
  const mode: SplitMode =
    job.budgetSplit === "MANUAL" && !manualSurvives(crew)
      ? "EVEN"
      : job.budgetSplit;
  const members = mode === "MANUAL" ? rescaleManual(crew) : crew;

  const { shares, lines } = splitTerms(total, members, mode);

  // Said on the job's own record, because a split somebody made by hand
  // turning back into an even one is a decision, not a detail.
  if (mode !== job.budgetSplit) {
    await client.job.update({
      where: { id: jobId },
      data: { budgetSplit: mode },
    });
  }

  await Promise.all(
    job.assignments.map((assignment, index) =>
      client.jobAssignment.update({
        where: { id: assignment.id },
        data: {
          ...termsColumns(lines[index]),
          shareBasisPoints: shares[index],
          // A budget overrules a personal exception, and has to: a line
          // standing outside the split is the drift it exists to prevent.
          payOverridden: false,
        },
      }),
    ),
  );
}
