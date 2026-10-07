import type { DeliverableCategory } from "@prisma-client";

/**
 * Deliverable sections and their defaults.
 *
 * Resolution order for a job:
 *   1. rules stored on the job          (set while planning it)
 *   2. rules stored on its project      (the project's defaults)
 *   3. AD_HOC_DEFAULTS                  (a job created from nothing)
 *
 * An ad-hoc job gets Pre-Install and Post Install required and nothing else —
 * a tech dispatched by phone should not be blocked by a checklist nobody set up.
 */

export type DeliverableRule = {
  category: DeliverableCategory;
  enabled: boolean;
  required: boolean;
  requiresPhoto: boolean;
  requiresText: boolean;
  customLabel: string | null;
  /** Photos a required section needs before it is done — at each location when perLocation. */
  minPhotos: number;
  /** Photographed separately at each of the job's locations. */
  perLocation: boolean;
  /** What whoever set the job up wants the crew to know. Shown as written. */
  note: string | null;
  order: number;
};

/** The most a section can demand; more than a phone's worth is a typo. */
export const MAX_MIN_PHOTOS = 20;

/** A note is a line under the section's name, not a briefing. */
export const MAX_RULE_NOTE = 100;

/** A location is a name on a pill, read on a phone. */
export const MAX_LOCATION_NAME = 40;

/**
 * Every column a rule is read with. One list, so a new setting cannot be
 * selected on one page and silently missing — and so defaulted — on another.
 */
export const RULE_SELECT = {
  category: true,
  customLabel: true,
  enabled: true,
  required: true,
  requiresPhoto: true,
  requiresText: true,
  minPhotos: true,
  perLocation: true,
  note: true,
  order: true,
} as const;

export const DELIVERABLE_META: Record<
  DeliverableCategory,
  { label: string; order: number }
> = {
  PRE_INSTALL: { label: "Pre-Install", order: 0 },
  POST_INSTALL: { label: "Post Install", order: 1 },
  SIGN_OFF: { label: "Sign Off", order: 2 },
  ISSUES: { label: "Issues", order: 3 },
  ADDITIONAL_INFO: { label: "Add. Info", order: 4 },
  OLD_SERIALS: { label: "Old Serials", order: 5 },
  NEW_SERIALS: { label: "New Serials", order: 6 },
  RETURN_LABELS: { label: "Return Labels", order: 7 },
  EQUIPMENT_LEFT_ON_SITE: { label: "Equipment Left on Site", order: 8 },
  CUSTOM: { label: "Custom Field", order: 9 },
};

export const DELIVERABLE_ORDER: DeliverableCategory[] = (
  Object.keys(DELIVERABLE_META) as DeliverableCategory[]
).sort((a, b) => DELIVERABLE_META[a].order - DELIVERABLE_META[b].order);

/** Project defaults offered when a new project is created. */
export const PROJECT_DEFAULT_RULES: DeliverableRule[] = DELIVERABLE_ORDER.map(
  (category) => {
    const alwaysOn = category === "PRE_INSTALL" || category === "POST_INSTALL";

    return {
      category,
      customLabel: null,
      enabled: alwaysOn,
      required: alwaysOn,
      requiresPhoto: category !== "OLD_SERIALS" && category !== "NEW_SERIALS",
      // Serials and return labels are typed in; the rest are photographed.
      requiresText:
        category === "OLD_SERIALS" ||
        category === "NEW_SERIALS" ||
        category === "RETURN_LABELS",
      minPhotos: 1,
      perLocation: false,
      note: null,
      order: DELIVERABLE_META[category].order,
    };
  },
);

export const AD_HOC_DEFAULT_RULES: DeliverableRule[] =
  PROJECT_DEFAULT_RULES.filter(
    (rule) => rule.category === "PRE_INSTALL" || rule.category === "POST_INSTALL",
  );

/**
 * A row as it comes back from the database. `order` is ignored when the sheet
 * is built — the running order is the one in DELIVERABLE_META — so a caller
 * that did not select it can still pass its rows straight in.
 */
type StoredRule = {
  category: DeliverableCategory;
  customLabel: string | null;
  enabled: boolean;
  required: boolean;
  requiresPhoto: boolean;
  requiresText: boolean;
  minPhotos: number;
  perLocation: boolean;
  note: string | null;
  order?: number;
};

/**
 * Every section as a row, whether or not it has ever been saved.
 *
 * The editors are checklists of the lot: a category nobody has stored yet still
 * needs a switch to turn on, and it has to arrive carrying the settings it
 * would get if switched on rather than a blank row. Producing the whole sheet
 * is also what makes a job's rules safe to save — see materialiseJobRules.
 */
