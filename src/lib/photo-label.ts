/**
 * A label somebody writes on one photo — "Damaged port", "Old switch" — when
 * it needs telling apart from the rest.
 *
 * It is drawn on the photo as a line above the stamp, so it is short: one
 * line that fits across a phone photo without shrinking to nothing. And it
 * becomes the photo's file name in the export, so it needs a letter or a
 * number in it — a name of dots alone is no name at all.
 */

export const MAX_PHOTO_LABEL = 40;

/** The label as it is kept, null for none, or why it cannot be. */
export function readPhotoLabel(
  raw: unknown,
): { label: string | null } | { error: string } {
  if (raw === null || raw === undefined) return { label: null };
  if (typeof raw !== "string") return { error: "The label has to be text." };
  const label = raw.replace(/\s+/g, " ").trim();
  if (!label) return { label: null };
  if (label.length > MAX_PHOTO_LABEL) {
    return { error: `Keep the label to ${MAX_PHOTO_LABEL} characters.` };
  }
  if (!/[\p{L}\p{N}]/u.test(label)) {
    return { error: "Give the label a letter or a number." };
  }
  return { label };
}

/**
 * The labels already used on a job, offered for its next photo: each once,
 * however it was capitalised, in the order a list is read.
 */
export function jobLabels(labels: (string | null)[]): string[] {
  const seen = new Map<string, string>();
  for (const label of labels) {
    if (label && !seen.has(label.toLowerCase())) seen.set(label.toLowerCase(), label);
  }
  return [...seen.values()].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }),
  );
}

/** The name a labelled photo downloads as: its label, and what it is. */
export function labelledFileName(label: string | null, original: string, extension: string): string {
  return label ? `${label}.${extension}` : original;
}
