import { formatAddress } from "@/lib/address";
import { usDateInZone, usTimeInZone } from "@/lib/datetime";
import type { JobExportData } from "@/lib/exports/job-data";
import { returnTracking, workSummary } from "@/lib/exports/text-report";
import { visitTotals } from "@/lib/time-tracking";

/**
 * What a box on a company's blank can be bound to.
 *
 * Every sign-off sheet asks for the same twenty facts in a different order,
 * under different names, in boxes of different sizes. This is that list of
 * facts, written once. A blank is set up by pointing each of its boxes at an
 * entry here, and filling it is then a lookup rather than a judgement.
 *
 * Keys are stored in the database and must not be renamed once a company has
 * mapped a form against them. Adding to the list is free; changing a key
 * silently un-maps every form that used it.
 */

export type FormFillContext = {
  data: JobExportData;
  /** The moment the form is being produced, for "today's date" boxes. */
  now: Date;
};

export type FormSource = {
  key: string;
  label: string;
  group: string;
  /** Repeats down a table — the placement names which row it wants. */
  list?: boolean;
  /** Long enough to need wrapping and a box with some height. */
  multiline?: boolean;
  /** Resolves to text. Exactly one of resolve/resolveImage is set. */
  resolve?: (context: FormFillContext, rowIndex: number) => string | null;
  /** Resolves to a stored image, by storage path. */
  resolveImage?: (context: FormFillContext) => string | null;
};

/** The literal-text source. Its value lives on the placement, not the job. */
export const STATIC_SOURCE = "static";

function zone(context: FormFillContext): string {
  return context.data.timeZone;
}

/** "Zhuly Gonzales" -> "ZG". What people write in a tech-initials box. */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

function techNames(context: FormFillContext): string[] {
  return context.data.job.assignments.map((assignment) => assignment.user.name);
}

function contactNames(
  context: FormFillContext,
  type: "MOD" | "NOC" | "PM_PC",
): string[] {
  return context.data.job.pointsOfContact
    .filter((contact) => contact.type === type)
    .map((contact) => contact.name);
}

/**
 * Every visit on the job in the order they happened, regardless of who made
 * them. A timesheet on a sign-off sheet has one row per trip, not per tech.
 */
function visits(context: FormFillContext) {
  return context.data.job.assignments
    .flatMap((assignment) => assignment.visits)
    .sort((a, b) => a.clockInAt.getTime() - b.clockInAt.getTime());
}

function visitAt(context: FormFillContext, rowIndex: number) {
  return visits(context)[rowIndex] ?? null;
}

function hours(minutes: number): string {
  return `${(minutes / 60).toFixed(2)} hrs`;
}

function signaturePath(
  context: FormFillContext,
  kind: "MOD" | "TECH",
): string | null {
  const signature = context.data.job.signatures.find(
    (entry) => entry.kind === kind && !entry.skipped && entry.attachment,
  );
  return signature?.attachment?.storagePath ?? null;
}

function signature(context: FormFillContext, kind: "MOD" | "TECH") {
  return context.data.job.signatures.find(
    (entry) => entry.kind === kind && !entry.skipped,
  );
}

