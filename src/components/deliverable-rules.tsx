"use client";

import { Loader2, Plus, X } from "lucide-react";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { DELIVERABLE_META, ruleKey } from "@/lib/deliverables";
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
  canRequire = true,
}: {
  /** Which column the row hangs off, and the id to put in it. Saved rows only. */
  owner?: { field: "projectId" | "jobId"; id: string };
  rules: EditableRule[];
  save?: (formData: FormData) => Promise<SaveResult>;
  /** Told about every change, for a caller holding the list itself. */
  onChange?: (rules: EditableRule[]) => void;
  canEdit?: boolean;
  /**
   * Whether a section may be demanded, or switched back off.
   *
   * Turning one on is adding somewhere to put what is in front of you, and
   * anyone on the job can want that. Making it mandatory, or removing one that
   * was planned, decides what checkout will refuse — a different act.
   */
  canRequire?: boolean;
}) {
  const [saving, setSaving] = React.useState<string | null>(null);
  const [naming, setNaming] = React.useState(false);
  const [newName, setNewName] = React.useState("");
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

  /**
   * Rows are addressed by key rather than by category: a job may hold several
   * custom sections and "CUSTOM" no longer names one of them.
   */
  function write(rule: EditableRule, applied: EditableRule[], remove = false) {
    const key = ruleKey(rule);
    apply(applied);
    setError(null);

    if (!save || !owner) return;
    setSaving(key);

    startTransition(async () => {
      const formData = new FormData();
      formData.set(owner.field, owner.id);
      formData.set("category", rule.category);
      formData.set("customLabel", rule.customLabel ?? "");
      formData.set("enabled", String(rule.enabled));
      formData.set("required", String(rule.required));
      formData.set("requiresPhoto", String(rule.requiresPhoto));
      formData.set("requiresText", String(rule.requiresText));
      if (remove) formData.set("remove", "true");

      const result = await save(formData);
      setSaving(null);

      if (!result.ok) {
        setError(result.error);
        apply(shown);
      }
    });
  }

  function update(key: string, patch: Partial<EditableRule>) {
    const current = shown.find((rule) => ruleKey(rule) === key);
    if (!current) return;

    const next = { ...current, ...patch };
    // Turning a section off also drops its mandatory flag, so it can never sit
    // as "required but hidden" and block checkout on something invisible.
    if (!next.enabled) next.required = false;

    write(
      next,
      shown.map((rule) => (ruleKey(rule) === key ? next : rule)),
    );
  }

  /**
   * A new custom section.
   *
   * Named when it is made and not renamed afterwards: the name is what tells
   * one from another and what the photos already filed under it are matched
   * on, so changing it would orphan them. Somebody who picked the wrong name
   * removes it and adds another, which costs nothing before anything is in it.
   */
  function addCustom() {
    const label = newName.trim();
    if (!label) return;

    if (shown.some((rule) => rule.category === "CUSTOM" && rule.customLabel === label)) {
      setError("There is already a section called that.");
      return;
    }

    const rule: EditableRule = {
      category: "CUSTOM",
      customLabel: label,
      enabled: true,
      required: false,
      requiresPhoto: true,
      requiresText: false,
    };
    setNewName("");
    setNaming(false);
    write(rule, [...shown, rule]);
  }

  function removeCustom(rule: EditableRule) {
    write(
      rule,
      shown.filter((item) => ruleKey(item) !== ruleKey(rule)),
      true,
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {error ? <p className="text-sm text-danger">{error}</p> : null}

      {shown.map((rule) => {
        const meta = DELIVERABLE_META[rule.category];
        const key = ruleKey(rule);
        const custom = rule.category === "CUSTOM";
        return (
          <div
            key={key}
            data-section={key}
            className="flex flex-col gap-2 rounded-lg border border-border p-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={rule.enabled}
                  disabled={!canEdit || (rule.enabled && !canRequire)}
                  onChange={(event) =>
                    update(key, { enabled: event.target.checked })
                  }
                  className="size-5 accent-[var(--color-primary)]"
                />
                {custom ? rule.customLabel : meta.label}
              </label>

              {rule.enabled && rule.required ? (
                <Badge variant="warning">Required</Badge>
              ) : null}

              {saving === key ? (
                <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
              ) : null}

              {custom && canEdit && canRequire ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="ml-auto"
                  aria-label={`Remove ${rule.customLabel}`}
                  onClick={() => removeCustom(rule)}
                >
                  <X />
                </Button>
              ) : null}
            </div>

            {custom ? null : (
              <p className="text-xs text-muted-foreground">{meta.description}</p>
            )}

            {rule.enabled ? (
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs">
                  <label
                    className="flex items-center gap-1.5"
                    hidden={!canRequire}
                  >
                    <input
                      type="checkbox"
                      checked={rule.required}
                      disabled={!canEdit}
                      onChange={(event) =>
                        update(key, { required: event.target.checked })
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
                        update(key, {
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
                        update(key, {
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

      {/* One job often wants several: somewhere for the rack elevation and
          somewhere else for the cable route. There used to be room for one,
          and the second name overwrote the first. */}
      {canEdit ? (
        naming ? (
          <div className="flex items-end gap-2">
            <Input
              value={newName}
              autoFocus
              aria-label="Name of the new section"
              placeholder="Rack elevation"
              onChange={(event) => setNewName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addCustom();
                }
              }}
            />
            <Button
              type="button"
              size="sm"
              disabled={newName.trim() === ""}
              onClick={addCustom}
            >
              Add
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setNaming(false);
                setNewName("");
              }}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="self-start"
            onClick={() => setNaming(true)}
          >
            <Plus />
            Another section
          </Button>
        )
      ) : null}
    </div>
  );
}
