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
  customLabel?: string | null;
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

type StoredRule = {
  category: DeliverableCategory;
  customLabel: string | null;
  enabled: boolean;
  required: boolean;
  requiresPhoto: boolean;
  requiresText: boolean;
  order: number;
};

/**
 * The rules actually in force for a job. Job-level rows win outright — a
 * planner who switched a section off meant it, even if the project has it on.
 */
export function resolveDeliverableRules(
  jobRules: StoredRule[],
  projectRules: StoredRule[],
): DeliverableRule[] {
  const source =
    jobRules.length > 0
      ? jobRules
      : projectRules.length > 0
        ? projectRules
        : AD_HOC_DEFAULT_RULES.map((rule) => ({
            ...rule,
            customLabel: null,
          }));

  return source
    .filter((rule) => rule.enabled)
    .sort((a, b) => a.order - b.order)
    .map((rule) => ({
      category: rule.category,
      customLabel: rule.customLabel,
      enabled: rule.enabled,
      required: rule.required,
      requiresPhoto: rule.requiresPhoto,
      requiresText: rule.requiresText,
      order: rule.order,
    }));
}

export function deliverableLabel(
  category: DeliverableCategory,
  customLabel?: string | null,
): string {
  if (category === "CUSTOM" && customLabel) return customLabel;
  return DELIVERABLE_META[category].label;
}
