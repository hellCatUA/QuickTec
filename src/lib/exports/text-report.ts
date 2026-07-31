import { formatAddress } from "@/lib/address";
import { usTimeInZone } from "@/lib/datetime";
import type { JobExportData } from "@/lib/exports/job-data";

/**
 * The client-facing text report.
 *
 * The template is fixed — it is pasted into an email to the subcontractor, so
 * the labels and their order are not ours to change. Two conventions for an
 * absent value, agreed with the business:
 *
 *   "-"    a required field that was deliberately bypassed or never obtained
 *   "N/a"  a field that was optional to begin with
 *
 * Nothing internal appears here: no hotel claims, no INC number, no internal
 * status, no pay.
 */

const NOT_OBTAINED = "-";
const NOT_APPLICABLE = "N/a";

/** Fields in the order the template lists them. */
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
 * Return tracking comes from the job field when someone typed it there, and
 * otherwise from whatever was entered against the Return Labels deliverable.
 */
export function returnTracking(data: JobExportData): string | null {
  if (data.job.returnTrackingNumber?.trim()) {
    return data.job.returnTrackingNumber.trim();
  }

  const fromDeliverable = data.job.deliverables
    .filter((item) => item.category === "RETURN_LABELS" && item.textValue?.trim())
    .map((item) => item.textValue!.trim());

  return fromDeliverable.length > 0 ? fromDeliverable.join(", ") : null;
}

export function buildTextReport(data: JobExportData): string {
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

    "Ticket #": job.ticketNumber ?? NOT_OBTAINED,

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
