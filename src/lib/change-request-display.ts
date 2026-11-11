import { placeLabel, siteLabelOnScreen } from "@/lib/address";
import {
  decimalHours,
  parseDatetimeLocalInZone,
  usDateTimeInZone,
  usTimeInZone,
} from "@/lib/datetime";
import { db } from "@/lib/db";
import { JOB_FIELDS, isJobField } from "@/lib/job-fields";

/**
 * A change request, as somebody deciding it should read it.
 *
 * A request stores what the field stores, because that is what gets written
 * when it is approved: a site as its id, a time as an instant or as the
 * site-local string the form posted, a punch as a path to the visit and a blob
 * of JSON. None of that is something to decide from. This used to be mended in
 * one place — punches, on the job's own page — while the Approvals page, where
 * most requests are first seen, printed "visit.cmw3….clockOut" on the badge and
 * an ISO string or a database id on either side of the arrow.
 *
 * Everything that shows a request goes through here, so the four places that
 * do cannot drift apart again.
 */

export type StoredRequest = {
  fieldPath: string;
  oldValue: string | null;
  newValue: string | null;
};

/** What a site id reads as: "TSA #4471 · Covina, CA". */
export type SiteNames = ReadonlyMap<string, string>;

/** "Scheduled start", "Punch" — what the request is about, never its path. */
export function requestKind(fieldPath: string): string {
  if (isJobField(fieldPath)) return JOB_FIELDS[fieldPath].label;
  if (fieldPath.startsWith("visit.")) return "Punch";
  return fieldPath;
}

/**
 * The sites these requests name, looked up once.
 *
 * Only a request to move the job carries one, so most pages ask for none and
 * this never reaches the database.
 */
export async function siteNamesFor(
  requests: readonly StoredRequest[],
): Promise<SiteNames> {
  const ids = new Set<string>();
  for (const request of requests) {
    if (request.fieldPath !== "siteId") continue;
    if (request.oldValue) ids.add(request.oldValue);
    if (request.newValue) ids.add(request.newValue);
  }
  if (ids.size === 0) return new Map();

  const sites = await db.site.findMany({
    where: { id: { in: Array.from(ids) } },
    select: {
      id: true,
      siteNumber: true,
      numberPending: true,
      city: true,
      state: true,
      customer: { select: { code: true } },
    },
  });

  return new Map(
    sites.map((site) => [
      site.id,
      placeLabel(siteLabelOnScreen(site.customer.code, site), site),
    ]),
  );
}

/** A punch: one instant, or the pair of them somebody asked for. */
function punchText(raw: string, zone: string): string {
  if (raw.startsWith("{")) {
    try {
      const parsed = JSON.parse(raw) as {
        clockIn?: string | null;
        clockOut?: string | null;
      };
      return [
        parsed.clockIn
          ? `in ${usTimeInZone(new Date(parsed.clockIn), zone)}`
          : null,
        parsed.clockOut
          ? `out ${usTimeInZone(new Date(parsed.clockOut), zone)}`
          : null,
      ]
        .filter(Boolean)
        .join(", ");
    } catch {
      return raw;
    }
  }
  const at = new Date(raw);
  return Number.isNaN(at.getTime()) ? raw : usDateTimeInZone(at, zone);
}

function valueText(
  fieldPath: string,
  raw: string | null,
  zone: string,
  sites: SiteNames,
): string | null {
  if (!raw) return null;
  if (fieldPath.startsWith("visit.")) return punchText(raw, zone);
  if (!isJobField(fieldPath)) return raw;

  const kind = JOB_FIELDS[fieldPath].kind;

  if (kind === "site") {
    return sites.get(raw) ?? "A site that is no longer in the directory";
  }

  if (kind === "datetime") {
    // Two shapes are in the table. The details form stores the site-local
    // string it was given, on both sides; a suggestion made on the job page
    // stored the old value as the instant it was. Either way it is read in
    // the site's zone, which is the clock the job is planned on.
    const at = parseDatetimeLocalInZone(raw, zone);
    return at ? usDateTimeInZone(at, zone) : raw;
  }

  // Kept in minutes, read in hours everywhere else on the job.
  if (fieldPath === "estimateMinutes") {
    const minutes = Number(raw);
    return Number.isFinite(minutes) ? `${decimalHours(minutes)} hrs` : raw;
  }

  return raw;
}

/**
 * Both sides of the arrow, readable.
 *
 * @param zone the job's own zone — a punch or a schedule is a time on site
 */
export function readableRequest(
  request: StoredRequest,
  zone: string,
  sites: SiteNames,
): { oldValue: string | null; newValue: string | null } {
  return {
    oldValue: valueText(request.fieldPath, request.oldValue, zone, sites),
    newValue: valueText(request.fieldPath, request.newValue, zone, sites),
  };
}
