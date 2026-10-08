import { formatAddress } from "@/lib/address";
import { assignmentTerms, labourCentsFor } from "@/lib/budget";
import { isoDateInZone, usTimeInZone } from "@/lib/datetime";
import type { JobExportData } from "@/lib/exports/job-data";
import { fromCents, toCents } from "@/lib/money";
import { safeSegment } from "@/lib/exports/photo-layout";
import { ticketList } from "@/lib/tickets";
import { assignmentTotals } from "@/lib/time-tracking";

/**
 * The WM Form: the text report pasted into an email for the job.
 *
 * Two versions. "Updated (10/2026)" is the one sent now — one per tech, with
 * what they were on site for and what they are owed, because it serves
 * WorkMarket and the company we started working with alike. "Legacy" is the
 * form WorkMarket alone used to get, kept for the odd job that still wants
 * it, and left exactly as it was.
 *
 * The templates are fixed — the labels, their order and the blank lines
 * between the groups are not ours to change. Two conventions for an absent
 * value, agreed with the business:
 *
 *   "-"    a required field that was deliberately bypassed or never obtained
 *   "N/a"  a field that was optional to begin with
 *
 * Neither has the INC number or the internal status. The legacy form has no
 * pay and no hotel claims either; the updated one has the tech's own.
 */

const NOT_OBTAINED = "-";
const NOT_APPLICABLE = "N/a";

/** The legacy form's fields, in the order its template lists them. */
const TEMPLATE: readonly string[] = [
  "Tech name",
  "Assignment ID",
  "Site name & ID",
  "Address",
  "Buyer/Representing company",
  "Onsite (Check in)",
  "Offsite (Check out)",
  "Total time",
  "Parking/Tolls",
  "PM/PC name",
  "MOD name",
  "NOC name",
  "Ticket #",
  "Release code",
  "Return track #",
  "Materials used",
  "Work summary",
];

// Amounts come back from Prisma as Decimal objects, which Number() reads via
// valueOf — accepting the wider type keeps every caller from stringifying first.
function money(amount: { toString(): string }): string {
  return `$${Number(amount.toString()).toFixed(2)}`;
}

/** "- Parking $12.00" per line, under the label. */
function bulletList(entries: string[]): string | null {
  if (entries.length === 0) return null;
  return `\n${entries.map((entry) => `- ${entry}`).join("\n")}`;
}

function contactNames(
  data: JobExportData,
  type: "MOD" | "NOC" | "PM_PC",
): string[] {
  return data.job.pointsOfContact
    .filter((contact) => contact.type === type)
    .map((contact) => contact.name);
}

/**
 * The narrative that goes to the client. A lead who merged the entries owns
 * the result; until then each contribution is prefixed with its author so the
 * reader can tell two techs apart.
 */
export function workSummary(data: JobExportData): string | null {
  if (data.job.workPerformedMerged?.trim()) {
    return data.job.workPerformedMerged.trim();
  }

  const entries = data.job.assignments
    .filter((assignment) => assignment.workPerformed?.trim())
    .map(
      (assignment) =>
        `${assignment.user.name}: ${assignment.workPerformed!.trim()}`,
    );

  return entries.length > 0 ? entries.join("\n\n") : null;
}

/**
 * Return tracking comes from the Return Labels deliverable, where the numbers
 * are recorded one per line beside the photo of the label, and falls back to
 * the job field for jobs raised before it was recorded there.
 *
 * However many boxes go back, the client reads one comma-separated list.
 */
export function returnTracking(data: JobExportData): string | null {
  const fromDeliverable = data.job.deliverables
    .filter((item) => item.category === "RETURN_LABELS" && item.textValue?.trim())
    .flatMap((item) =>
      item
        .textValue!.split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    );

  if (fromDeliverable.length > 0) return fromDeliverable.join(", ");

  return data.job.returnTrackingNumber?.trim() || null;
}

