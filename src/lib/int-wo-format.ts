import { pad } from "@/lib/datetime";

/**
 * How an internal work order number is written.
 *
 *   YYMM-PRJID-NNNN            2607-PRJ12-0042
 *   YYMM-PRJID-NNNN-R<n>       2608-PRJ12-0042-R1
 *
 * - YYMM is the last two digits of the year and the month, run together: the
 *   number is read off a phone screen and written onto paper forms, and the
 *   century has never been the part anybody needed.
 * - PRJID is our own project ID (Project.code), or 0000 when the job has no
 *   project. Jobs numbered before it existed carry the paying company's ID
 *   there instead, and their revisits keep whatever their number says.
 * - A revisit keeps its parent's sequence and project, and takes the month it
 *   actually happens in — so August's revisit of a July job reads 2608-…-R1.
 *
 * Its own module, with nothing in it but the shape, because the new-job form
 * shows the number before it is allocated and needs this in the browser.
 * int-wo.ts cannot go there: it reaches for the database on its first line,
 * and the last time a client component imported a file like that the whole
 * page went white. Duplicating the format instead is how the form ended up
 * quietly promising the old one long after the server had stopped issuing it.
 */

export const NO_PROJECT_REF = "0000";
const SEQUENCE_WIDTH = 4;

export type IntWoParts = {
  year: number;
  month: number;
  projectRef: string;
  sequence: number;
  revisitNumber?: number | null;
};

export function formatIntWo(parts: IntWoParts): string {
  const base = [
    // Two digits of year and two of month, as one segment.
    `${pad(parts.year % 100)}${pad(parts.month)}`,
    parts.projectRef || NO_PROJECT_REF,
    pad(parts.sequence, SEQUENCE_WIDTH),
  ].join("-");

  return parts.revisitNumber ? `${base}-R${parts.revisitNumber}` : base;
}

/**
 * The project part of a number already issued: "PRJ12" from 2607-PRJ12-0042-R1.
 *
 * A revisit is numbered off its original, and the original may predate the
 * project's current ID — so the reference comes from the number itself, not
 * from the project as it stands. Null when the number is not in this shape.
 */
export function projectRefOf(intWoId: string): string | null {
  const match = /^\d{4}-(.+)-\d{4,}(?:-R\d+)?$/.exec(intWoId);
  return match ? match[1] : null;
}
