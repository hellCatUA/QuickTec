import { formatPhone } from "@/lib/phone";
import { stateName, timeZoneLabel } from "@/lib/us-regions";

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
