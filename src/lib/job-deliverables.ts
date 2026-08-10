import { db } from "@/lib/db";
import { effectiveRules } from "@/lib/deliverables";
import type { DeliverableCategory } from "@prisma-client";

/**
 * A job's own deliverable rules.
 *
 * A job created under a project is given a copy of the project's sheet at
 * creation, so later edits to the project cannot change what work already
 * scheduled demands. A job raised without a project has no rows at all and
 * falls back to the ad-hoc defaults — which is where the care is needed: job
 * rows win outright over the fallback, so writing a single one would turn every
 * other section off. The whole sheet is written before the first edit lands.
 */

const RULE_FIELDS = {
  category: true,
  customLabel: true,
  enabled: true,
  required: true,
  requiresPhoto: true,
  requiresText: true,
  order: true,
} as const;

export type JobRuleInput = {
  category: DeliverableCategory;
  /** Names a custom section, and is what tells two of them apart. */
  customLabel: string | null;
  enabled: boolean;
  required: boolean;
  requiresPhoto: boolean;
  requiresText: boolean;
};

/** The sheet a job is answering to right now, sections that are off included. */
export async function jobRuleSheet(jobId: string) {
  const job = await db.job.findUnique({
    where: { id: jobId },
    select: {
      deliverableRules: { where: { projectId: null }, select: RULE_FIELDS },
      project: {
        select: {
          deliverableRules: { where: { jobId: null }, select: RULE_FIELDS },
        },
      },
    },
  });
  if (!job) return null;

  return effectiveRules(
    job.deliverableRules,
    job.project?.deliverableRules ?? [],
  );
}

/**
 * Gives the job its own copy of whatever it is currently answering to.
 *
 * Idempotent: a job that already owns rows is left alone, and the unique index
 * on (jobId, category) makes two planners toggling at once harmless rather than
 * a job with the same section listed twice.
 */
export async function materialiseJobRules(jobId: string): Promise<void> {
  const sheet = await jobRuleSheet(jobId);
  if (!sheet) return;

  await db.deliverableRequirement.createMany({
    data: sheet.map((rule) => ({
      jobId,
      category: rule.category,
      customLabel: rule.customLabel,
      enabled: rule.enabled,
      required: rule.required,
      requiresPhoto: rule.requiresPhoto,
      requiresText: rule.requiresText,
      order: rule.order,
    })),
    skipDuplicates: true,
  });
}

/**
 * Writes one section's settings, after the sheet is safely in place.
 *
 * Matched on the label as well as the category, because a job may hold several
 * custom sections and the category alone no longer names one of them. Not an
 * upsert on a compound key: the uniqueness is partial — the nine fixed
 * categories are one to an owner, custom sections are one per name — and
 * Prisma cannot express that, so it lives in the migration and the lookup is
 * done here.
 */
export async function saveJobRule(
  jobId: string,
  rule: JobRuleInput,
): Promise<void> {
  await materialiseJobRules(jobId);

  const where = {
    jobId,
    category: rule.category,
    ...(rule.category === "CUSTOM" ? { customLabel: rule.customLabel } : {}),
  };

  const existing = await db.deliverableRequirement.findFirst({
    where,
    select: { id: true },
  });

  const data = {
    customLabel: rule.customLabel,
    enabled: rule.enabled,
    required: rule.required,
    requiresPhoto: rule.requiresPhoto,
    requiresText: rule.requiresText,
  };

  if (existing) {
    await db.deliverableRequirement.update({ where: { id: existing.id }, data });
    return;
  }

  // A custom section being made for the first time. The fixed nine are always
  // there by now, because materialising the sheet wrote them.
  await db.deliverableRequirement.create({
    data: {
      jobId,
      category: rule.category,
      order: 9,
      ...data,
    },
  });
}

/**
 * Takes a custom section away.
 *
 * Only ever a custom one: the fixed nine are switched off rather than deleted,
 * so that "off" stays a decision somebody made rather than a row that happens
 * to be missing.
 */
export async function removeJobCustomRule(
  jobId: string,
  customLabel: string,
): Promise<void> {
  await db.deliverableRequirement.deleteMany({
    where: { jobId, category: "CUSTOM", customLabel },
  });
}
