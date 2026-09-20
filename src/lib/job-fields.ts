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
 * a fact, not a gap, and it reads as "Not provided" in the ordinary text colour
 * rather than in the warning colour — flagging every job without an INC number
 * trains people to ignore the warning that means something.
 */
export const JOB_FIELDS = {
  title: { label: "Job title", kind: "text", planned: true },
  /**
   * Which site, and with it which customer.
   *
   * One field rather than two, because the job has never had a say: a site
   * belongs to a customer and `createJob` copies `site.customerId` straight
   * onto the job. Offering them separately would let the pair be approved one
   * at a time — a site change approved and the customer change rejected leaves
   * a job filed under a company whose site it is not.
   *
   * The INT WO ID does not move with it. It was issued when the job was raised
   * and is on paperwork that has already gone out.
   */
  siteId: {
    label: "Site",
    kind: "site",
    planned: true,
    hint: "The customer comes with the site.",
  },
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
    // Stored in minutes, read in hours — the field shows "4.00 hrs" beside it,
    // so saying "(minutes)" in the label only ever contradicted what was under
    // it.
    label: "Estimated time",
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
  {
    label: string;
    kind: string;
    planned: boolean;
    hint?: string;
    optional?: boolean;
  }
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

/**
 * What "Edit job details" covers.
 *
 * Only what was decided when the job was raised. Everything collected during
 * the job — the contacts, the dispatch numbers, the extra tickets, the release
 * code, the paperwork — stays on the job page, where it is read and added to.
 */
export const DETAIL_FIELDS = [
  "siteId",
  "externalAssignmentId",
  "ticketNumber",
  "incNumber",
] as const satisfies readonly JobFieldName[];

export type DetailField = (typeof DETAIL_FIELDS)[number];

/**
 * Whether a job's details are still ordinary to correct.
 *
 * A signed-off job is a record. Past this point it takes somebody who can
 * overrule a planner, and there is nothing left to approve a suggestion
 * against — the approval already happened.
 */
export function detailsEditable(lifecycle: string): boolean {
  return (
    lifecycle !== "APPROVED" &&
    lifecycle !== "REJECTED" &&
    lifecycle !== "BILLED"
  );
}
