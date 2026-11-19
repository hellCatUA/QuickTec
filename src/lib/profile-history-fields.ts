/**
 * The lines a profile's history is kept for, and what each is called.
 *
 * Apart from the history itself, which reads the database, so the screens can
 * name a line's history button by the line: two rows both labelled "Work" —
 * the work phone and the work email — gave two buttons both called "History
 * of work".
 */

/** The lines a history is kept for. Street and Home region are one line each, as on the page. */
export const HISTORY_FIELDS = {
  picture: "Profile picture",
  name: "Preferred name",
  legalName: "Legal name",
  role: "Role",
  directSupervisor: "Direct supervisor",
  yearsOfService: "Years of service",
  preferredPhone: "Preferred phone",
  personalPhone: "Personal phone",
  workPhone: "Work phone",
  voipPhone: "VoIP",
  email: "Work email",
  street: "Street address",
  homeRegion: "Home region",
  timeZone: "Time zone",
  primaryRegion: "Primary region",
  statesOfOperation: "States of operation",
  defaultPayRate: "Default pay rate",
} as const;

export type HistoryField = keyof typeof HISTORY_FIELDS;

export function isHistoryField(value: unknown): value is HistoryField {
  return typeof value === "string" && value in HISTORY_FIELDS;
}