export function ruleSheet(stored: StoredRule[]): DeliverableRule[] {
  const byCategory = new Map(
    stored.filter((rule) => rule.category !== "CUSTOM").map((rule) => [rule.category, rule]),
  );

  const fixed = DELIVERABLE_ORDER.filter(
    (category) => category !== "CUSTOM",
  ).map((category) => {
    const fallback = PROJECT_DEFAULT_RULES.find(
      (rule) => rule.category === category,
    )!;
    const saved = byCategory.get(category);

    return {
      category,
      customLabel: null,
      // Absent means off. Only what somebody switched on is on.
      enabled: saved?.enabled ?? false,
      required: saved?.required ?? false,
      requiresPhoto: saved?.requiresPhoto ?? fallback.requiresPhoto,
      requiresText: saved?.requiresText ?? fallback.requiresText,
      minPhotos: saved?.minPhotos ?? 1,
      perLocation: saved?.perLocation ?? false,
      note: saved?.note ?? null,
      order: DELIVERABLE_META[category].order,
    };
  });

  /*
   * Custom sections are not one switch but a list. A job needs somewhere to
   * put the rack elevation and somewhere else for the cable route, and there
   * was only ever room for one of them — the sheet held a single CUSTOM row,
   * so the second name overwrote the first.
   *
   * They exist only once somebody has made them, so unlike the nine above
   * there is no row here for one nobody asked for.
   */
  const custom = stored
    .filter((rule) => rule.category === "CUSTOM" && rule.customLabel)
    .sort((a, b) => (a.customLabel ?? "").localeCompare(b.customLabel ?? ""))
    .map((rule) => ({
      category: "CUSTOM" as const,
      customLabel: rule.customLabel,
      enabled: rule.enabled,
      required: rule.required,
      requiresPhoto: rule.requiresPhoto,
      requiresText: rule.requiresText,
      minPhotos: rule.minPhotos,
      perLocation: rule.perLocation,
      note: rule.note,
      order: DELIVERABLE_META.CUSTOM.order,
    }));

  return [...fixed, ...custom];
}

/**
 * Settings that cannot hold together are put right before they are stored.
 *
 * A section that is off cannot be mandatory — checkout would block on
 * something the tech is never shown. One that takes no photos cannot be
 * photographed per location.
 */
export function normaliseRuleSettings<
  T extends {
    enabled: boolean;
    required: boolean;
    requiresPhoto: boolean;
    perLocation: boolean;
    minPhotos: number;
  },
>(rule: T): T {
  return {
    ...rule,
    required: rule.enabled && rule.required,
    perLocation: rule.requiresPhoto && rule.perLocation,
    minPhotos: Math.min(MAX_MIN_PHOTOS, Math.max(1, Math.round(rule.minPhotos))),
  };
}

/**
 * Whether two sheets ask a job for the same things.
 *
 * Only the sections that are on count, and only what decides checkout or
 * what the crew is told: a section that is off asks for nothing, however
 * its switches were left.
 */
export function sameRules(a: StoredRule[], b: StoredRule[]): boolean {
  const signature = (rules: StoredRule[]) =>
    JSON.stringify(
      ruleSheet(rules)
        .filter((rule) => rule.enabled)
        .map((rule) => [
          ruleKey(rule),
          rule.required,
          rule.requiresPhoto,
          rule.requiresText,
          rule.minPhotos,
          rule.perLocation,
          rule.note ?? "",
        ])
        .sort((x, y) => String(x[0]).localeCompare(String(y[0]))),
    );
  return signature(a) === signature(b);
}

/** What identifies a row: the category, or for a custom section its name. */
export function ruleKey(rule: {
  category: DeliverableCategory;
  customLabel?: string | null;
}): string {
  return rule.category === "CUSTOM"
    ? `CUSTOM:${rule.customLabel ?? ""}`
    : rule.category;
}

/**
 * The set a job answers to, sections that are off included.
 *
 * Job-level rows win outright — a planner who switched a section off meant it,
 * even if the project has it on. That is also why the rows are all-or-nothing:
 * saving one job rule has to save the rest with it, or the first toggle would
 * quietly drop everything the project asked for.
 */
export function effectiveRules(
  jobRules: StoredRule[],
  projectRules: StoredRule[],
): DeliverableRule[] {
  const source =
    jobRules.length > 0
      ? jobRules
      : projectRules.length > 0
        ? projectRules
        : AD_HOC_DEFAULT_RULES;

  return ruleSheet(source);
}

/** The sections actually shown on a job and demanded at checkout. */
export function resolveDeliverableRules(
  jobRules: StoredRule[],
  projectRules: StoredRule[],
): DeliverableRule[] {
  return effectiveRules(jobRules, projectRules).filter((rule) => rule.enabled);
}

export function deliverableLabel(
  category: DeliverableCategory,
  customLabel?: string | null,
): string {
  if (category === "CUSTOM" && customLabel) return customLabel;
  return DELIVERABLE_META[category].label;
}