/** The form WorkMarket alone used to get, as it always was. */
export function buildLegacyWmForm(data: JobExportData): string {
  const { job, timeZone, span } = data;

  const materials = job.reimbursements
    .filter((entry) => entry.type === "MATERIAL")
    .map((entry) => `${entry.label ?? "Material"} ${money(entry.amount)}`);

  // Parking and tolls are labelled by their type; the entry has no name of
  // its own because "Parking $12.00" is what the client expects to read.
  const parkingTolls = job.reimbursements
    .filter((entry) => entry.type === "PARKING" || entry.type === "TOLL")
    .map(
      (entry) =>
        `${entry.type === "PARKING" ? "Parking" : "Toll"} ${money(entry.amount)}`,
    );

  const mods = contactNames(data, "MOD");

  const values: Record<string, string> = {
    "Tech name":
      job.assignments.map((a) => a.user.name).join(", ") || NOT_OBTAINED,

    "Assignment ID": job.externalAssignmentId ?? NOT_OBTAINED,

    "Site name & ID": data.siteName,

    Address: formatAddress(job.site),

    "Buyer/Representing company": job.client.name,

    "Onsite (Check in)": span.onsiteAt
      ? usTimeInZone(span.onsiteAt, timeZone)
      : NOT_OBTAINED,

    "Offsite (Check out)": span.offsiteAt
      ? usTimeInZone(span.offsiteAt, timeZone)
      : NOT_OBTAINED,

    "Total time":
      span.totalMinutes > 0
        ? `${(span.totalMinutes / 60).toFixed(2)} hrs`
        : NOT_OBTAINED,

    "Parking/Tolls": bulletList(parkingTolls) ?? NOT_APPLICABLE,

    // The coordinator recorded on the job and anybody named PM/PC on site,
    // deduped: to the client they are the same line. Names only — the phone
    // number we hold for them is ours, not theirs to be handed back.
    "PM/PC name":
      Array.from(
        new Set(
          [
            data.job.pmContact?.name,
            ...contactNames(data, "PM_PC"),
          ].filter((name): name is string => Boolean(name)),
        ),
      ).join(", ") || NOT_APPLICABLE,

    // A site genuinely without a manager on duty is a fact worth stating
    // rather than a gap, so it gets its own wording.
    "MOD name": mods.length > 0 ? mods.join(", ") : "No MOD",

    "NOC name": contactNames(data, "NOC").join(", ") || NOT_APPLICABLE,

    // Every ticket the job answers to, comma separated: their systems paste
    // a single field, and a second ticket left off is one nobody gets billed
    // for.
    "Ticket #": ticketList(job) ?? NOT_OBTAINED,

    "Release code": job.noReleaseCode
      ? NOT_OBTAINED
      : (job.releaseCode ?? NOT_OBTAINED),

    "Return track #": returnTracking(data) ?? NOT_APPLICABLE,

    "Materials used": bulletList(materials) ?? NOT_APPLICABLE,

    "Work summary": workSummary(data) ?? NOT_OBTAINED,
  };

  return `${TEMPLATE.map((label) => `${label}: ${values[label]}`).join("\n")}\n`;
}

export const TEXT_REPORT_FIELDS = TEMPLATE;

// ---------------------------------------------------------------------------
// Updated (10/2026)
// ---------------------------------------------------------------------------

type Assignment = JobExportData["job"]["assignments"][number];

/** "10/08/26" — the first line of the updated form. */
function shortDate(date: Date, timeZone: string): string {
  const [year, month, day] = isoDateInZone(date, timeZone).split("-");
  return `${month}/${day}/${year.slice(2)}`;
}

/** "$45.00/hr", "$300.00 flat", "$300.00 flat (4 hrs) + $45.00/hr". */
function rateOf(assignment: Assignment): string {
  const terms = assignmentTerms(assignment);
  const dollars = (cents: number) => `$${fromCents(cents)}`;
  if (terms.payType === "HOURLY") return `${dollars(terms.hourlyCents)}/hr`;
  if (terms.payType === "FLAT") return `${dollars(terms.flatCents)} flat`;
  if (terms.payType === "FLAT_HOURLY") {
    const hours = Number((terms.flatMinutes / 60).toFixed(2));
    return `${dollars(terms.flatCents)} flat (${hours} hrs) + ${dollars(terms.hourlyCents)}/hr`;
  }
  return dollars(0);
}

/** "- (2) Cat6 Keystone(s) $8.00": how many, what, and what they all cost. */
export function materialLine(entry: {
  label: string | null;
  quantity: number;
  amount: { toString(): string };
}): string {
  return `(${entry.quantity}) ${entry.label ?? "Material"} ${money(entry.amount)}`;
}

/**
 * The summary on one tech's updated form: the lead's merged one, which is the
 * job's; without one, this tech's own words; failing those everybody's.
 */
export function formSummary(input: {
  merged: string | null;
  own: string | null;
  entries: { who: string; text: string | null }[];
}): string | null {
  if (input.merged?.trim()) return input.merged.trim();
  if (input.own?.trim()) return input.own.trim();
  const written = input.entries.filter((entry) => entry.text?.trim());
  if (written.length === 0) return null;
  // One other tech's words need no name in front of them.
  if (written.length === 1) return written[0].text!.trim();
  return written.map((entry) => `${entry.who}: ${entry.text!.trim()}`).join("\n\n");
}

/**
 * The updated form for one tech on the job.
 *
 * Their own day: the date they started, when they arrived and left, the time
 * they are paid for, and what they are owed for it — the same figures payroll
 * pays them, travel and claims included. A claim with no line of its own on
 * the form — a hotel — gets one after the tolls, and is in the total.
 *
 * The rest is the job's, as every tech on it would write it.
 */
