/**
 * The job fields a person can change from the job page, and how each one is
 * entered. Anything not listed here cannot be written through saveJobField —
 * the action refuses unknown names rather than trusting the form.
 *
 * `planned` marks the fields that arrive with the schedule and are therefore
 * read-only by default: filling a blank one is open to anyone on the job, but
 * changing one that already holds a value needs job.edit_planned_fields, or it
 * becomes a change request.
 *
 * `optional` marks the ones a job may legitimately never have. An empty one is
 * a fact, not a gap, and it reads as "Not provided" rather than a warning —
 * flagging every job without an INC number trains people to ignore the warning
 * that means something.
 */
export const JOB_FIELDS = {
  title: { label: "Job title", kind: "text", planned: true },
  externalAssignmentId: {
    label: "Assignment ID",
    kind: "text",
    planned: true,
    hint: "The client's ID for this work order. Shared by everyone on site.",
  },
  ticketNumber: { label: "Ticket #", kind: "text", planned: true },
  incNumber: {
    label: "INC #",
    kind: "text",
    planned: true,
    // Plenty of work has no incident behind it at all.
    optional: true,
  },
  scheduledStart: {
    label: "Scheduled start",
    kind: "datetime",
    planned: true,
  },
  estimateMinutes: {
    label: "Estimated time (minutes)",
    kind: "number",
    planned: true,
  },
  techsRequired: { label: "Techs required", kind: "number", planned: true },
  scopeOfWork: { label: "Scope of work", kind: "markdown", planned: true },
  releaseCode: {
    label: "Release code",
    kind: "text",
    planned: false,
    hint: "Captured on site at checkout.",
  },
  returnTrackingNumber: {
    label: "Return tracking #",
    kind: "text",
    planned: false,
    // Only jobs that send something back have one.
    optional: true,
  },
} as const satisfies Record<
  string,
  { label: string; kind: string; planned: boolean; hint?: string; optional?: boolean }
>;

export type JobFieldName = keyof typeof JOB_FIELDS;

export const JOB_FIELD_NAMES = Object.keys(JOB_FIELDS) as JobFieldName[];

export function isJobField(name: string): name is JobFieldName {
  return (JOB_FIELD_NAMES as string[]).includes(name);
}

/** Whether an empty value on this field is a fact rather than a gap. */
export function isOptionalField(name: JobFieldName): boolean {
  return "optional" in JOB_FIELDS[name] && JOB_FIELDS[name].optional === true;
}

/**
 * What a person may do to one field right now.
 *
 *   "edit"    write it directly
 *   "fill"    the field is empty, and anyone on the job may complete it
 *   "suggest" it holds a value they cannot overwrite; raise a change request
 *   "none"    read-only
 */
export type FieldAction = "edit" | "fill" | "suggest" | "none";

export function fieldAction(input: {
  planned: boolean;
  isEmpty: boolean;
  canEditPlanned: boolean;
  canFillMissing: boolean;
  canSuggest: boolean;
}): FieldAction {
  if (input.canEditPlanned) return "edit";
  if (!input.planned) return input.canFillMissing ? "edit" : "none";
  if (input.isEmpty) return input.canFillMissing ? "fill" : "none";
  return input.canSuggest ? "suggest" : "none";
}
