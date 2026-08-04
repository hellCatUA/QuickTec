/**
 * One box of a company's sheet as both sides see it.
 *
 * Deliberately free of imports. The review screen runs in the browser and the
 * filler runs on the server, and they have to agree exactly on what is in a
 * box — but anything that reaches for the database here ends up in the browser
 * bundle, which is a build error at best and `pg` shipped to a phone at worst.
 */

export type DraftBox = {
  placementId: string;
  /** The blank's own name for it, where it had one. */
  fieldName: string | null;
  /** What the blank was carrying there, which usually says what it is for. */
  sampleText: string | null;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  kind: "TEXT" | "CHECK" | "SIGNATURE";
  /** The catalogue entry this box is bound to, if any. */
  source: string | null;
  sourceLabel: string | null;
  /** What that entry resolves to for this job. Null when it has nothing. */
  resolved: string | null;
  /** Whether the resolved value is an image rather than text. */
  isImage: boolean;
  /**
   * For an image box, whether the picture is actually there yet. Kept apart
   * from `resolved`, which only ever holds text — reading a missing signature
   * off a null `resolved` is how the screen came to say "once it is captured
   * on site" about one that had been.
   */
  hasImage: boolean;
  /** What somebody typed. Null when they have not touched it. */
  entered: string | null;
  /** Ticked off against the value it holds now. */
  approved: boolean;
  /** Which row of a repeating source this box wants. */
  rowIndex: number | null;
};

/**
 * What is in a box right now, as one string.
 *
 * An approval is of a value, not of a box: the job underneath keeps moving
 * while a sheet is being checked — a tech clocks out, a signature arrives,
 * somebody fixes the address — and a tick that survived the text changing
 * would be somebody vouching for words they never read. This is what gets
 * stored when a box is ticked off and compared against when it is loaded.
 */
export function boxFingerprint(
  box: Pick<DraftBox, "isImage" | "hasImage" | "entered" | "resolved">,
): string {
  if (box.isImage) return box.hasImage ? "image:present" : "image:none";
  if (box.entered !== null) return box.entered.trim();
  return box.resolved ?? "";
}
