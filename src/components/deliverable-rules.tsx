"use client";

import { Loader2 } from "lucide-react";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/field";
import { DELIVERABLE_META } from "@/lib/deliverables";
import type { DeliverableCategory } from "@prisma-client";

/**
 * The checklist of deliverable sections. One list, three places: a project's
 * settings, a job that already exists, and the form that raises one.
 *
 * On a project or a job the row is saved the moment it is changed and rolled
 * back if the server refuses — a settings screen with a Save button collects a
 * page of edits and loses the lot on one failure. On the new-job form there is
 * nothing to save to yet, so the caller is handed the list instead and submits
 * it with the rest.
 */

export type EditableRule = {
  category: DeliverableCategory;
  customLabel: string | null;
  enabled: boolean;
  required: boolean;
  requiresPhoto: boolean;
  requiresText: boolean;
};

type SaveResult = { ok: true } | { ok: false; error: string };

export function DeliverableRules({
  owner,
  rules,
  save,
  onChange,
  canEdit = true,
}: {
  /** Which column the row hangs off, and the id to put in it. Saved rows only. */
  owner?: { field: "projectId" | "jobId"; id: string };
  rules: EditableRule[];
  save?: (formData: FormData) => Promise<SaveResult>;
  /** Told about every change, for a caller holding the list itself. */
  onChange?: (rules: EditableRule[]) => void;
  canEdit?: boolean;
}) {
  const [saving, setSaving] = React.useState<DeliverableCategory | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [override, setOverride] = React.useState<EditableRule[] | null>(null);
  const [, startTransition] = React.useTransition();

  // The saved-row callers hand over what is stored and let this hold the edits;
  // the form caller keeps the list and passes it back down.
  const shown = override ?? rules;

  function apply(next: EditableRule[]) {
    if (onChange) onChange(next);
    else setOverride(next);
  }

  function update(category: DeliverableCategory, patch: Partial<EditableRule>) {
    const current = shown.find((rule) => rule.category === category);
    if (!current) return;

    const next = { ...current, ...patch };
    // Turning a section off also drops its mandatory flag, so it can never sit
    // as "required but hidden" and block checkout on something invisible.
    if (!next.enabled) next.required = false;

    const applied = shown.map((rule) =>
      rule.category === category ? next : rule,
    );
    apply(applied);
    setError(null);

    if (!save || !owner) return;
    setSaving(category);

    startTransition(async () => {
      const formData = new FormData();
      formData.set(owner.field, owner.id);
      formData.set("category", category);
      formData.set("customLabel", next.customLabel ?? "");
      formData.set("enabled", String(next.enabled));
      formData.set("required", String(next.required));
      formData.set("requiresPhoto", String(next.requiresPhoto));
      formData.set("requiresText", String(next.requiresText));

      const result = await save(formData);
      setSaving(null);

      if (!result.ok) {
        setError(result.error);
        apply(applied.map((rule) => (rule.category === category ? current : rule)));
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {error ? <p className="text-sm text-danger">{error}</p> : null}

      {shown.map((rule) => {
        const meta = DELIVERABLE_META[rule.category];
        return (
          <div
            key={rule.category}
            data-section={rule.category}
            className="flex flex-col gap-2 rounded-lg border border-border p-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={rule.enabled}
                  disabled={!canEdit}
                  onChange={(event) =>
                    update(rule.category, { enabled: event.target.checked })
                  }
                  className="size-5 accent-[var(--color-primary)]"
                />
                {meta.label}
              </label>

              {rule.enabled && rule.required ? (
                <Badge variant="warning">Required</Badge>
              ) : null}

              {saving === rule.category ? (
                <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
              ) : null}
            </div>

            <p className="text-xs text-muted-foreground">{meta.description}</p>

            {rule.enabled ? (
              <div className="flex flex-col gap-2">
                {rule.category === "CUSTOM" ? (
                  <Input
                    value={rule.customLabel ?? ""}
                    disabled={!canEdit}
                    aria-label="Name of the custom section"
                    placeholder="What to call this section"
                    onChange={(event) =>
                      // Typed locally, written once the field is left: a save
                      // per keystroke would be a request per keystroke.
                      apply(
                        shown.map((item) =>
                          item.category === "CUSTOM"
                            ? { ...item, customLabel: event.target.value }
                            : item,
                        ),
                      )
                    }
                    onBlur={(event) =>
                      update("CUSTOM", { customLabel: event.target.value })
                    }
                  />
                ) : null}

                <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs">
                  <label className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={rule.required}
                      disabled={!canEdit}
                      onChange={(event) =>
                        update(rule.category, { required: event.target.checked })
                      }
                      className="size-4 accent-[var(--color-primary)]"
                    />
                    Required
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={rule.requiresPhoto}
                      disabled={!canEdit}
                      onChange={(event) =>
                        update(rule.category, {
                          requiresPhoto: event.target.checked,
                        })
                      }
                      className="size-4 accent-[var(--color-primary)]"
                    />
                    Photo
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={rule.requiresText}
                      disabled={!canEdit}
                      onChange={(event) =>
                        update(rule.category, {
                          requiresText: event.target.checked,
                        })
                      }
                      className="size-4 accent-[var(--color-primary)]"
                    />
                    Text entry
                  </label>
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
