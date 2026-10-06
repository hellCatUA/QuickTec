import { formatIntWo, NO_PROJECT_REF, projectRefOf } from "@/lib/int-wo-format";
import { zonedParts } from "@/lib/datetime";
import type { Prisma } from "@prisma-client";

/**
 * Internal work order numbering.
 *
 * The shape of the number lives in int-wo-format.ts, so the new-job form can
 * show it before it exists without dragging the database into the browser.
 * This file is the allocation: which counter it comes from and when.
 *
 * - Jobs with no project draw from a global counter that resets each January.
 * - Jobs in a project draw from that project's counter, which never resets.
 * - A revisit keeps its parent's sequence and project, and takes the month it
 *   actually happens in.
 */

export { formatIntWo, NO_PROJECT_REF, projectRefOf };
export type { IntWoParts } from "@/lib/int-wo-format";

/**
 * A revisit reusing the original external Assignment ID is marked with an R-
 * prefix so the two are told apart at a glance. A revisit issued a genuinely
 * new ID by the client keeps that ID untouched.
 */
export function revisitAssignmentId(original: string | null): string | null {
  if (!original) return null;
  return original.startsWith("R-") ? original : `R-${original}`;
}

/**
 * Consumes a sequence number. Both branches are single atomic statements, so
 * two people creating jobs at the same moment cannot collide.
 */
async function nextSequence(
  tx: Prisma.TransactionClient,
  projectId: string | null,
  year: number,
): Promise<number> {
  if (projectId) {
    const project = await tx.project.update({
      where: { id: projectId },
      data: { intWoCounter: { increment: 1 } },
      select: { intWoCounter: true },
    });
    return project.intWoCounter;
  }

  // Prisma's upsert would read then write; INSERT … ON CONFLICT does it in one
  // statement, which is what makes this safe under concurrency.
  const rows = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO "IntWoCounter" ("scope", "value")
    VALUES (${`global:${year}`}, 1)
    ON CONFLICT ("scope")
    DO UPDATE SET "value" = "IntWoCounter"."value" + 1
    RETURNING "value"
  `;

  return rows[0].value;
}

export type AllocateIntWoInput = {
  /** Null for jobs with no project. */
  projectId: string | null;
  /** Our project ID (Project.code); null — no project — renders as 0000. */
  projectCode: string | null;
  /** Scheduled date if known, otherwise now. Decides the YYYY-MM. */
  effectiveDate: Date;
  timeZone: string;
};

/** Allocates a fresh number for a brand new job. */
export async function allocateIntWo(
  tx: Prisma.TransactionClient,
  input: AllocateIntWoInput,
): Promise<{ intWoId: string; sequence: number }> {
  const { year, month } = zonedParts(input.effectiveDate, input.timeZone);

  // A number taken already is skipped rather than issued twice. Project IDs
  // are unique now, but jobs numbered before they were carried the paying
  // company's ID or 0000, and one of those can still sit where a fresh number
  // lands — a job with no project in a month an old project job used.
  for (let attempt = 0; attempt < 50; attempt++) {
    const sequence = await nextSequence(tx, input.projectId, year);
    const intWoId = formatIntWo({
      year,
      month,
      projectRef: input.projectCode || NO_PROJECT_REF,
      sequence,
    });
    const taken = await tx.job.findUnique({
      where: { intWoId },
      select: { id: true },
    });
    if (!taken) return { sequence, intWoId };
  }
  throw new Error("No free INT WO number after 50 tries");
}

/**
 * Allocates the number for a revisit of an existing job. Consumes no counter —
 * the sequence is inherited — but does claim the next revisit index.
 */
export async function allocateRevisitIntWo(
  tx: Prisma.TransactionClient,
  input: {
    parentJobId: string;
    effectiveDate: Date;
    timeZone: string;
  },
): Promise<{ intWoId: string; sequence: number; revisitNumber: number }> {
  const parent = await tx.job.findUnique({
    where: { id: input.parentJobId },
    select: {
      intWoId: true,
      intWoSequence: true,
      revisitNumber: true,
      parentJobId: true,
      project: { select: { code: true } },
    },
  });

  if (!parent) throw new Error("Parent job not found");

  // Revisiting a revisit still chains off the original, so R3 follows R2
  // rather than restarting.
  const rootId = parent.parentJobId ?? input.parentJobId;

  const siblings = await tx.job.aggregate({
    where: { parentJobId: rootId },
    _max: { revisitNumber: true },
  });

  const revisitNumber = (siblings._max.revisitNumber ?? 0) + 1;
  const { year, month } = zonedParts(input.effectiveDate, input.timeZone);

  return {
    revisitNumber,
    sequence: parent.intWoSequence,
    intWoId: formatIntWo({
      year,
      month,
      // What the original's number says, so R1 reads as the same job even
      // when the project's ID is not the one it was numbered under.
      projectRef:
        projectRefOf(parent.intWoId) ?? parent.project?.code ?? NO_PROJECT_REF,
      sequence: parent.intWoSequence,
      revisitNumber,
    }),
  };
}
