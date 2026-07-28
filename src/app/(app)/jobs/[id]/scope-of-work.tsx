"use client";

import * as React from "react";
import { Markdown } from "@/components/markdown";
import { toggleScopeCheck } from "./actions";

/**
 * Scope of work with live checkboxes.
 *
 * Ticks are optimistic — a tech on one bar of signal should see the box fill
 * the instant they tap it, not a second later. A rejected save rolls the box
 * back so the screen never claims something the server did not accept.
 */
export function ScopeOfWork({
  jobId,
  generalScope,
  jobScope,
  checkedKeys,
  canCheck,
}: {
  jobId: string;
  generalScope: string | null;
  jobScope: string | null;
  checkedKeys: string[];
  canCheck: boolean;
}) {
  const [checked, setChecked] = React.useState(() => new Set(checkedKeys));
  const [error, setError] = React.useState<string | null>(null);
  const [, startTransition] = React.useTransition();

  function toggle(key: string, next: boolean) {
    setError(null);
    setChecked((current) => {
      const updated = new Set(current);
      if (next) updated.add(key);
      else updated.delete(key);
      return updated;
    });

    startTransition(async () => {
      const formData = new FormData();
      formData.set("jobId", jobId);
      formData.set("lineKey", key);
      formData.set("checked", String(next));

      const result = await toggleScopeCheck(formData);
      if (!result.ok) {
        setError(result.error);
        setChecked((current) => {
          const rolledBack = new Set(current);
          if (next) rolledBack.delete(key);
          else rolledBack.add(key);
          return rolledBack;
        });
      }
    });
  }

  const renderCheck = canCheck
    ? (check: { key: string; checked: boolean }) => (
        <input
          type="checkbox"
          checked={checked.has(check.key)}
          onChange={(event) => toggle(check.key, event.target.checked)}
          className="mt-0.5 size-5 shrink-0 accent-[var(--color-primary)]"
        />
      )
    : undefined;

  // The stored tick state is authoritative, not whatever "[x]" the planner
  // typed — otherwise re-saving the scope would wipe the crew's progress.
  const withState = (check: { key: string; checked: boolean }) => ({
    ...check,
    checked: checked.has(check.key),
  });

  return (
    <div className="flex flex-col gap-4">
      {error ? <p className="text-sm text-danger">{error}</p> : null}

      {generalScope ? (
        <div>
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Project general scope
          </div>
          <Markdown
            source={generalScope}
            renderCheck={
              renderCheck
                ? (check) => renderCheck(withState(check))
                : undefined
            }
          />
        </div>
      ) : null}

      {jobScope ? (
        <div>
          {generalScope ? (
            <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              This job
            </div>
          ) : null}
          <Markdown
            source={jobScope}
            renderCheck={
              renderCheck
                ? (check) => renderCheck(withState(check))
                : undefined
            }
          />
        </div>
      ) : null}

      {!generalScope && !jobScope ? (
        <p className="text-sm text-muted-foreground">
          No scope recorded for this job.
        </p>
      ) : null}
    </div>
  );
}
