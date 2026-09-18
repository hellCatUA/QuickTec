import { z } from "zod";

/**
 * The unfinished new-job form.
 *
 * Two problems, one answer. The obvious one is that closing the tab lost
 * everything. The quieter one is that a refused submit did too: React resets a
 * `<form action={…}>` once its action has run, so every plain input on the page
 * came back empty while the React-held ones survived — Assignment ID, Ticket #,
 * INC # and the whole scope of work, gone because a required field further up
 * was blank. A draft that is reloaded rather than reset makes both go away.
 *
 * Stored as one JSON blob rather than a column per field. The form grows a
 * field most weeks, and a column each time is a migration each time for data
 * nobody queries, reports on, or keeps for longer than an afternoon.
 *
 * Which makes the schema below the important part of this file: a draft is
 * written by whatever the form looked like that day and read back by whatever
 * it looks like now. So every field is optional, unknown keys are dropped, and
 * a payload that cannot be understood at all reads as "no draft" instead of
 * throwing. Somebody's Tuesday is not worth a 500, and neither is it worth a
 * blank page.
 */

/** Everything the form holds. Add fields freely; never make one required. */
export const jobDraftSchema = z
  .object({
    projectId: z.string(),
    clientId: z.string(),
    repCompanyId: z.string(),
    siteId: z.string(),
    title: z.string(),
    titleTouched: z.boolean(),
    externalAssignmentId: z.string(),
    ticketNumber: z.string(),
    extraTickets: z.array(z.string()),
    incNumber: z.string(),
    scheduledStart: z.string(),
    estimateMinutes: z.number().nullable(),
    techsRequired: z.number(),
    assignees: z.array(z.string()),
    leadId: z.string(),
    scopeOfWork: z.string(),
    noWorkOrder: z.boolean(),
    pickedTemplates: z.array(z.string()).nullable(),
    deliverables: z.unknown().nullable(),
    breakPaidChoice: z.boolean().nullable(),
    payType: z.string(),
    payRate: z.string(),
  })
  .partial();

export type JobDraftPayload = z.infer<typeof jobDraftSchema>;

/**
 * A stored payload, as much of it as still makes sense.
 *
 * Never throws and never returns a half-parsed object: either the caller gets
 * fields it can trust or it gets nothing and shows an empty form.
 */
export function readJobDraft(payload: unknown): JobDraftPayload | null {
  const parsed = jobDraftSchema.safeParse(payload);
  if (!parsed.success) return null;
  return parsed.data;
}

/** Whether there is anything in here worth offering to restore. */
export function draftHasContent(draft: JobDraftPayload): boolean {
  return Object.entries(draft).some(([key, value]) => {
    // Not content on its own: the form sets these before anybody types.
    if (key === "techsRequired" || key === "titleTouched") return false;
    if (value === null || value === undefined) return false;
    if (typeof value === "string") return value.trim() !== "";
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === "boolean") return value;
    return true;
  });
}

/**
 * A line naming the draft, for the "you have an unfinished job" card.
 *
 * Built from whatever is filled in, in the order somebody would recognise it
 * by, because a draft with no title is exactly the draft they cannot place.
 */
export function describeJobDraft(
  draft: JobDraftPayload,
  lookup: {
    project?: (id: string) => string | null;
    site?: (id: string) => string | null;
    client?: (id: string) => string | null;
  } = {},
): string {
  const parts = [
    draft.title?.trim() || null,
    draft.siteId ? (lookup.site?.(draft.siteId) ?? null) : null,
    draft.projectId ? (lookup.project?.(draft.projectId) ?? null) : null,
    draft.clientId ? (lookup.client?.(draft.clientId) ?? null) : null,
  ].filter((one): one is string => Boolean(one));

  return parts.length > 0 ? parts.join(" · ") : "Nothing filled in yet";
}
