import { z } from "zod";
import { flag, optionalInt, optionalMoney, optionalText } from "@/lib/form";
import { DeliverableCategory } from "@prisma-client";

/**
 * The deliverable sections chosen while raising the job.
 *
 * Sent as JSON in one field rather than as ten parallel arrays: the checklist
 * is the same component the project and job pages use, and a row of it has five
 * settings — repeated form fields would have to be zipped back together by
 * position, which is exactly the kind of thing that silently misaligns.
 */
export const deliverableRuleSchema = z.object({
  category: z.enum(DeliverableCategory),
  customLabel: optionalText,
  enabled: z.boolean(),
  required: z.boolean(),
  requiresPhoto: z.boolean(),
  requiresText: z.boolean(),
});

const deliverableRules = z
  .string()
  .optional()
  .transform((value, ctx) => {
    if (!value) return null;
    try {
      return z.array(deliverableRuleSchema).parse(JSON.parse(value));
    } catch {
      ctx.addIssue({
        code: "custom",
        message: "The deliverable sections could not be read.",
      });
      return z.NEVER;
    }
  });

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
  /// Ticket numbers after the primary, in the order they were typed.
  extraTickets: z.array(z.string()).default([]),
  incNumber: optionalText,
  scheduledStart: optionalText,
  estimateMinutes: optionalInt({ min: 1, max: 60 * 24 * 30 }),
  techsRequired: optionalInt({ min: 1, max: 20 }),
  scopeOfWork: optionalText,
  breakPaid: flag,
  /// Pay for this job specifically. Blank leaves the usual resolution alone —
  /// each tech's own rate, then the project's default. A value here overrides
  /// both, for everybody on the job.
  payType: optionalText,
  payRate: optionalMoney,
  travelReimbursement: optionalMoney,
  /// Numbers to reach mid-job, for this job alone. Parallel arrays, because
  /// they arrive as ordinary repeated form fields.
  dispatchLabel: z.array(z.string()).default([]),
  dispatchName: z.array(z.string()).default([]),
  dispatchPhone: z.array(z.string()).default([]),
  dispatchEmail: z.array(z.string()).default([]),
  dispatchNote: z.array(z.string()).default([]),
  /// The representing company issued no work order for this job.
  noWorkOrder: flag,
  /// Blanks kept against the representing company to copy onto the job.
  templateIds: z.array(z.string()).default([]),
  /// Null when the planner left the checklist alone, which means "whatever the
  /// project asks for" rather than "nothing".
  deliverableRules,
  assigneeIds: z.array(z.string()).default([]),
  leadId: optionalText,
});
