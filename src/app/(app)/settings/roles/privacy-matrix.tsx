"use client";

import type { PrivacyLevel } from "@prisma-client";
import { AlertCircle, Loader2, RotateCcw } from "lucide-react";
import * as React from "react";
import { LevelBadge, LevelsLegend } from "@/components/profile/parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  differsFromDefault,
  fieldDefinition,
  LEVEL_INFO,
  PRIVACY_LEVELS,
  PROFILE_FIELD_KEYS,
  PROFILE_GROUPS,
  type PrivacySettings,
  type ProfileField,
} from "@/lib/profile-privacy";
import { restorePrivacyDefaults, setFieldPrivacy } from "./privacy-actions";

/**
 * Who may see each profile field, company-wide.
 *
 * Same shape as the permission matrix beside it: a choice applies as it is
 * made, and a rejection puts it back. Each row says what its optimized
 * default is, and the button at the top forgets every difference at once.
 */
export function PrivacyMatrix({ initial }: { initial: PrivacySettings }) {
  const [values, setValues] = React.useState(initial);
  const [saving, setSaving] = React.useState<ProfileField | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [confirming, setConfirming] = React.useState(false);
  const [restoring, startRestore] = React.useTransition();

  const changed = PROFILE_FIELD_KEYS.filter((field) => differsFromDefault(field, values[field]));

  async function change(field: ProfileField, next: { level: PrivacyLevel; allowPublic: boolean }) {
    const previous = values[field];
    setError(null);
    setSaving(field);
    setValues((current) => ({ ...current, [field]: next }));
    const result = await setFieldPrivacy({ field, ...next });
    setSaving(null);
    if (!result.ok) {
      setError(result.error);
      setValues((current) => ({ ...current, [field]: previous }));
    }
  }

  function restore() {
    startRestore(async () => {
      const result = await restorePrivacyDefaults();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setConfirming(false);
      setValues(() => {
        const defaults = {} as PrivacySettings;
        for (const field of PROFILE_FIELD_KEYS) {
          const definition = fieldDefinition(field);
          defaults[field] = {
            level: definition.level,
            allowPublic: definition.allowPublic?.default ?? false,
          };
        }
        return defaults;
      });
    });
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Who sees each line of somebody&rsquo;s profile. People see the level of their own lines but
        cannot change it — except their picture, where they pick between the levels allowed here.
        Every change here is kept in the audit trail.
      </p>
      <LevelsLegend className="grid gap-3 sm:grid-cols-3" />

      <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-3">
        <div className="flex flex-wrap items-center gap-3">
          {changed.length === 0 ? (
            <span className="text-sm text-muted-foreground">
              Every field is on its optimized default.
            </span>
          ) : (
            <>
              <Badge variant="warning">
                {changed.length} change{changed.length === 1 ? "" : "s"}
              </Badge>
              <span className="text-sm">
                {changed.length === 1 ? "One field differs" : `${changed.length} fields differ`} from
                the optimized defaults.
              </span>
            </>
          )}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="ml-auto"
            disabled={changed.length === 0 || restoring}
            aria-expanded={confirming}
            onClick={() => setConfirming(true)}
          >
            <RotateCcw /> Restore optimized defaults
          </Button>
        </div>

        {confirming && changed.length > 0 ? (
          <div
            role="alertdialog"
            aria-labelledby="restore-title"
            className="flex flex-col gap-2 rounded-lg border border-border bg-surface-raised p-3"
          >
            <div id="restore-title" className="text-sm font-semibold">
              Put every field back to the optimized defaults?
            </div>
            <ul className="text-sm text-muted-foreground">
              {changed.map((field) => (
                <li key={field}>
                  <b className="text-foreground">{fieldDefinition(field).label}</b> —{" "}
                  {LEVEL_INFO[values[field].level].label} → {LEVEL_INFO[fieldDefinition(field).level].label}
                </li>
              ))}
            </ul>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" disabled={restoring} onClick={() => setConfirming(false)}>
                Cancel
              </Button>
              <Button type="button" size="sm" disabled={restoring} onClick={restore}>
                {restoring ? <Loader2 className="animate-spin" /> : null}
                Restore
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="flex items-start gap-2 rounded-lg bg-danger/15 p-3 text-sm text-danger ring-1 ring-inset ring-danger/30">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          {error}
        </div>
      ) : null}

      {PROFILE_GROUPS.map((group) => (
        <section key={group}>
          <h2 className="mb-2 text-sm font-semibold">{group}</h2>
          <div className="overflow-x-auto rounded-xl border border-border bg-surface">
            {/* Fixed columns, so the four tables line up under each other. */}
            <table className="w-full min-w-[44rem] table-fixed border-collapse text-sm">
              <colgroup>
                <col className="w-[22%]" />
                <col className="w-[30%]" />
                <col className="w-[20%]" />
                <col />
              </colgroup>
              <thead>
                <tr className="border-b border-border">
                  <th className="p-3 text-left font-medium">Field</th>
                  <th className="p-3 text-left text-xs font-medium text-muted-foreground">Who sees it</th>
                  <th className="p-3 text-left text-xs font-medium text-muted-foreground">Optimized default</th>
                  <th className="p-3 text-left text-xs font-medium text-muted-foreground">Changed by</th>
                </tr>
              </thead>
              <tbody>
                {PROFILE_FIELD_KEYS.filter((field) => fieldDefinition(field).group === group).map((field) => {
                  const definition = fieldDefinition(field);
                  const value = values[field];
                  const differs = differsFromDefault(field, value);
                  return (
                    <tr key={field} className={`border-b border-border last:border-0 ${differs ? "bg-warning/5" : ""}`}>
                      <td className="p-3 align-top font-medium">
                        {definition.label}
                        {differs ? (
                          <Badge variant="warning" className="ml-2">
                            Changed
                          </Badge>
                        ) : null}
                      </td>
                      <td className="p-2 align-top">
                        <div className="flex items-center gap-2">
                          <LevelBadge level={value.level} iconOnly />
                          <select
                            aria-label={`Who sees ${definition.label.toLowerCase()}`}
                            value={value.level}
                            onChange={(event) =>
                              void change(field, {
                                level: event.target.value as PrivacyLevel,
                                allowPublic: value.allowPublic,
                              })
                            }
                            className="min-h-9 min-w-36 rounded-md border border-border bg-input px-2 text-xs"
                          >
                            {PRIVACY_LEVELS.map((level) => (
                              <option key={level} value={level}>
                                {LEVEL_INFO[level].label}
                              </option>
                            ))}
                          </select>
                          {saving === field ? (
                            <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground" />
                          ) : null}
                        </div>
                        {definition.allowPublic && value.level !== "PUBLIC" ? (
                          <label className="mt-2 flex items-center gap-2 text-xs">
                            <input
                              type="checkbox"
                              checked={value.allowPublic}
                              onChange={(event) =>
                                void change(field, { level: value.level, allowPublic: event.target.checked })
                              }
                              className="size-4 accent-primary"
                            />
                            {definition.allowPublic.label}
                          </label>
                        ) : null}
                      </td>
                      <td className="p-3 align-top text-xs text-muted-foreground">
                        {LEVEL_INFO[definition.level].label}
                        {definition.allowPublic
                          ? definition.allowPublic.default
                            ? field === "picture"
                              ? ", may be made Public"
                              : ", Public while preferred"
                            : ""
                          : ""}
                      </td>
                      <td className="p-3 align-top text-xs text-muted-foreground">{definition.changedBy}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
