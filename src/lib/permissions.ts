import { BaseRole, PermissionScope } from "@prisma-client";

/**
 * Permission catalogue.
 *
 * A permission is never a plain boolean — it always carries a scope saying how
 * far it reaches. Scopes are cumulative supersets:
 *
 *   OWN  ⊂  REPORTS  ⊂  PROJECT  ⊂  ALL
 *
 *   OWN      rows the user owns (their assignments, their mileage, their pay)
 *   REPORTS  OWN + every tech whose directSupervisor is this user
 *   PROJECT  REPORTS + everything inside projects where the user is PM or
 *            supervisor. A supervisor who can act on their project can also
 *            act on their own reports, hence the nesting.
 *   ALL      no restriction
 *
 * Managers edit this matrix at /settings/roles; per-user exceptions live in
 * PermissionOverride.
 */

export const PERMISSIONS = {
  // --- Jobs -----------------------------------------------------------------
  "job.view": {
    group: "Jobs",
    label: "View jobs",
    description: "See job pages, timelines and history.",
  },
  "job.create": {
    group: "Jobs",
    label: "Create jobs",
    description:
      "Create a work order. Techs may create ad-hoc jobs, which land in PENDING_APPROVAL and are approved retroactively.",
  },
  "job.assign": {
    group: "Jobs",
    label: "Assign techs",
    description: "Put techs on a job and pick the Lead Tech.",
  },
  "job.reassign": {
    group: "Jobs",
    label: "Reassign techs",
    description: "Move a job from one tech to another after it was assigned.",
  },
  "job.edit_planned_fields": {
    group: "Jobs",
    label: "Edit planned fields",
    description:
      "Change planned fields that already hold a value, without going through a change request.",
  },
  "job.fill_missing_field": {
    group: "Jobs",
    label: "Fill missing fields",
    description:
      "Write into a planned field that was left empty. Always logged to the timeline.",
  },
  "job.suggest_change": {
    group: "Jobs",
    label: "Suggest changes",
    description: "Raise a change request against a populated planned field.",
  },
  "job.approve_change": {
    group: "Jobs",
    label: "Approve changes",
    description: "Approve or reject change requests raised by others.",
  },
  "job.clock_in": {
    group: "Jobs",
    label: "Clock in / out",
    description: "Start and stop time on a job.",
  },
  "job.adjust_time": {
    group: "Jobs",
    label: "Adjust clock times",
    description:
      "Clock in or out earlier/later than now. Techs are capped by the company-wide adjustment limit; supervisors and above are not.",
  },
  "job.set_outcome_status": {
    group: "Jobs",
    label: "Set outcome status",
    description: "COMPLETED / INCOMPLETE / FAIL / CANCEL at checkout.",
  },
  "job.set_internal_status": {
    group: "Jobs",
    label: "Set internal status",
    description:
      "REVISIT REQUIRED / RESCHEDULED / RESCHEDULE CANCELLED. Internal only, never exported to the client.",
  },
  "job.approve_report": {
    group: "Jobs",
    label: "Approve reports",
    description: "Final review that moves a job from PENDING_REVIEW to APPROVED.",
  },
  "job.override_missing_signoff": {
    group: "Jobs",
    label: "Override missing sign-off",
    description: "Let a job close without a required Sign Off deliverable.",
  },
  "job.delete": {
    group: "Jobs",
    label: "Delete jobs",
    description: "Permanently remove a job and everything attached to it.",
  },

  // --- Deliverables ---------------------------------------------------------
  "deliverable.upload": {
    group: "Deliverables",
    label: "Upload deliverables",
    description: "Add photos, PDFs, serials and notes to a job.",
  },
  "deliverable.delete": {
    group: "Deliverables",
    label: "Delete deliverables",
    description: "Remove uploaded files. Techs can only do this before approval.",
  },

  // --- Exports --------------------------------------------------------------
  "export.text": {
    group: "Exports",
    label: "Export text report",
    description: "Generate the client-facing text report for a job.",
  },
  "export.zip": {
    group: "Exports",
    label: "Export job ZIP",
    description: "Download the full job archive with photos and the report.",
  },
  "export.internal_wo": {
    group: "Exports",
    label: "Export internal Work Order PDF",
    description: "Generate the company's internal PDF work order.",
  },
  "export.pay": {
    group: "Exports",
    label: "Export pay journal",
    description: "Weekly and monthly pay spreadsheets.",
  },

  // --- Pay ------------------------------------------------------------------
  "pay.view_rates": {
    group: "Pay",
    label: "View pay rates",
    description: "See pay type, rate and earnings.",
  },
  "pay.edit_rates": {
    group: "Pay",
    label: "Edit pay rates",
    description: "Set default, project, client and per-job rates.",
  },
  "payroll.view": {
    group: "Pay",
    label: "View payroll",
    description: "See weekly payroll periods and their lines.",
  },
  "payroll.run": {
    group: "Pay",
    label: "Run payroll",
    description: "Build a weekly payroll period and apply per-job overrides.",
  },
  "payroll.approve": {
    group: "Pay",
    label: "Approve payroll",
    description:
      "Approve a tech's week. Normally only the Direct Supervisor, who actually pays. Manager approval is recorded as a fallback.",
  },
  "payroll.mark_received": {
    group: "Pay",
    label: "Mark payroll received",
    description:
      "Record Received / REDUCED, the amount and the date it landed.",
  },

  // --- Mileage --------------------------------------------------------------
  "mileage.submit": {
    group: "Mileage",
    label: "Submit mileage",
    description: "Log trips with odometer readings and photos.",
  },
  "mileage.approve": {
    group: "Mileage",
    label: "Approve mileage",
    description: "Approve or reject submitted trips.",
  },

  // --- Administration -------------------------------------------------------
  "project.manage": {
    group: "Administration",
    label: "Manage projects",
    description:
      "Create and edit projects, members, general scope and deliverable rules.",
  },
  "client.manage": {
    group: "Administration",
    label: "Manage clients & sites",
    description: "Maintain buyers, customers and site records.",
  },
  "users.manage": {
    group: "Administration",
    label: "Manage users",
    description: "Activate users and set direct supervisors.",
  },
  "roles.manage": {
    group: "Administration",
    label: "Manage roles",
    description: "Edit this permission matrix and per-user overrides.",
  },
  "settings.company": {
    group: "Administration",
    label: "Company settings",
    description: "Name, logo, contacts, rounding, mileage rate, pay lag.",
  },
  "settings.integrations": {
    group: "Administration",
    label: "Integrations",
    description: "NextCloud OIDC, CalDAV calendars, storage and backups.",
  },
  "audit.view": {
    group: "Administration",
    label: "View audit log",
    description: "Read the event timeline.",
  },
} as const satisfies Record<
  string,
  { group: string; label: string; description: string }
