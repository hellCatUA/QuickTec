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
};

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
 * at each location when it is photographed per location. One that only takes
 * text needs some text. A per-location section on a job with no locations yet
 * is counted as a whole, so it never demands photos of places nobody named.
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

    const byLocation = rule.perLocation && locations.length > 0;
    const known = new Set(locations.map((location) => location.id));

    const perLocation: LocationProgress[] | null = byLocation
      ? locations.map((location) => {
          const here = mine
            .filter((item) => item.locationId === location.id)
            .reduce((sum, item) => sum + item.fileCount, 0);
          const needed = rule.required && rule.requiresPhoto ? need : 0;
          return {
            id: location.id,
            name: location.name,
            icon: location.icon ?? null,
            files: here,
            needed,
            short: Math.max(0, needed - here),
          };
        })
      : null;

    const unfiled = byLocation
      ? mine
          .filter((item) => !item.locationId || !known.has(item.locationId))
          .reduce((sum, item) => sum + item.fileCount, 0)
      : 0;

    const base = {
      key: ruleKey(rule),
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

    if (perLocation) {
      const short = perLocation.filter((location) => location.short > 0);
      const needed = need * perLocation.length;
      if (short.length === 0) {
        return { ...base, state: "done" as const, needed, gap: null };
      }

      const allEmpty = short.length === perLocation.length &&
        short.every((location) => location.files === 0);
      const gap = allEmpty && perLocation.length > 1
        ? perLocation.length === 2
          ? `${label} at both locations`
          : `${label} at all ${perLocation.length} locations`
        : `${label} at ${short
            .map((location) =>
              need > 1 || location.files > 0
                ? `${location.name} (${location.files} of ${need})`
                : location.name,
            )
            .join(", ")}`;

      return {
        ...base,
        state: files > 0 ? ("incomplete" as const) : ("required" as const),
        needed,
        gap,
      };
    }

    if (files >= need) {
      return { ...base, state: "done" as const, needed: need, gap: null };
    }
    return {
      ...base,
      state: files > 0 ? ("incomplete" as const) : ("required" as const),
      needed: need,
      gap: need > 1 || files > 0 ? `${label} (${files} of ${need})` : label,
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
  if (field.files === 0 && field.needed !== null) {
    return `0 of ${field.needed}`;
  }
  if (field.files === 0) return "";
  return plural(field.files, field.rule.requiresPhoto ? "photo" : "file");
}
