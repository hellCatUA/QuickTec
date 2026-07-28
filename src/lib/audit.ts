import { db } from "@/lib/db";
import type { Prisma } from "@prisma-client";

/**
 * Every state change that a supervisor might later have to explain goes here.
 * The job timeline and the per-site visit history are both projections of this
 * table, so writing an event is not optional bookkeeping — it is the record.
 */
export async function recordAudit(input: {
  actorId: string | null;
  entityType: string;
  entityId: string;
  action: string;
  jobId?: string | null;
  detail?: Prisma.InputJsonValue;
}) {
  await db.auditEvent.create({
    data: {
      actorId: input.actorId,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      jobId: input.jobId ?? null,
      detail: input.detail,
    },
  });
}

export type FieldDiff = Record<string, { from: string | null; to: string | null }>;

/**
 * Reduces a form update to just the fields that actually changed.
 * Values are stringified so the result is always safe to store as JSON —
 * Decimal and Date both come back from Prisma as objects otherwise.
 */
export function diffFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): FieldDiff {
  const changes: FieldDiff = {};

  for (const [key, next] of Object.entries(after)) {
    const previous = before[key];
    const from = previous == null ? null : String(previous);
    const to = next == null ? null : String(next);
    if (from !== to) changes[key] = { from, to };
  }

  return changes;
}
