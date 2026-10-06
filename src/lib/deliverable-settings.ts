import { z } from "zod";
import { MAX_MIN_PHOTOS, MAX_RULE_NOTE } from "@/lib/deliverables";

/**
 * The three settings a section gained alongside on/off and required: how many
 * photos it needs, whether that is at each location, and a note for the crew.
 *
 * Shared by the project sheet, the job sheet and the new-job form, which each
 * parse a section their own way but must refuse the same things.
 */

/**
 * A custom section's name. It is what tells two custom sections apart, what
 * photos are filed under, and a folder in the export — so no longer than an
 * upload accepts, and with a letter or a number in it: a name of dots alone
 * would be no folder at all, and ".." one that climbs out of the archive.
 */
export const customLabelField = z.preprocess(
  (value) =>
    typeof value === "string" ? value.replace(/\s+/g, " ").trim() || null : null,
  z
    .string()
    .max(80, "Keep the section's name to 80 characters.")
    .regex(/[\p{L}\p{N}]/u, "Give the section a name with a letter or a number in it.")
    .nullable(),
);

/** Absent from an older form means what it meant before: one is enough. */
export const minPhotosField = z.preprocess(
  (value) =>
    value === undefined || value === null || value === "" ? 1 : Number(value),
  z
    .number("Photos needed has to be a number.")
    .int("Photos needed has to be a whole number.")
    .min(1, "A section needs at least one photo.")
    .max(MAX_MIN_PHOTOS, `A section can ask for ${MAX_MIN_PHOTOS} photos at most.`),
);

/**
 * One line, as written. Line breaks are flattened rather than refused: the
 * note is shown on one line under the section's name, and a pasted sentence
 * with a newline in it is still the sentence somebody meant.
 */
export const ruleNoteField = z.preprocess(
  (value) =>
    typeof value === "string"
      ? value.replace(/\s*[\r\n]+\s*/g, " ").trim() || null
      : null,
  z
    .string()
    .max(MAX_RULE_NOTE, `Keep the note to ${MAX_RULE_NOTE} characters.`)
    .nullable(),
);
