import type { LucideIcon } from "lucide-react";
import {
  ArrowRightLeft,
  Ban,
  CalendarPlus,
  CircleCheck,
  CircleDollarSign,
  ClipboardList,
  FileText,
  FilePlus2,
  Flag,
  Link2,
  Lock,
  Pencil,
  Phone,
  Play,
  Repeat,
  Square,
  UserMinus,
  UserPlus,
  Users,
} from "lucide-react";

/**
 * The vocabulary of the timeline.
 *
 * Audit rows are written from a dozen places with whatever action name made
 * sense there, so this is the single place that decides how each one reads,
 * what it looks like, and whether a run of them collapses. Anything not listed
 * still renders — with its action name tidied up — rather than vanishing,
 * because a silent gap in a history is worse than an ugly line in one.
 */

export type TimelineTone = "neutral" | "primary" | "success" | "warning" | "danger";

export type TimelineMeta = {
  label: string;
  icon: LucideIcon;
  tone: TimelineTone;
  /**
   * Runs of this action collapse into one row when several land together.
   * Only for the ones that genuinely arrive in bulk — five jobs added to a
   * project should not push the rest of the history off the screen.
   */
  groups?: boolean;
};

export const TIMELINE_META: Record<string, TimelineMeta> = {
  // --- projects ------------------------------------------------------------
  project_created: { label: "Project created", icon: FilePlus2, tone: "primary" },
  project_updated: { label: "Project details updated", icon: Pencil, tone: "neutral" },
  project_pm_assigned: {
    label: "Project manager assigned",
    icon: UserPlus,
    tone: "primary",
  },
  project_pm_changed: {
    label: "Project manager changed",
    icon: ArrowRightLeft,
    tone: "warning",
  },
  project_pm_cleared: {
    label: "Project manager removed",
    icon: UserMinus,
    tone: "warning",
  },
  project_pm_contact_assigned: {
    label: "Rep company PM/PC set",
    icon: UserPlus,
    tone: "primary",
  },
  project_pm_contact_changed: {
    label: "Rep company PM/PC changed",
    icon: ArrowRightLeft,
    tone: "warning",
  },
  project_pm_contact_cleared: {
    label: "Rep company PM/PC removed",
    icon: UserMinus,
    tone: "warning",
  },
  project_job_settings_updated: {
    label: "Job settings updated",
    icon: ClipboardList,
    tone: "neutral",
  },
  project_member_added: { label: "Member added", icon: Users, tone: "neutral", groups: true },
  project_member_removed: { label: "Member removed", icon: UserMinus, tone: "neutral", groups: true },
  project_job_created: { label: "Job created in project", icon: CalendarPlus, tone: "primary", groups: true },
  project_job_linked: { label: "Existing job joined the project", icon: Link2, tone: "primary", groups: true },
  project_job_unlinked: { label: "Job removed from the project", icon: Link2, tone: "warning", groups: true },
  project_rules_updated: { label: "Deliverable rules updated", icon: ClipboardList, tone: "neutral" },
  project_closed: { label: "Project closed", icon: Lock, tone: "neutral" },
  project_reopened: { label: "Project reopened", icon: Repeat, tone: "warning" },

  // --- jobs ----------------------------------------------------------------
  created: { label: "Job created", icon: FilePlus2, tone: "primary" },
  revisit_created: { label: "Revisit created", icon: Repeat, tone: "warning" },
  revisit_scheduled: { label: "Revisit scheduled", icon: Repeat, tone: "warning" },
  approved: { label: "Job approved", icon: CircleCheck, tone: "success" },
  field_filled: { label: "Detail filled in", icon: Pencil, tone: "neutral", groups: true },
  field_edited: { label: "Detail changed", icon: Pencil, tone: "warning", groups: true },
  requirements_updated: { label: "Requirements updated", icon: ClipboardList, tone: "neutral" },
  tech_assigned: { label: "Tech assigned", icon: UserPlus, tone: "primary", groups: true },
  tech_unassigned: { label: "Tech taken off", icon: UserMinus, tone: "warning", groups: true },
  lead_changed: { label: "Lead changed", icon: Flag, tone: "warning" },
  dispatch_added: { label: "Dispatch number added", icon: Phone, tone: "neutral", groups: true },
  dispatch_removed: { label: "Dispatch number removed", icon: Ban, tone: "neutral", groups: true },
  pay_changed: { label: "Pay changed", icon: CircleDollarSign, tone: "warning" },
  clock_in: { label: "Clocked in", icon: Play, tone: "success" },
  clock_out: { label: "Clocked out", icon: Square, tone: "neutral" },
  break_start: { label: "Break started", icon: Square, tone: "neutral", groups: true },
  break_end: { label: "Break ended", icon: Play, tone: "neutral", groups: true },
  time_adjusted: { label: "Clock time adjusted", icon: ArrowRightLeft, tone: "warning" },
  checkout_completed: { label: "Checkout completed", icon: CircleCheck, tone: "success" },
  outcome_set: { label: "Outcome recorded", icon: Flag, tone: "neutral" },
  report_changed: { label: "Report edited", icon: FileText, tone: "warning", groups: true },
  document_attached: { label: "Document attached", icon: FilePlus2, tone: "primary" },
  document_removed: { label: "Document removed", icon: Ban, tone: "warning" },
  deliverable_added: { label: "Deliverable added", icon: FilePlus2, tone: "neutral", groups: true },
  deliverable_removed: { label: "Deliverable removed", icon: Ban, tone: "warning", groups: true },
  signature_captured: { label: "Signature captured", icon: Pencil, tone: "success" },
  change_requested: { label: "Change suggested", icon: Pencil, tone: "warning" },
  change_approved: { label: "Change approved", icon: CircleCheck, tone: "success" },
  change_rejected: { label: "Change rejected", icon: Ban, tone: "danger" },
  job_cancelled: { label: "Job cancelled", icon: Ban, tone: "danger" },
  job_billed: { label: "Paid by the representing company", icon: CircleDollarSign, tone: "success" },
  job_closed: { label: "Job closed", icon: Lock, tone: "neutral" },
  job_reopened: { label: "Job reopened", icon: Repeat, tone: "warning" },
};

