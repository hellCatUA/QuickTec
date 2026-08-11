import { z } from "zod";

/**
 * Shared coercion for everything arriving from a form.
 *
 * Two traps live here, and both of them presented as "I pressed the button and
 * nothing happened".
 *
 * A browser leaves a field out of the submission entirely when it is unchecked,
 * disabled, or simply not rendered — a Lead radio that only appears once
 * somebody is assigned, a checkbox nobody ticked. `z.string()` then receives
 * `undefined` and rejects the whole submission, naming a field the person never
 * saw.
 *
 * And `z.coerce.boolean()` is `Boolean(input)`, so the string "false" — which is
 * what `String(false)` puts in a FormData — arrives as **true**. Switching
 * something off silently switched it back on.
 */

/**
 * Text that may be absent, blank, or padded. Always ends up string | null.
 *
 * The `.optional()` is load-bearing and not decoration: without it zod rejects
 * a key that is missing from the object entirely — "expected nonoptional" —
 * before the transform ever runs, which is the whole case this exists for.
 */
export const optionalText = z
  .unknown()
  .optional()
  .transform((value): string | null => {
    if (value === undefined || value === null) return null;
    // A browser normalises every line break in a form value to CRLF on the way
    // out, so anything multi-line arrives with carriage returns nobody typed
    // and nothing here wants. They survive into the database, and then into a
    // comparison that looks like it should hold and does not.
    const trimmed = String(value).replace(/\r\n?/g, "\n").trim();
    return trimmed === "" ? null : trimmed;
  });

/** Text that has to be there. Missing and blank fail the same way. */
export function requiredText(message: string) {
  return optionalText.refine((value): value is string => value !== null, {
    message,
  });
}

/** A money amount, or nothing. Rejects negatives and anything unparseable. */
export const optionalMoney = optionalText.refine(
  (value) =>
    value === null || (!Number.isNaN(Number(value)) && Number(value) >= 0),
  { message: "Enter a positive amount, or leave it blank" },
);

/** A whole number in a range, or nothing. */
export function optionalInt(options: { min?: number; max?: number } = {}) {
  const { min = 0, max = Number.MAX_SAFE_INTEGER } = options;
  return optionalText
    .transform((value) => (value === null ? null : Number(value)))
    .refine(
      (value) =>
        value === null ||
        (Number.isInteger(value) && value >= min && value <= max),
      { message: `Enter a whole number between ${min} and ${max}` },
    );
}

const TRUE_VALUES = new Set(["on", "true", "1", "yes", "y"]);

/**
 * A checkbox or an explicit boolean string.
 *
 * Absent is false — that is how a browser reports an unticked box — and the
 * literal "false" is false, which `z.coerce.boolean()` gets wrong.
 */
export const flag = z
  .unknown()
  .optional()
  .transform((value): boolean => {
    if (typeof value === "boolean") return value;
    if (value === undefined || value === null) return false;
    return TRUE_VALUES.has(String(value).trim().toLowerCase());
  });
