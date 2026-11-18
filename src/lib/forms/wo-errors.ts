/**
 * What can go wrong with a work order that is worth saying in so many words.
 *
 * Kept apart from wo-draw.ts so the screen can recognise the message without
 * pulling pdf-lib into the page before it is needed.
 */

export const LOCKED_WORK_ORDER =
  "This work order is locked against changes by whoever made it, so nothing can be written on it.";

/** Shown by every reader, but pdf-lib cannot open it to write on. */
export const DAMAGED_WORK_ORDER =
  "This work order's file is damaged in a way that stops anything being written on it. Open it, save or print it as a new PDF, and attach that one instead.";

/**
 * The file reads as one number of pages to show and another to write on, so a
 * box placed on one page could be written onto another.
 */
export function pagesDisagree(shown: number, writable: number): string {
  return `This work order's file is damaged: it shows ${shown} page${shown === 1 ? "" : "s"} here, but ${writable} can be written on, so the sign-off could land on the wrong page. Open it, save or print it as a new PDF, and attach that one instead.`;
}