/** Whether an upload was filed under this section. Custom ones go by name. */
export function itemMatchesRule(
  item: { category: DeliverableCategory; customLabel: string | null },
  rule: { category: DeliverableCategory; customLabel: string | null },
): boolean {
  return (
    item.category === rule.category &&
    (rule.category !== "CUSTOM" || item.customLabel === rule.customLabel)
  );
}

export type ProgressItem = {
  category: DeliverableCategory;
  customLabel: string | null;
  locationId: string | null;
  textValue: string | null;
  /** Photos and PDFs alike: a scanned sheet is as much the record as a photo. */
  fileCount: number;
};

export type ProgressLocation = {
  id: string;
  name: string;
  /** Carried through for whoever draws the location. */
  icon?: string | null;
  /** The fields it is photographed in, by key; empty or absent is all of them. */
  fields?: string[];
  /** False for a room added on site, which owes no field its photo count. */
  counted?: boolean;
  /** Counts set for this location alone, by field key — the stored JSON. */
  minPhotos?: unknown;
};

/** What a location stores to say where it is photographed and how much. */
export const LOCATION_PLAN_SELECT = {
  fields: true,
  counted: true,
  minPhotos: true,
} as const;

/** Whether a field photographed per location is photographed at this one. */
export function locationInField(
  location: { fields?: string[] | null },
  key: string,
): boolean {
  return !location.fields || location.fields.length === 0 || location.fields.includes(key);
}

/**
 * A location's own counts, read from what is stored. Anything that is not a
 * whole number in range is ignored rather than trusted: the column is JSON,
 * and a count is what checkout refuses on.
 */
export function locationCounts(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const counts: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (
      typeof value === "number" &&
      Number.isInteger(value) &&
      value >= 0 &&
      value <= MAX_MIN_PHOTOS
    ) {
      counts[key] = value;
    }
  }
  return counts;
}

/**
 * Photos a location owes a required field: its own number when one was set
 * for it, otherwise the field's — or none, for a room added on site.
 */
export function locationNeed(
  location: Pick<ProgressLocation, "counted" | "minPhotos">,
  rule: { category: DeliverableCategory; customLabel?: string | null; minPhotos: number },
): number {
  const own = locationCounts(location.minPhotos)[ruleKey(rule)];
  if (own !== undefined) return own;
  return location.counted === false ? 0 : Math.max(1, rule.minPhotos);
}

/**
 * Which fields a room added from one of them is photographed in.
 *
 * Found during Pre-Install, it is somewhere the work will happen: it gets
 * its "after" as well as its "before", and every other field photographed
 * per location. Found in any later field — the closet the new cable ended up
 * in — there is no "before" to take any more, so it is in that field alone.
 */
export function fieldsForAddedLocation(key: string): string[] {
  return key === "PRE_INSTALL" ? [] : [key];
}

export type LocationProgress = {
  id: string;
  name: string;
  icon: string | null;
  files: number;
  /** What this location still owes a required section; 0 once it has enough. */
  short: number;
  needed: number;
};

export type FieldProgress = {
  key: string;
  label: string;
  rule: DeliverableRule;
  files: number;
  hasText: boolean;
  /**
   * Done, short, untouched, or neither for a section nobody demands.
   *
   * "incomplete" is something in it but not enough; "required" is nothing at
   * all. Kept apart because the second is the one people forget entirely.
   */
  state: "done" | "incomplete" | "required" | "optional";
  /** Total asked for, when photos are counted. */
  needed: number | null;
  /** One entry per job location, for a section photographed at each. */
  locations: LocationProgress[] | null;
  /** Photos in a per-location section that are not filed under any location. */
  unfiled: number;
  /** What is missing, as the banner and checkout say it. Null when nothing is. */
  gap: string | null;
};

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

/**
 * How far each section has got, and what it still needs.
 *
 * One function for the job page, checkout and the review, so the three cannot
 * disagree about whether a job is ready — they used to, because each counted
 * by category alone and two custom sections looked like one.
 *
 * A section that takes photos is counted in photos: as many as it asks for,
 * at each of its locations when it is photographed per location — or as many
 * as a location was given of its own, and none at a room added on site. One
 * that takes text needs some text — both, when it takes both. A per-location
 * section with no locations in it yet, or only rooms the crew found that
 * nobody has given a count, is counted as a whole, so it never demands photos
 * of places nobody named and a required one is not done with none.
 */
