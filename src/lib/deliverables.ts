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
  order: number;
};

export const DELIVERABLE_META: Record<
  DeliverableCategory,
  { label: string; description: string; order: number }
> = {
  PRE_INSTALL: {
    label: "Pre-Install",
    description: "Photos of the site before any work is done.",
    order: 0,
  },
  POST_INSTALL: {
    label: "Post Install",
    description: "Photos of the finished work.",
    order: 1,
  },
  SIGN_OFF: {
    label: "Sign Off",
    description:
      "The customer's own paperwork. When required and skipped, closing the job needs a manager override.",
    order: 2,
  },
  ISSUES: {
    label: "Issues",
    description: "Anything that went wrong or was found broken on arrival.",
    order: 3,
  },
  ADDITIONAL_INFO: {
    label: "Add. Info",
    description: "Anything else worth recording.",
    order: 4,
  },
  OLD_SERIALS: {
    label: "Old Serials",
    description: "Serial numbers of the equipment removed.",
    order: 5,
  },
  NEW_SERIALS: {
    label: "New Serials",
    description: "Serial numbers of the equipment installed.",
    order: 6,
  },
  RETURN_LABELS: {
    label: "Return Labels",
    description:
      "Return tracking numbers and a photo of the label. The tracking number flows into “Return track #” on the report.",
    order: 7,
  },
  EQUIPMENT_LEFT_ON_SITE: {
    label: "Equipment Left on Site",
    description: "What was left behind, and where.",
    order: 8,
  },
  CUSTOM: {
    label: "Custom Field",
    description: "A one-off section with a name you choose.",
    order: 9,
  },
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
      order: DELIVERABLE_META.CUSTOM.order,
    }));

  return [...fixed, ...custom];
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
