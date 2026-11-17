/**
 * What can go wrong with a work order that is worth saying in so many words.
 *
 * Kept apart from wo-draw.ts so the screen can recognise the message without
 * pulling pdf-lib into the page before it is needed.
 */

export const LOCKED_WORK_ORDER =
  "This work order is locked against changes by whoever made it, so nothing can be written on it.";
