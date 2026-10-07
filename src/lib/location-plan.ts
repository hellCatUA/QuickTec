import { z } from "zod";
import { locationCounts, locationInField, MAX_MIN_PHOTOS } from "@/lib/deliverables";

/**
 * Where a planned room is photographed, and how much: which of the fields
 * photographed per location it is in, and counts set for it alone.
 *
 * One reading for a job's rooms and a project's, which are copied onto its
 * jobs and must mean the same once they are there.
 *
 * A change says only what changed — the ticks, or one count — so saving a
 * count never rewrites the ticks from what the page last saw, and two counts
 * saved one after the other cannot write over each other.
 */

const fieldKey = z.string().min(1).max(120);

const countSchema = z.object({
  key: fieldKey,
  value: z
    .number("Photos needed has to be a number.")
    .int("Photos needed has to be a whole number.")
    .min(0, "Photos needed cannot be below 0.")
    .max(MAX_MIN_PHOTOS, `A location can ask for ${MAX_MIN_PHOTOS} photos at most.`)
    .nullable(),
});

export type LocationPlanChange = {
  /** The fields it is photographed in, normalised; absent leaves them be. */
  fields?: string[];
  /** One field's count set, or cleared with null; absent leaves them be. */
  count?: { key: string; value: number | null };
};

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
 * a room photographed nowhere is one to take off instead. A count is only
 * for a field photographed per location now.
 */
export function readLocationPlan(
  formData: FormData,
  perLocation: string[],
  name: string,
): { change: LocationPlanChange } | { error: string } {
  const change: LocationPlanChange = {};

  if (formData.has("fields")) {
    const parsed = z.array(fieldKey).max(40).safeParse(json(formData.get("fields")));
    if (!parsed.success) return { error: z.prettifyError(parsed.error) };
    const asked = [...new Set(parsed.data)];
    const fields =
      perLocation.length > 0 && perLocation.every((key) => asked.includes(key))
        ? []
        : asked;
    if (
      fields.length > 0 &&
      perLocation.length > 0 &&
      !perLocation.some((key) => locationInField({ fields }, key))
    ) {
      return {
        error: `${name} has to be photographed in at least one field. Take it off instead.`,
      };
    }
    change.fields = fields;
  }

  if (formData.has("count")) {
    const parsed = countSchema.safeParse(json(formData.get("count")));
    if (!parsed.success) return { error: z.prettifyError(parsed.error) };
    if (!perLocation.includes(parsed.data.key)) {
      return { error: "That field is not photographed at each location now." };
    }
    change.count = parsed.data;
  }

  return { change };
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

/**
 * A room's plan in a line, for the timeline: "Post Install · 3 in Post
 * Install · found on site".
 */
export function describePlan(
  plan: { fields: string[]; minPhotos: unknown; counted?: boolean },
  fields: { key: string; label: string }[],
): string {
  const label = (key: string) => fields.find((field) => field.key === key)?.label ?? key;
  const counts = Object.entries(locationCounts(plan.minPhotos)).map(
    ([key, value]) => `${value} in ${label(key)}`,
  );
  return [
    plan.fields.length === 0 ? "every field" : plan.fields.map(label).join(", "),
    ...counts,
    plan.counted === false ? "found on site" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}
