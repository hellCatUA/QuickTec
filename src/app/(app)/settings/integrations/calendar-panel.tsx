"use client";

import { CalendarSync, CircleAlert, CircleCheck, Loader2 } from "lucide-react";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { runCalendarSync } from "./actions";

export type SyncSummary = {
  pushed: number;
  removed: number;
  skipped: number;
  failures: { target: string; reason: string }[];
};

/**
 * Runs the calendar push on demand.
 *
 * Sync is one-way, so a failure is never destructive — the worst outcome is a
 * calendar that is a few minutes behind. The result is shown in full, including
 * what was skipped, because "nothing happened" and "nothing needed to happen"
 * look identical otherwise.
 */
export function CalendarPanel({ configured }: { configured: boolean }) {
  const [result, setResult] = React.useState<SyncSummary | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  return (
    <div className="flex flex-col gap-3">
      <Button
        type="button"
        size="sm"
        disabled={pending || !configured}
        onClick={() => {
          setError(null);
          setResult(null);
          startTransition(async () => {
            const outcome = await runCalendarSync();
            if (!outcome.ok) setError(outcome.error);
            else setResult(outcome.summary);
          });
        }}
        className="self-start"
      >
        {pending ? <Loader2 className="animate-spin" /> : <CalendarSync />}
        {pending ? "Syncing" : "Sync calendars now"}
      </Button>

      {!configured ? (
        <p className="flex items-start gap-2 text-xs text-warning">
          <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
          Set CALDAV_USERNAME and CALDAV_PASSWORD to enable this. Use a
          NextCloud app password for the system account, not its login password.
        </p>
      ) : null}

      {error ? <p className="text-sm text-danger">{error}</p> : null}

      {result ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="success">{result.pushed} pushed</Badge>
            <Badge variant="neutral">{result.skipped} unchanged</Badge>
            {result.removed > 0 ? (
              <Badge variant="warning">{result.removed} removed</Badge>
            ) : null}
            {result.failures.length > 0 ? (
              <Badge variant="danger">{result.failures.length} failed</Badge>
            ) : (
              <Badge variant="success">
                <CircleCheck className="size-3" /> No errors
              </Badge>
            )}
          </div>

          {result.failures.length > 0 ? (
            <ul className="list-inside list-disc text-xs text-danger">
              {result.failures.slice(0, 10).map((failure, index) => (
                <li key={index}>
                  {failure.target}: {failure.reason}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