export function buildWmForm(data: JobExportData, assignmentId: string): string | null {
  const { job, timeZone, span } = data;
  const assignment = job.assignments.find((one) => one.id === assignmentId);
  if (!assignment) return null;

  const visits = assignment.visits;
  const totals = assignmentTotals(visits);
  const paidMinutes = Math.round(totals.paidMinutes);
  const firstIn = visits[0]?.clockInAt ?? null;
  const lastOut = totals.hasOpenVisit
    ? null
    : visits.reduce<Date | null>(
        (latest, visit) =>
          visit.clockOutAt && (!latest || visit.clockOutAt > latest)
            ? visit.clockOutAt
            : latest,
        null,
      );

  // A job that runs past midnight is dated the day it started.
  const day =
    firstIn ?? span.onsiteAt ?? job.scheduledStart ?? job.createdAt;

  const claims = job.reimbursements.filter(
    (entry) => entry.assignmentId === assignment.id,
  );
  const sum = (type: string) =>
    claims
      .filter((entry) => entry.type === type)
      .reduce((total, entry) => total + toCents(entry.amount), 0);
  const materials = claims.filter((entry) => entry.type === "MATERIAL");

  // No time on the job is no pay for it, as payroll has it: a tech who never
  // clocked in is paid nothing for the work, flat rate or not.
  const labour =
    visits.length > 0 ? labourCentsFor(assignmentTerms(assignment), paidMinutes) : 0;
  const travel = assignment.travelReimbursement
    ? toCents(assignment.travelReimbursement)
    : 0;
  const parts = {
    materials: sum("MATERIAL"),
    parking: sum("PARKING"),
    tolls: sum("TOLL"),
    hotel: sum("HOTEL"),
  };
  const total =
    labour + travel + parts.materials + parts.parking + parts.tolls + parts.hotel;
  const dollars = (cents: number) => `$${fromCents(cents)}`;

  const pmPc = Array.from(
    new Set(
      [job.pmContact?.name, ...contactNames(data, "PM_PC")].filter(
        (name): name is string => Boolean(name),
      ),
    ),
  );
  const mods = contactNames(data, "MOD");

  const summary = formSummary({
    merged: job.workPerformedMerged,
    own: assignment.workPerformed,
    entries: job.assignments.map((one) => ({ who: one.user.name, text: one.workPerformed })),
  });

  // One group per block of the template, with the blank line between them.
  const groups: string[][] = [
    [shortDate(day, timeZone), `Tech Name: ${assignment.user.name}`],
    [
      `Assignment ID: ${job.externalAssignmentId ?? NOT_OBTAINED}`,
      `Site Name & ID: ${data.siteName}`,
      `Site Address: ${formatAddress(job.site)}`,
    ],
    [
      `Work Order Company: ${job.client.name}`,
      `Representing Company: ${job.repCompany?.name ?? NOT_APPLICABLE}`,
    ],
    [
      `Onsite (Check-In): ${firstIn ? usTimeInZone(firstIn, timeZone) : NOT_OBTAINED}`,
      `Offsite (Check-Out): ${lastOut ? usTimeInZone(lastOut, timeZone) : NOT_OBTAINED}`,
      `Tech total time: ${
        visits.length > 0 ? `${(paidMinutes / 60).toFixed(2)} hrs` : NOT_OBTAINED
      }`,
      `Tech travel: ${dollars(travel)}`,
      `Tech rate: ${rateOf(assignment)}`,
      `Tech materials total amount: ${dollars(parts.materials)}`,
      `Tech parking: ${dollars(parts.parking)}`,
      `Tech tolls: ${dollars(parts.tolls)}`,
      ...(parts.hotel > 0 ? [`Tech hotel: ${dollars(parts.hotel)}`] : []),
      `Tech total: ${dollars(total)}`,
    ],
    [
      `PM / PC Name: ${pmPc.join(", ") || NOT_APPLICABLE}`,
      `MOD / LCON Full Name: ${mods.length > 0 ? mods.join(", ") : "No MOD"}`,
      `NOC / Support Name: ${contactNames(data, "NOC").join(", ") || NOT_APPLICABLE}`,
    ],
    [
      `Ticket #: ${ticketList(job) ?? NOT_OBTAINED}`,
      `Release Code: ${
        job.noReleaseCode ? NOT_OBTAINED : (job.releaseCode ?? NOT_OBTAINED)
      }`,
      `Return Tracking #: ${returnTracking(data) ?? NOT_APPLICABLE}`,
    ],
    [
      materials.length > 0
        ? `Materials Used (Item + Qty):\n${materials
            .map((entry) => `- ${materialLine(entry)}`)
            .join("\n")}`
        : `Materials Used (Item + Qty): ${NOT_APPLICABLE}`,
    ],
    [`Work Summary (max. 500 characters): ${summary ?? NOT_OBTAINED}`],
  ];

  return `${groups.map((group) => group.join("\n")).join("\n\n")}\n`;
}

/**
 * What the form is saved as: "WM Form.txt" — "WM Form - Terry Tech.txt" on a
 * job with more than one tech, where each has their own.
 */
export function wmFormFileName(
  data: JobExportData,
  form: { assignmentId: string } | "legacy",
): string {
  if (form === "legacy") return "WM Form (Legacy).txt";
  if (data.job.assignments.length < 2) return "WM Form.txt";
  const name =
    data.job.assignments.find((one) => one.id === form.assignmentId)?.user.name ?? "Tech";
  // A name is not a path: "Ann/Lee" must not open a folder in the archive.
  return `WM Form - ${safeSegment(name)}.txt`;
}
