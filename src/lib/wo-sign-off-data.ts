import { usDateInZone, usTimeInZone } from "@/lib/datetime";
import type { JobExportData } from "@/lib/exports/job-data";
import { workSummary } from "@/lib/exports/text-report";
import type { WorkOrderDefaults } from "@/lib/wo-sign-off";

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

  const signature = data.job.signatures.find(
    (entry) => entry.kind === "MOD" && !entry.skipped,
  );
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
  const signature = data.job.signatures.find(
    (entry) => entry.kind === "MOD" && !entry.skipped && entry.attachment,
  );
  return signature?.attachment?.storagePath ?? null;
}
