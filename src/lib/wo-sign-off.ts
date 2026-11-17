import type { WoValues } from "@/lib/forms/wo-draw";
import type { WoFound, WoOverlay } from "@/lib/forms/wo-layout";
import type { JobLifecycle } from "@prisma-client";

/**
 * The paying company's work order, signed as the job's sign-off — the rules
 * the screen, the job page and the server all read.
 *
 * Some paying companies have no sign-off sheet, and a job still has to come
 * back with something the customer signed. Their WorkMarket work order has a
 * place for the times, a note and a signature, so that is what gets signed.
 */

/**
 * Where the work is over: the last person on it has clocked out, or it has
 * gone further than that.
 *
 * Only then. The work order carries the check-out time and the customer's
 * word that the work is done; signed before the day is over it is signed for
 * a time that has not happened yet.
 */
export const WORK_DONE_LIFECYCLES: JobLifecycle[] = [
  "PENDING_REVIEW",
  "CHANGES_REQUESTED",
  "APPROVED",
  "REJECTED",
  "BILLED",
  "CLOSED",
];

export function workIsDone(lifecycle: JobLifecycle): boolean {
  return WORK_DONE_LIFECYCLES.includes(lifecycle);
}

export const NOT_CLOSED_YET =
  "Not yet — a work order is signed off once the job is closed, at the last clock-out.";

export const NO_WORK_ORDER =
  "There is no work order on this job to sign. Attach theirs as a PDF under the job's details first.";

/** "2509062645.pdf" → "2509062645-Signed.pdf": theirs, recognisably, and signed. */
export function signedWorkOrderName(originalName: string): string {
  const stem = originalName.replace(/\.pdf$/i, "").trim() || "Work order";
  return `${stem}-Signed.pdf`;
}

/** A work order that can be signed: theirs, as a PDF, not one we made. */
export function signableWorkOrder(document: {
  jobDocumentKind: string | null;
  generated: boolean;
  mimeType: string;
}): boolean {
  return (
    document.jobDocumentKind === "CLIENT_WORK_ORDER" &&
    !document.generated &&
    document.mimeType === "application/pdf"
  );
}

/**
 * A signed work order: one we made from theirs. A filled copy of a work-order
 * blank from the directory is generated too, but carries its template.
 */
export function isSignedWorkOrder(document: {
  jobDocumentKind: string | null;
  generated: boolean;
  sourceTemplateId: string | null;
}): boolean {
  return (
    document.jobDocumentKind === "CLIENT_WORK_ORDER" &&
    document.generated &&
    !document.sourceTemplateId
  );
}

/** What the job page needs to offer it: in the Sign-off block, and after clock-out. */
export type WorkOrderSignOff = {
  /** Whether the work is over, so the work order can be signed now. */
  done: boolean;
  /** Their work order, newest first, as PDFs that can be signed. */
  workOrders: { id: string; name: string }[];
  /** Signed copies already on the job. */
  signed: { id: string; name: string; fromId: string | null }[];
};

/**
 * What to offer once the last clock-out closes the job.
 *
 * The owner's rule: their work order is always offered, even when a sign-off
 * sheet has already been signed; and when the company's own blank is there
 * and still empty, both are — the sheet and the work order.
 */
export type CheckoutPaperwork = {
  workOrder: { id: string; name: string; signed: boolean } | null;
  /** The company's sign-off blank, when it is on the job, fillable and not yet filled. */
  sheet: { templateId: string; name: string } | null;
  /** A sign-off is on the job already: a filled sheet, or one attached signed. */
  signOffOnJob: boolean;
};

export function hasPaperworkToOffer(paperwork: CheckoutPaperwork | null): boolean {
  return Boolean(paperwork && (paperwork.workOrder || paperwork.sheet));
}

/** What the job itself says goes on the work order, before anybody types. */
export type WorkOrderDefaults = {
  checkIn: { time: string; date: string } | null;
  checkOut: { time: string; date: string } | null;
  /** The work performed, as the report has it. */
  notes: string;
  /** Who signed for the customer. */
  name: string;
  /** The day they signed. */
  date: string;
  /** Their signature, when one was captured. */
  signature: { attachmentId: string } | null;
};

/**
 * The job's values for the layout found.
 *
 * On blank lines the time is written as somebody would write it, "9:05 AM",
 * the line already being headed "ARRIVAL TIME". Where WorkMarket printed its
 * own check-in, ours replaces a date and a time, so it carries both — the
 * date being the half WorkMarket most often had wrong.
 */
export function defaultValues(
  defaults: WorkOrderDefaults,
  times: WoFound["times"],
): WoValues {
  // A job over two days needs its dates on the blank lines too: "9:05 AM" to
  // "1:40 PM" reads as one morning when it was the next day's afternoon.
  const overDays =
    defaults.checkIn !== null &&
    defaults.checkOut !== null &&
    defaults.checkIn.date !== defaults.checkOut.date;
  const dated = times === "printed" || overDays;
  const when = (moment: { time: string; date: string } | null) =>
    moment ? (dated ? `${moment.date} ${moment.time}` : moment.time) : "";
  return {
    checkIn: when(defaults.checkIn),
    checkOut: when(defaults.checkOut),
    notes: defaults.notes,
    name: defaults.name,
    date: defaults.date,
  };
}

/** What is kept on a signed copy, so signing it again starts from there. */
export type SavedSignOff = {
  overlay: WoOverlay;
  values: WoValues;
  /** The values somebody typed over; the rest follow the job when reopened. */
  typed: Partial<Record<keyof WoValues, boolean>>;
  found: WoFound;
};
