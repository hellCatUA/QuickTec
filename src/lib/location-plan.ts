import { z } from "zod";
import { locationInField, MAX_MIN_PHOTOS } from "@/lib/deliverables";

/**
 * Where a planned room is photographed, and how much: which of the fields
 * photographed per location it is in, and counts set for it alone.
 *
 * One reading for a job's rooms and a project's, which are copied onto its
 * jobs and must mean the same once they are there.
 */

const fieldKey = z.string().min(1).max(120);

const planSchema = z.object({
  fields: z.array(fieldKey).max(40),
  minPhotos: z.record(
    fieldKey,
    z
      .number("Photos needed has to be a number.")
      .int("Photos needed has to be a whole number.")
      .min(0, "Photos needed cannot be below 0.")
      .max(MAX_MIN_PHOTOS, `A location can ask for ${MAX_MIN_PHOTOS} photos at most.`),
  ),
});

export type LocationPlan = { fields: string[]; minPhotos: Record<string, number> };

function json(value: FormDataEntryValue | null): unknown {
  if (typeof value !== "string") return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

/**
 * What the editor sent, checked against the fields the sheet photographs per
 * location now.
 *
 * Ticked into every one of them is stored as "all", so a field turned on
 * later is photographed there too, as at any room nobody narrowed. A field
 * that is not on the sheet just now is kept where it was asked for: switched
 * back on, it finds its rooms where they were. Ticked into none is refused —
 * a room photographed nowhere is one to take off instead.
 */
export function readLocationPlan(
  formData: FormData,
  perLocation: string[],
  name: string,
): { plan: LocationPlan } | { error: string } {
  const parsed = planSchema.safeParse({
    fields: json(formData.get("fields")),
    minPhotos: json(formData.get("minPhotos")),
  });
  if (!parsed.success) return { error: z.prettifyError(parsed.error) };

  const asked = [...new Set(parsed.data.fields)];
  const fields =
    perLocation.length > 0 && perLocation.every((key) => asked.includes(key)) ? [] : asked;
  if (
    fields.length > 0 &&
    perLocation.length > 0 &&
    !perLocation.some((key) => locationInField({ fields }, key))
  ) {
    return {
      error: `${name} has to be photographed in at least one field. Take it off instead.`,
    };
  }
  return { plan: { fields, minPhotos: parsed.data.minPhotos } };
}

/** The fields a room stops being photographed in, of those photographed per location now. */
export function fieldsDropped(
  before: { fields: string[] },
  after: { fields: string[] },
  perLocation: string[],
): string[] {
  return perLocation.filter(
    (key) => locationInField(before, key) && !locationInField(after, key),
  );
}