/** Turns `some_action_name` into "Some action name" for anything unlisted. */
export function timelineMeta(action: string): TimelineMeta {
  return (
    TIMELINE_META[action] ?? {
      label: action.charAt(0).toUpperCase() + action.slice(1).replace(/_/g, " "),
      icon: FileText,
      tone: "neutral",
    }
  );
}

export type TimelineDetail = {
  field?: string;
  from?: string | null;
  to?: string | null;
  who?: string;
  reason?: string;
  [key: string]: unknown;
};

export type TimelineEvent = {
  id: string;
  action: string;
  createdAt: Date;
  actorName: string | null;
  detail: TimelineDetail | null;
};

/** One row of the rendered timeline: a single event, or a run of like ones. */
export type TimelineGroup = {
  key: string;
  action: string;
  /** Newest first, as displayed. */
  events: TimelineEvent[];
};

/**
 * Collapses adjacent events that share an action and an actor.
 *
 * Only actions marked `groups` collapse, and only when there are at least two:
 * a single "Tech assigned" reads worse as an expandable block than as a line.
 * Adjacency is deliberate — a run interrupted by something else is two runs,
 * because that something else is part of the story.
 */
export function groupTimeline(
  events: TimelineEvent[],
  { minimum = 2 }: { minimum?: number } = {},
): TimelineGroup[] {
  const groups: TimelineGroup[] = [];

  for (const event of events) {
    const previous = groups[groups.length - 1];
    const groupable = timelineMeta(event.action).groups === true;

    if (
      previous &&
      groupable &&
      previous.action === event.action &&
      previous.events[0].actorName === event.actorName
    ) {
      previous.events.push(event);
      continue;
    }

    groups.push({ key: event.id, action: event.action, events: [event] });
  }

  // A "run" of one is just an event. Split anything that never reached the
  // threshold back out so it renders as a plain row.
  return groups.flatMap((group) =>
    group.events.length >= minimum
      ? [group]
      : group.events.map((event) => ({
          key: event.id,
          action: event.action,
          events: [event],
        })),
  );
}

/** "Scope of work", "Dana Reyes" — what the event was about, when known. */
export function timelineSubject(detail: TimelineDetail | null): string | null {
  if (!detail) return null;
  return detail.who ?? detail.field ?? null;
}
