import { db } from "@/lib/db";
import {
  effectiveRules,
  type FieldProgress,
  fieldProgress,
  missingDeliverables,
  type ProgressItem,
  RULE_SELECT,
} from "@/lib/deliverables";
import type { DeliverableCategory, JobLifecycle } from "@prisma-client";

/**
 * A job's own deliverable rules.
 *
 * A job follows its project's sheet live — change the project's sections and
 * every open job under it asks for the change — until somebody changes the
 * sections on that job. Then it gets rows of its own, a copy of the sheet with
 * the change made, and the project stops reaching it until somebody hands it
 * back with "Use the project's again". A job raised without a project follows
 * the ad-hoc defaults the same way.
 *
 * At checkout the job's sheet is written down whatever it was following, so a
 * job that is finished keeps asking for what it was checked out against: the
 * review, the banner and anything that recounts it later cannot be moved by a
 * project edit made a month afterwards.
 *
 * The care needed is the same at every write: rows win outright over what the
 * job would otherwise follow, so writing a single one would turn every other
 * section off. The whole sheet is written before the first edit lands.
 */

export type JobRuleInput = {
  category: DeliverableCategory;
  /** Names a custom section, and is what tells two of them apart. */
  customLabel: string | null;
  enabled: boolean;
  required: boolean;
  requiresPhoto: boolean;
  requiresText: boolean;
  minPhotos: number;
  perLocation: boolean;
  note: string | null;
};

/** The sheet a job is answering to right now, sections that are off included. */
export async function jobRuleSheet(jobId: string) {
  const job = await db.job.findUnique({
    where: { id: jobId },
    select: {
      deliverableRules: { where: { projectId: null }, select: RULE_SELECT },
      project: {
        select: {
          deliverableRules: { where: { jobId: null }, select: RULE_SELECT },
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
      minPhotos: rule.minPhotos,
      perLocation: rule.perLocation,
      note: rule.note,
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
    minPhotos: rule.minPhotos,
    perLocation: rule.perLocation,
    note: rule.note,
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

/**
 * Gives a project rows for every section before one of them is changed.
 *
 * The same trap a job has: a project with no rows answers with the defaults,
 * and rows win outright once there are any — so saving one section alone
 * would turn every other one off for every job under it.
 */
export async function materialiseProjectRules(projectId: string): Promise<void> {
  const stored = await db.deliverableRequirement.findMany({
    where: { projectId, jobId: null },
    select: RULE_SELECT,
  });
  if (stored.length > 0) return;

  await db.deliverableRequirement.createMany({
    data: effectiveRules([], []).map((rule) => ({
      projectId,
      category: rule.category,
      customLabel: rule.customLabel,
      enabled: rule.enabled,
      required: rule.required,
      requiresPhoto: rule.requiresPhoto,
      requiresText: rule.requiresText,
      minPhotos: rule.minPhotos,
      perLocation: rule.perLocation,
      note: rule.note,
      order: rule.order,
    })),
    skipDuplicates: true,
  });
}

/**
 * The stages in which a job still follows its project. From checkout on, what
 * it asks for is what it was checked out against.
 */
export const FOLLOWING_LIFECYCLES: readonly JobLifecycle[] = [
  "DRAFT",
  "PENDING_APPROVAL",
  "SCHEDULED",
  "IN_PROGRESS",
];

/** Writes down what a job is answering to now, as it is checked out. */
export async function freezeJobRules(jobId: string): Promise<void> {
  await materialiseJobRules(jobId);
}

/**
 * Hands a changed job back to its project: its own rows go, and it follows
 * the project's sheet again from now on. Refused once the job is past
 * checkout, and for a job with no project to follow.
 */
export async function followProjectRules(
  jobId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const job = await db.job.findUnique({
    where: { id: jobId },
    select: { projectId: true, lifecycle: true },
  });
  if (!job) return { ok: false, error: "Job not found." };
  if (!job.projectId) {
    return { ok: false, error: "This job has no project to follow." };
  }
  if (!FOLLOWING_LIFECYCLES.includes(job.lifecycle)) {
    return {
      ok: false,
      error:
        "This job has been checked out; it keeps what it was checked out against.",
    };
  }
  await db.deliverableRequirement.deleteMany({ where: { jobId } });
  return { ok: true };
}

/** What an upload is counted with. */
export const PROGRESS_ITEM_SELECT = {
  category: true,
  customLabel: true,
  locationId: true,
  textValue: true,
  _count: { select: { attachments: true } },
} as const;

export function toProgressItem(item: {
  category: DeliverableCategory;
  customLabel: string | null;
  locationId: string | null;
  textValue: string | null;
  _count: { attachments: number };
}): ProgressItem {
  return {
    category: item.category,
    customLabel: item.customLabel,
    locationId: item.locationId,
    textValue: item.textValue,
    fileCount: item._count.attachments,
  };
}

/** Each section that is on, with how far it has got. Null for no such job. */
export async function jobDeliverableProgress(
  jobId: string,
): Promise<FieldProgress[] | null> {
  const job = await db.job.findUnique({
    where: { id: jobId },
    select: {
      deliverableRules: { where: { projectId: null }, select: RULE_SELECT },
      project: {
        select: {
          deliverableRules: { where: { jobId: null }, select: RULE_SELECT },
        },
      },
      deliverables: { select: PROGRESS_ITEM_SELECT },
      locations: {
        orderBy: [{ order: "asc" }, { createdAt: "asc" }],
        select: { id: true, name: true },
      },
    },
  });
  if (!job) return null;

  const rules = effectiveRules(
    job.deliverableRules,
    job.project?.deliverableRules ?? [],
  ).filter((rule) => rule.enabled);

  return fieldProgress(
    rules,
    job.deliverables.map(toProgressItem),
    job.locations,
  );
}

/**
 * What checkout is still waiting on, said the way the job page says it —
 * "Pre-Install at Install point (1 of 2)" rather than just a section name.
 */
export async function missingRequiredDeliverables(
  jobId: string,
): Promise<string[]> {
  const progress = await jobDeliverableProgress(jobId);
  return progress ? missingDeliverables(progress) : [];
}
