/**
 * What a revisit can start from.
 *
 * The site, the customer, the representing company, the project and the
 * internal number chain are deliberately not in here: they are what makes a
 * revisit a revisit rather than a new job, and there is nothing to decide
 * about them.
 *
 * Its own module because both the server action and the form need it, and a
 * "use server" file may only export async functions.
 */
export const REVISIT_CARRIES = [
  "scope",
  "deliverables",
  "tickets",
  "estimate",
  "pay",
  "dispatch",
  "signOff",
] as const;

export type RevisitCarry = (typeof REVISIT_CARRIES)[number];