>;

export type Permission = keyof typeof PERMISSIONS;

export const PERMISSION_KEYS = Object.keys(PERMISSIONS) as Permission[];

export const PERMISSION_GROUPS = [
  "Jobs",
  "Deliverables",
  "Exports",
  "Pay",
  "Mileage",
  "Administration",
] as const;

/** Higher wins. Used for both comparison and superset resolution. */
const SCOPE_RANK: Record<PermissionScope, number> = {
  OWN: 0,
  REPORTS: 1,
  PROJECT: 2,
  ALL: 3,
};

export function scopeAtLeast(
  actual: PermissionScope,
  required: PermissionScope,
): boolean {
  return SCOPE_RANK[actual] >= SCOPE_RANK[required];
}

export function widestScope(
  a: PermissionScope,
  b: PermissionScope,
): PermissionScope {
  return SCOPE_RANK[a] >= SCOPE_RANK[b] ? a : b;
}

/**
 * Seeded defaults. These are the starting point only — once seeded, the matrix
 * is owned by Managers through the UI and this table is not re-applied.
 */
export const DEFAULT_ROLE_GRANTS: Record<
  BaseRole,
  Partial<Record<Permission, PermissionScope>>
> = {
  TECH: {
    "job.view": "OWN",
    "job.create": "OWN",
    "job.clock_in": "OWN",
    "job.adjust_time": "OWN",
    "job.fill_missing_field": "OWN",
    "job.suggest_change": "OWN",
    "job.set_outcome_status": "OWN",
    "deliverable.upload": "OWN",
    "deliverable.delete": "OWN",
    "export.text": "OWN",
    "export.zip": "OWN",
    "export.pay": "OWN",
    "pay.view_rates": "OWN",
    "payroll.view": "OWN",
    "payroll.mark_received": "OWN",
    "mileage.submit": "OWN",
    "audit.view": "OWN",
  },

  SUPERVISOR: {
    "job.view": "PROJECT",
    "job.create": "PROJECT",
    "job.assign": "PROJECT",
    "job.reassign": "PROJECT",
    "job.edit_planned_fields": "PROJECT",
    "job.fill_missing_field": "PROJECT",
    "job.suggest_change": "PROJECT",
    "job.approve_change": "PROJECT",
    "job.clock_in": "OWN",
    "job.adjust_time": "PROJECT",
    "job.set_outcome_status": "PROJECT",
    "job.set_internal_status": "PROJECT",
    "job.approve_report": "PROJECT",
    "job.override_missing_signoff": "PROJECT",
    "deliverable.upload": "PROJECT",
    "deliverable.delete": "PROJECT",
    "export.text": "PROJECT",
    "export.zip": "PROJECT",
    "export.internal_wo": "PROJECT",
    "export.pay": "REPORTS",
    "pay.view_rates": "REPORTS",
    "pay.edit_rates": "REPORTS",
    "payroll.view": "REPORTS",
    "payroll.run": "REPORTS",
    // Deliberately REPORTS and not PROJECT: a supervisor pays the techs who
    // report to them, not every tech who happens to be on their project.
    "payroll.approve": "REPORTS",
    "payroll.mark_received": "REPORTS",
    "mileage.submit": "OWN",
    "mileage.approve": "REPORTS",
    "project.manage": "PROJECT",
    "audit.view": "PROJECT",
  },

  MANAGER: {
    "job.view": "ALL",
    "job.create": "ALL",
    "job.assign": "ALL",
    "job.reassign": "ALL",
    "job.edit_planned_fields": "ALL",
    "job.fill_missing_field": "ALL",
    "job.suggest_change": "ALL",
    "job.approve_change": "ALL",
    "job.clock_in": "OWN",
    "job.adjust_time": "ALL",
    "job.set_outcome_status": "ALL",
    "job.set_internal_status": "ALL",
    "job.approve_report": "ALL",
    "job.override_missing_signoff": "ALL",
    "job.delete": "ALL",
    "deliverable.upload": "ALL",
    "deliverable.delete": "ALL",
    "export.text": "ALL",
    "export.zip": "ALL",
    "export.internal_wo": "ALL",
    "export.pay": "ALL",
    "pay.view_rates": "ALL",
    "pay.edit_rates": "ALL",
    "payroll.view": "ALL",
    "payroll.run": "ALL",
    // Fallback approver when a supervisor is unavailable. Every fallback
    // approval is flagged so the supervisor sees who paid their tech.
    "payroll.approve": "ALL",
    "payroll.mark_received": "ALL",
    "mileage.submit": "OWN",
    "mileage.approve": "ALL",
    "project.manage": "ALL",
    "client.manage": "ALL",
    "users.manage": "ALL",
    "roles.manage": "ALL",
    "settings.company": "ALL",
    "audit.view": "ALL",
  },

  ADMINISTRATOR: {
    "job.view": "ALL",
    "pay.view_rates": "ALL",
    "payroll.view": "ALL",
    "users.manage": "ALL",
    "settings.company": "ALL",
    "settings.integrations": "ALL",
    "audit.view": "ALL",
  },

  // Read-only money role: sees everything, changes nothing.
  ACCOUNTANT: {
    "job.view": "ALL",
    "export.text": "ALL",
    "export.zip": "ALL",
    "export.internal_wo": "ALL",
    "export.pay": "ALL",
    "pay.view_rates": "ALL",
    "payroll.view": "ALL",
    "audit.view": "ALL",
  },
};
