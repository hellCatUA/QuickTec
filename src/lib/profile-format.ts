import { DEFAULT_TIME_ZONE } from "@/lib/datetime";
import { formatPhone } from "@/lib/phone";
import { stateName, timeZoneForZip, timeZoneLabel } from "@/lib/us-regions";

/**
 * How profile values read — on the page and in the history, which stores them
 * the way they read so it shows what somebody saw.
 */

export const ROLE_LABEL: Record<string, string> = {
  ADMINISTRATOR: "Administrator",
  MANAGER: "Manager",
  SUPERVISOR: "Supervisor",
  TECH: "Tech",
  ACCOUNTANT: "Accountant",
  GUEST: "Guest",
};

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "March 2019". Dates of service are calendar dates, so read in UTC. */
export function monthYear(date: Date | null): string | null {
  if (!date) return null;
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** "2019-03-04", the value a date input wants. */
export function isoDate(date: Date | null): string {
  return date ? date.toISOString().slice(0, 10) : "";
}

export function phoneText(value: string | null): string | null {
  return value ? formatPhone(value) || value : null;
}

export function stateText(code: string | null): string | null {
  return code ? (stateName(code) ?? code) : null;
}

export function statesText(codes: string[]): string | null {
  return codes.length > 0 ? codes.map((code) => stateName(code) ?? code).join(", ") : null;
}

export function zoneText(zone: string | null): string | null {
  return zone ? timeZoneLabel(zone) : null;
}

/**
 * Whether somebody's zone was picked by hand: flagged so, or neither their
 * ZIP's zone nor the one every account starts with — a zone set on the
 * users page before profiles existed. The starting zone left beside a ZIP
 * on another clock was never picked: nobody chose it, it was just there.
 */
export function zonePickedByHand(profile: {
  timeZone: string | null;
  timeZoneManual: boolean;
  postalCode: string | null;
}): boolean {
  if (profile.timeZoneManual) return true;
  return profile.timeZone !== timeZoneForZip(profile.postalCode) && profile.timeZone !== DEFAULT_TIME_ZONE;
}

/**
 * A zone as its history says it, and how it was set: "Manual: Mountain"
 * when picked, "Auto (ZIP): Pacific" when it is the ZIP's, and "Default:
 * Pacific" when it is neither — the one the account started with.
 */
export function zoneLine(zone: string | null, byHand: boolean, zip: string | null): string | null {
  const label = zoneText(zone);
  if (!label) return null;
  const how = byHand ? "Manual" : zone === timeZoneForZip(zip) ? "Auto (ZIP)" : "Default";
  return `${how}: ${label}`;
}

/** "Visalia, CA 93291" — the home region as everybody else sees it. */
export function homeRegion(parts: {
  city: string | null;
  state: string | null;
  zip: string | null;
}): string | null {
  const place = [parts.city, [parts.state, parts.zip].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  return place || null;
}

export function streetText(line1: string | null, line2: string | null): string | null {
  return [line1, line2].filter(Boolean).join(", ") || null;
}

/** Why somebody with no picture puts one up — asked with the picture. */
export const PICTURE_REASONS = ["Pre-hire", "Hire", "Original pic unavailable"] as const;

export function isPictureReason(value: unknown): value is (typeof PICTURE_REASONS)[number] {
  return typeof value === "string" && (PICTURE_REASONS as readonly string[]).includes(value);
}
