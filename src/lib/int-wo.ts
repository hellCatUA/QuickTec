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
 *
 * A project's number is read in the same statement as its counter: the ID it
 * carries is whatever the project says at the moment the number is taken, not
 * what it said a moment earlier when the form was read.
 */
async function nextSequence(
  tx: Prisma.TransactionClient,
  projectId: string | null,
  year: number,
): Promise<{ sequence: number; code: string | null }> {
  if (projectId) {
    const project = await tx.project.update({
      where: { id: projectId },
      data: { intWoCounter: { increment: 1 } },
      select: { intWoCounter: true, code: true },
    });
    return { sequence: project.intWoCounter, code: project.code };
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

  return { sequence: rows[0].value, code: null };
}

/**
 * Moves a counter past every number already issued under one prefix.
 *
 * Project IDs are unique now, but jobs numbered before they were carried the
 * paying company's ID or 0000, each project counting from 1 — so a run of
 * them can sit exactly where fresh numbers land. Stepping over them one at a
 * time is a long walk for a busy old project; this jumps the counter to the
 * last one taken in a single move.
 */
async function skipTaken(
  tx: Prisma.TransactionClient,
  projectId: string | null,
  year: number,
  prefix: string,
): Promise<void> {
  const taken = await tx.job.findMany({
    where: { intWoId: { startsWith: prefix } },
    select: { intWoId: true },
  });
  const highest = Math.max(
    0,
    ...taken.map((job) => {
      const match = /^(\d+)(?:-R\d+)?$/.exec(job.intWoId.slice(prefix.length));
      return match ? Number(match[1]) : 0;
    }),
  );
  if (projectId) {
    await tx.$executeRaw`
      UPDATE "Project" SET "intWoCounter" = GREATEST("intWoCounter", ${highest})
      WHERE "id" = ${projectId}
    `;
  } else {
    await tx.$executeRaw`
      UPDATE "IntWoCounter" SET "value" = GREATEST("value", ${highest})
      WHERE "scope" = ${`global:${year}`}
    `;
  }
}

export type AllocateIntWoInput = {
  /** Null for jobs with no project. */
  projectId: string | null;
  /**
   * Our project ID as the caller last saw it. The number uses the one read
   * with the counter, so this only matters for a job with no project (null,
   * which renders as 0000).
   */
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

  // A number taken already is skipped rather than issued twice — see
  // skipTaken. Twice round is enough: the second number is past everything
  // under the prefix, and the third try is only for the impossible.
  for (let attempt = 0; attempt < 3; attempt++) {
    const { sequence, code } = await nextSequence(tx, input.projectId, year);
    const intWoId = formatIntWo({
      year,
      month,
      projectRef: code ?? input.projectCode ?? NO_PROJECT_REF,
      sequence,
    });
    const taken = await tx.job.findUnique({
      where: { intWoId },
      select: { id: true },
    });
    if (!taken) return { sequence, intWoId };
    // "2607-PRJ12-" — everything up to the sequence.
    await skipTaken(
      tx,
      input.projectId,
      year,
      intWoId.slice(0, intWoId.lastIndexOf("-") + 1),
    );
  }
  throw new Error("No free INT WO number");
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
      project: { select: { code: true, externalProjectId: true } },
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

  const { year, month } = zonedParts(input.effectiveDate, input.timeZone);

  // What the original's number says, so R1 reads as the same job even when
  // the project's ID is not the one it was numbered under — but only a
  // reference this project could have issued. A number in some older shape
  // (2026-05-0000-123) reads as nonsense, and the project's own ID is better.
  const fromNumber = projectRefOf(parent.intWoId);
  const projectRef =
    fromNumber !== null &&
    [
      NO_PROJECT_REF,
      parent.project?.code,
      parent.project?.externalProjectId?.trim().toUpperCase(),
      parent.project?.externalProjectId?.trim(),
    ].includes(fromNumber)
      ? fromNumber
      : (parent.project?.code ?? NO_PROJECT_REF);

  // Two originals can share a sequence — the old 0000 jobs of two projects —
  // and revisiting both in one month would otherwise make one number twice.
  for (
    let revisitNumber = (siblings._max.revisitNumber ?? 0) + 1;
    ;
    revisitNumber++
  ) {
    const intWoId = formatIntWo({
      year,
      month,
      projectRef,
      sequence: parent.intWoSequence,
      revisitNumber,
    });
    const taken = await tx.job.findUnique({
      where: { intWoId },
      select: { id: true },
    });
    if (!taken) {
      return { revisitNumber, sequence: parent.intWoSequence, intWoId };
    }
  }
}