export function fieldProgress(
  rules: DeliverableRule[],
  items: ProgressItem[],
  locations: ProgressLocation[],
): FieldProgress[] {
  return rules.map((rule) => {
    const label = deliverableLabel(rule.category, rule.customLabel);
    const mine = items.filter((item) => itemMatchesRule(item, rule));
    const files = mine.reduce((sum, item) => sum + item.fileCount, 0);
    const hasText = mine.some((item) => Boolean(item.textValue?.trim()));
    const need = Math.max(1, rule.minPhotos);

    const key = ruleKey(rule);
    // Only the rooms photographed in this field: one found during
    // Post-Install has no "before" to show.
    const here = rule.perLocation
      ? locations.filter((location) => locationInField(location, key))
      : [];
    const byLocation = here.length > 0;
    const known = new Set(here.map((location) => location.id));

    const perLocation: LocationProgress[] | null = byLocation
      ? here.map((location) => {
          const files = mine
            .filter((item) => item.locationId === location.id)
            .reduce((sum, item) => sum + item.fileCount, 0);
          const needed =
            rule.required && rule.requiresPhoto ? locationNeed(location, rule) : 0;
          return {
            id: location.id,
            name: location.name,
            icon: location.icon ?? null,
            files,
            needed,
            short: Math.max(0, needed - files),
          };
        })
      : null;

    const unfiled = byLocation
      ? mine
          .filter((item) => !item.locationId || !known.has(item.locationId))
          .reduce((sum, item) => sum + item.fileCount, 0)
      : 0;

    const base = {
      key,
      label,
      rule,
      files,
      hasText,
      locations: perLocation,
      unfiled,
    };

    if (!rule.required) {
      return { ...base, state: "optional" as const, needed: null, gap: null };
    }

    if (!rule.requiresPhoto) {
      // Text only: serials, a tracking number. Something typed is the record.
      const done = hasText || files > 0;
      return {
        ...base,
        state: done ? ("done" as const) : ("required" as const),
        needed: null,
        gap: done ? null : label,
      };
    }

    // A field that takes both photos and text — Return Labels: a photo of
    // the label and the tracking number — needs both. The text is the field's,
    // not a location's.
    const textMissing = rule.requiresText && !hasText;
    const textGap = (gap: string | null) =>
      !textMissing ? gap : gap === null ? `${label} (text)` : `${gap} and text`;
    const something = files > 0 || hasText;

    // Counted at the locations that owe it something — none, when whoever
    // planned it set 0 at each planned room. Where no planned room is in it,
    // and none of the rooms the crew found was given a number, it is counted
    // as a whole below: a required field is not done with nothing in it
    // because the crew named the rooms themselves — nor because one of them
    // was told it needs none.
    const counted = perLocation?.filter((location) => location.needed > 0) ?? [];
    const planned = here.some(
      (location) => location.counted !== false || locationNeed(location, rule) > 0,
    );
    if (perLocation && planned) {
      const short = counted.filter((location) => location.short > 0);
      const needed = counted.reduce((sum, location) => sum + location.needed, 0);
      if (short.length === 0) {
        const gap = textGap(null);
        return {
          ...base,
          state: gap === null ? ("done" as const) : ("incomplete" as const),
          needed,
          gap,
        };
      }

      const allEmpty = short.length === counted.length &&
        short.every((location) => location.files === 0);
      // Locations are joined with "·": the gaps themselves are joined with
      // ";" wherever several are listed, and commas would blur the two.
      // "Both" and "all" only when every room in the field is meant, not
      // when a room added on site sits among them owing nothing.
      const gap = allEmpty && counted.length > 1 && counted.length === perLocation.length
        ? counted.length === 2
          ? `${label} at both locations`
          : `${label} at all ${counted.length} locations`
        : `${label} at ${short
            .map((location) =>
              location.needed > 1 || location.files > 0
                ? `${location.name} (${location.files} of ${location.needed})`
                : location.name,
            )
            .join(" · ")}`;

      return {
        ...base,
        state: something ? ("incomplete" as const) : ("required" as const),
        needed,
        gap: textGap(gap),
      };
    }

    if (files >= need) {
      const gap = textGap(null);
      return {
        ...base,
        state: gap === null ? ("done" as const) : ("incomplete" as const),
        needed: need,
        gap,
      };
    }
    return {
      ...base,
      state: something ? ("incomplete" as const) : ("required" as const),
      needed: need,
      gap: textGap(need > 1 || files > 0 ? `${label} (${files} of ${need})` : label),
    };
  });
}

/** The sections checkout is still waiting on, each said the way the banner says it. */
export function missingDeliverables(progress: FieldProgress[]): string[] {
  return progress
    .map((field) => field.gap)
    .filter((gap): gap is string => gap !== null);
}

/** "6 photos", "1 file", "0 of 6" — the count at the end of a folded row. */
export function progressCount(field: FieldProgress): string {
  if (field.files === 0 && field.needed) {
    return `0 of ${field.needed}`;
  }
  if (field.files === 0) return "";
  return plural(field.files, field.rule.requiresPhoto ? "photo" : "file");
}
