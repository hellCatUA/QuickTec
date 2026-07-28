"use client";

import { Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { DELIVERABLE_META } from "@/lib/deliverables";
import type { DeliverableCategory } from "@prisma-client";
import { saveDeliverableRule } from "../actions";

type Rule = {
  category: DeliverableCategory;
  customLabel: string | null;
  enabled: boolean;
  required: boolean;
  requiresPhoto: boolean;
  requiresText: boolean;
};

export function DeliverableRules({
  projectId,
  rules: initial,
}: {
  projectId: string;
  rules: Rule[];
}) {
  const [rules, setRules] = useState(initial);
  const [saving, setSaving] = useState<DeliverableCategory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function update(category: DeliverableCategory, patch: Partial<Rule>) {
    const current = rules.find((rule) => rule.category === category);
    if (!current) return;

    const next = { ...current, ...patch };
    // Turning a section off also drops its mandatory flag, so it can never sit
    // as "required but hidden" and block checkout on something invisible.
    if (!next.enabled) next.required = false;

    setRules((all) =>
      all.map((rule) => (rule.category === category ? next : rule)),
    );
    setError(null);
    setSaving(category);

    startTransition(async () => {
      const formData = new FormData();
      formData.set("projectId", projectId);
      formData.set("category", category);
      formData.set("customLabel", next.customLabel ?? "");
      formData.set("enabled", String(next.enabled));
      formData.set("required", String(next.required));
      formData.set("requiresPhoto", String(next.requiresPhoto));
      formData.set("requiresText", String(next.requiresText));

      const result = await saveDeliverableRule(formData);
      setSaving(null);

      if (!result.ok) {
        setError(result.error);
        setRules((all) =>
          all.map((rule) => (rule.category === category ? current : rule)),
        );
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {error ? <p className="text-sm text-danger">{error}</p> : null}

      {rules.map((rule) => {
        const meta = DELIVERABLE_META[rule.category];
        return (
          <div
            key={rule.category}
            className="flex flex-col gap-2 rounded-lg border border-border p-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={rule.enabled}
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
              <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs">
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={rule.required}
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
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
