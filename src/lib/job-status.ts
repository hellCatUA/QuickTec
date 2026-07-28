import type {
  JobInternalStatus,
  JobLifecycle,
  JobOutcome,
} from "@prisma-client";

type Variant = "neutral" | "primary" | "success" | "warning" | "danger";

/** Where the job is in our workflow. Internal. */
export const LIFECYCLE_META: Record<
  JobLifecycle,
  { label: string; variant: Variant }
> = {
  DRAFT: { label: "Draft", variant: "neutral" },
  PENDING_APPROVAL: { label: "Pending approval", variant: "warning" },
  SCHEDULED: { label: "Scheduled", variant: "primary" },
  IN_PROGRESS: { label: "In progress", variant: "success" },
  PENDING_REVIEW: { label: "Pending review", variant: "warning" },
  APPROVED: { label: "Approved", variant: "success" },
};

/** What the tech reported at checkout. Appears on client-facing exports. */
export const OUTCOME_META: Record<
  JobOutcome,
  { label: string; variant: Variant }
> = {
  COMPLETED: { label: "Completed", variant: "success" },
  INCOMPLETE: { label: "Incomplete", variant: "warning" },
  FAIL: { label: "Fail", variant: "danger" },
  CANCEL: { label: "Cancel", variant: "neutral" },
};

/**
 * Set afterwards by a supervisor or manager. Never leaves the company — the
 * text report and ZIP export must not carry these.
 */
export const INTERNAL_STATUS_META: Record<
  JobInternalStatus,
  { label: string; variant: Variant }
> = {
  REVISIT_REQUIRED: { label: "Revisit required", variant: "warning" },
  RESCHEDULED: { label: "Rescheduled", variant: "primary" },
  RESCHEDULE_CANCELLED: { label: "Reschedule cancelled", variant: "neutral" },
};

/** Jobs still needing someone to do something, newest work first. */
export const OPEN_LIFECYCLES: JobLifecycle[] = [
  "PENDING_APPROVAL",
  "SCHEDULED",
  "IN_PROGRESS",
  "PENDING_REVIEW",
];