const SOURCES: FormSource[] = [
  // -------------------------------------------------------------------------
  { group: "Tech", key: "tech.names", label: "Tech name(s)",
    resolve: (context) => techNames(context).join(", ") || null },
  { group: "Tech", key: "tech.lead", label: "Lead tech",
    // assignments come back lead-first, so the head of the list is the lead.
    resolve: (context) => techNames(context)[0] ?? null },
  { group: "Tech", key: "tech.initials", label: "Tech initials",
    resolve: (context) =>
      techNames(context).map(initials).join(", ") || null },
  // Asked for by name on a real billing table: "# Techs".
  { group: "Tech", key: "tech.count", label: "Number of techs",
    resolve: (context) => {
      const count = context.data.job.assignments.length;
      return count > 0 ? String(count) : null;
    } },

  // -------------------------------------------------------------------------
  { group: "Job", key: "job.assignmentId", label: "Assignment ID",
    resolve: (context) => context.data.job.externalAssignmentId },
  { group: "Job", key: "job.ticket", label: "Ticket #",
    resolve: (context) => context.data.job.ticketNumber },
  { group: "Job", key: "job.intWoId", label: "Internal WO ID",
    resolve: (context) => context.data.job.intWoId },
  { group: "Job", key: "job.title", label: "Job title",
    resolve: (context) => context.data.job.title },
  { group: "Job", key: "job.releaseCode", label: "Release code",
    resolve: (context) =>
      context.data.job.noReleaseCode ? null : context.data.job.releaseCode },
  { group: "Job", key: "job.returnTracking", label: "Return tracking #",
    resolve: (context) => returnTracking(context.data) },
  { group: "Job", key: "job.scope", label: "Scope of work", multiline: true,
    resolve: (context) => context.data.job.scopeOfWork },
  { group: "Job", key: "job.summary", label: "Work summary", multiline: true,
    resolve: (context) => workSummary(context.data) },
  { group: "Job", key: "job.materials", label: "Materials used", multiline: true,
    resolve: (context) => {
      const used = context.data.job.reimbursements
        .filter((entry) => entry.type === "MATERIAL")
        .map((entry) => entry.label ?? "Material");
      return used.length > 0 ? used.join(", ") : null;
    } },

  // -------------------------------------------------------------------------
  { group: "Companies", key: "client.name", label: "Representing company",
    resolve: (context) => context.data.job.client.name },
  { group: "Companies", key: "customer.name", label: "Customer",
    resolve: (context) => context.data.job.customer.name },
  { group: "Companies", key: "customer.code", label: "Customer code",
    resolve: (context) => context.data.job.customer.code },
  { group: "Companies", key: "project.name", label: "Project",
    resolve: (context) => context.data.job.project?.name ?? null },
  { group: "Companies", key: "company.name", label: "Our company",
    resolve: (context) => context.data.company.name },
  { group: "Companies", key: "company.phone", label: "Our phone",
    resolve: (context) => context.data.company.phone },

  // -------------------------------------------------------------------------
  { group: "Site", key: "site.label", label: "Site name & ID",
    resolve: (context) => context.data.siteName },
  { group: "Site", key: "site.number", label: "Site number",
    resolve: (context) => context.data.job.site.siteNumber },
  { group: "Site", key: "site.name", label: "Site name",
    resolve: (context) => context.data.job.site.name },
  { group: "Site", key: "site.address", label: "Address, one line",
    resolve: (context) => formatAddress(context.data.job.site) },
  { group: "Site", key: "site.address1", label: "Street address",
    resolve: (context) => context.data.job.site.addressLine1 },
  { group: "Site", key: "site.address2", label: "Suite / unit",
    resolve: (context) => context.data.job.site.addressLine2 },
  { group: "Site", key: "site.city", label: "City",
    resolve: (context) => context.data.job.site.city },
  { group: "Site", key: "site.state", label: "State",
    resolve: (context) => context.data.job.site.state },
  { group: "Site", key: "site.zip", label: "ZIP",
    resolve: (context) => context.data.job.site.postalCode },
  { group: "Site", key: "site.cityStateZip", label: "City, State ZIP",
    resolve: (context) => {
      const site = context.data.job.site;
      return `${site.city}, ${site.state} ${site.postalCode}`;
    } },

  // -------------------------------------------------------------------------
  { group: "Times", key: "time.date", label: "Date of work",
    resolve: (context) =>
      usDateInZone(
        context.data.span.onsiteAt ??
          context.data.job.scheduledStart ??
          context.data.job.createdAt,
        zone(context),
      ) },
  { group: "Times", key: "time.today", label: "Today's date",
    resolve: (context) => usDateInZone(context.now, zone(context)) },
  { group: "Times", key: "time.onsite", label: "Onsite (check in)",
    resolve: (context) =>
      context.data.span.onsiteAt
        ? usTimeInZone(context.data.span.onsiteAt, zone(context))
        : null },
  { group: "Times", key: "time.offsite", label: "Offsite (check out)",
    resolve: (context) =>
      context.data.span.offsiteAt
        ? usTimeInZone(context.data.span.offsiteAt, zone(context))
        : null },
  { group: "Times", key: "time.total", label: "Total time",
    resolve: (context) =>
      context.data.span.totalMinutes > 0
        ? hours(context.data.span.totalMinutes)
        : null },
  { group: "Times", key: "time.scheduled", label: "Scheduled date",
    resolve: (context) =>
      context.data.job.scheduledStart
        ? usDateInZone(context.data.job.scheduledStart, zone(context))
        : null },
  // The day the job was raised here, which is what a form asking for "date
  // received" is after — the day the work landed on us.
  { group: "Times", key: "time.created", label: "Date the job came in",
    resolve: (context) =>
      usDateInZone(context.data.job.createdAt, zone(context)) },

  // A sign-off sheet with a day-by-day table wants these, one row per trip.
  { group: "Per visit", key: "visit.date", label: "Visit date", list: true,
    resolve: (context, row) => {
      const visit = visitAt(context, row);
      return visit ? usDateInZone(visit.clockInAt, zone(context)) : null;
    } },
  { group: "Per visit", key: "visit.in", label: "Visit time in", list: true,
    resolve: (context, row) => {
      const visit = visitAt(context, row);
      return visit ? usTimeInZone(visit.clockInAt, zone(context)) : null;
    } },
  { group: "Per visit", key: "visit.out", label: "Visit time out", list: true,
    resolve: (context, row) => {
      const visit = visitAt(context, row);
      return visit?.clockOutAt
        ? usTimeInZone(visit.clockOutAt, zone(context))
        : null;
    } },
  { group: "Per visit", key: "visit.hours", label: "Visit hours", list: true,
    resolve: (context, row) => {
      const visit = visitAt(context, row);
      if (!visit || !visit.clockOutAt) return null;
      return hours(visitTotals(visit).onsiteMinutes);
    } },
  { group: "Per visit", key: "visit.break", label: "Visit break", list: true,
    resolve: (context, row) => {
      const visit = visitAt(context, row);
      if (!visit || !visit.clockOutAt) return null;
      const totals = visitTotals(visit);
      const minutes = totals.paidBreakMinutes + totals.unpaidBreakMinutes;
      return minutes > 0 ? hours(minutes) : null;
    } },
  { group: "Per visit", key: "visit.tech", label: "Visit tech", list: true,
    resolve: (context, row) => {
      const ordered = context.data.job.assignments.flatMap((assignment) =>
        assignment.visits.map((visit) => ({ visit, name: assignment.user.name })),
      );
      ordered.sort(
        (a, b) => a.visit.clockInAt.getTime() - b.visit.clockInAt.getTime(),
      );
      return ordered[row]?.name ?? null;
    } },

  // -------------------------------------------------------------------------
  { group: "Contacts", key: "contact.pm", label: "Rep Company PM/PC",
    resolve: (context) =>
      [
        context.data.job.pmContact?.name,
        ...contactNames(context, "PM_PC"),
      ]
        .filter((name): name is string => Boolean(name))
        .join(", ") || null },
  { group: "Contacts", key: "contact.mod", label: "MOD name",
    resolve: (context) => contactNames(context, "MOD").join(", ") || null },
  { group: "Contacts", key: "contact.noc", label: "NOC name",
    resolve: (context) => contactNames(context, "NOC").join(", ") || null },

  // -------------------------------------------------------------------------
  { group: "Signature", key: "signature.mod", label: "Customer signature",
    resolveImage: (context) => signaturePath(context, "MOD") },
  { group: "Signature", key: "signature.modName", label: "Customer printed name",
    resolve: (context) => signature(context, "MOD")?.signerName ?? null },
  { group: "Signature", key: "signature.modDate", label: "Customer sign date",
    resolve: (context) => {
      const signedAt = signature(context, "MOD")?.signedAt;
      return signedAt ? usDateInZone(signedAt, zone(context)) : null;
    } },
  { group: "Signature", key: "signature.tech", label: "Tech signature",
    resolveImage: (context) => signaturePath(context, "TECH") },
  { group: "Signature", key: "signature.techName", label: "Tech printed name",
    resolve: (context) => signature(context, "TECH")?.signerName ?? null },

  // -------------------------------------------------------------------------
  { group: "Other", key: STATIC_SOURCE, label: "Fixed text",
    // The value lives on the placement; the filler reads it from there.
    resolve: () => null },
];

const BY_KEY = new Map(SOURCES.map((source) => [source.key, source]));

export function formSources(): readonly FormSource[] {
  return SOURCES;
}

export function formSource(key: string): FormSource | null {
  return BY_KEY.get(key) ?? null;
}

/** The dropdown, in the order the groups should appear. */
export function formSourceGroups(): { group: string; sources: FormSource[] }[] {
  const groups: { group: string; sources: FormSource[] }[] = [];
  for (const source of SOURCES) {
    const existing = groups.find((entry) => entry.group === source.group);
    if (existing) existing.sources.push(source);
    else groups.push({ group: source.group, sources: [source] });
  }
  return groups;
}
