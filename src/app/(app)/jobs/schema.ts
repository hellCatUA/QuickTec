import { z } from "zod";
import { flag, optionalInt, optionalText } from "@/lib/form";

/**
 * The new-job form.
 *
 * Kept out of actions.ts because a "use server" module may only export async
 * functions — and because a schema is worth reading and testing on its own.
 * Every optional field goes through the shared helpers, which tolerate a key
 * the browser left out entirely: the Lead radio only exists once somebody is
 * assigned, and its absence used to fail the whole submission.
 */
export const jobFormSchema = z.object({
  title: z.string().trim().min(1, "Title is required"),
  clientId: z.string().min(1, "Pick a client"),
  siteId: z.string().min(1, "Pick a site"),
  projectId: optionalText,
  externalAssignmentId: optionalText,
  ticketNumber: optionalText,
  incNumber: optionalText,
  scheduledStart: optionalText,
  estimateMinutes: optionalInt({ min: 1, max: 60 * 24 * 30 }),
  techsRequired: optionalInt({ min: 1, max: 20 }),
  scopeOfWork: optionalText,
  breakPaid: flag,
  /// The representing company issued no work order for this job.
  noWorkOrder: flag,
  /// Blanks kept against the representing company to copy onto the job.
  templateIds: z.array(z.string()).default([]),
  assigneeIds: z.array(z.string()).default([]),
  leadId: optionalText,
});
