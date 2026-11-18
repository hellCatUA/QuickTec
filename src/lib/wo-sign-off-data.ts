import { usDateInZone, usTimeInZone } from "@/lib/datetime";
import type { JobExportData } from "@/lib/exports/job-data";
import { workSummary } from "@/lib/exports/text-report";
import type { WorkOrderDefaults } from "@/lib/wo-sign-off";

/**
 * Which of the manager's signatures goes on the work order: one with a
 * picture, the latest signed, the same one every time it is asked.
 *
 * The screen and the server used to take the first from a list in no
 * particular order, by two different rules, so a job signed twice could show
 * one signature on the screen and save the other.
 */
export function modSignatureOf<
  T extends {
    id: string;
    kind: string;
    skipped: boolean;
    signedAt: Date | null;
    attachment: unknown;
  },
>(signatures: T[]): T | null {
  return (
    signatures
      .filter((entry) => entry.kind === "MOD" && !entry.skipped)
      .sort(
        (a, b) =>
          Number(Boolean(b.attachment)) - Number(Boolean(a.attachment)) ||
          (b.signedAt?.getTime() ?? 0) - (a.signedAt?.getTime() ?? 0) ||
          (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
      )[0] ?? null
  );
}

/**
 * What the job says goes on its work order: the first check-in and the last
 * check-out on the site's clock, the work performed as the report words it,
 * and who signed for the customer, when, and with what.
 *
 * The same facts the sign-off sheets are filled from, read the same way, so a
 * job that goes out on both says one thing on both.
 */
export function workOrderDefaults(data: JobExportData): WorkOrderDefaults {
  const zone = data.timeZone;
  const moment = (at: Date | null) =>
    at ? { time: usTimeInZone(at, zone), date: usDateInZone(at, zone) } : null;

  const signature = modSignatureOf(data.job.signatures);
  // Whoever signed, else whoever the job lists as the manager on duty: on a
  // job where the MOD did not sign, the name is still the one to print.
  const mod = data.job.pointsOfContact.find((contact) => contact.type === "MOD");

  return {
    checkIn: moment(data.span.onsiteAt),
    checkOut: moment(data.span.offsiteAt),
    notes: workSummary(data) ?? "",
    name: signature?.signerName ?? mod?.name ?? "",
    date: usDateInZone(
      signature?.signedAt ??
        data.span.offsiteAt ??
        data.span.onsiteAt ??
        data.job.scheduledStart ??
        data.job.createdAt,
      zone,
    ),
    signature: signature?.attachment ? { attachmentId: signature.attachment.id } : null,
  };
}

/** The signature file behind the defaults, for the server to draw itself. */
export function signatureStoragePath(data: JobExportData): string | null {
  return modSignatureOf(data.job.signatures)?.attachment?.storagePath ?? null;
}
