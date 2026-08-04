"use client";

import {
  CalendarSync,
  CircleAlert,
  CircleCheck,
  Loader2,
  PlugZap,
} from "lucide-react";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { SyncScope } from "@/lib/calendar/sync";
import { checkCalendarAccess, runCalendarSync } from "./actions";

export type SyncSummary = {
  pushed: number;
  removed: number;
  skipped: number;
  reasons: Record<string, number | undefined>;
  failures: { target: string; reason: string }[];
};

/**
 * Runs the calendar push on demand, and says what happened.
 *
 * Sync is one-way, so a failure is never destructive — the worst outcome is a
 * calendar that is a few minutes behind. The result is shown in full, including
 * why nothing was pushed, because "nothing happened" and "nothing needed to
 * happen" look identical otherwise and only one of them is a problem.
 */
export function CalendarPanel({ configured }: { configured: boolean }) {
  const [result, setResult] = React.useState<SyncSummary | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [check, setCheck] = React.useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const [running, setRunning] = React.useState<SyncScope | "check" | null>(null);
  const [, startTransition] = React.useTransition();

  function sweep(scope: SyncScope) {
    setError(null);
    setResult(null);
    setRunning(scope);
    startTransition(async () => {
      const outcome = await runCalendarSync(scope);
      setRunning(null);
      if (!outcome.ok) setError(outcome.error);
      else setResult(outcome.summary);
    });
  }

  const reasons = Object.entries(result?.reasons ?? {}).filter(
    ([, count]) => (count ?? 0) > 0,
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={running !== null}
          onClick={() => {
            setError(null);
            setCheck(null);
            setRunning("check");
            startTransition(async () => {
              setCheck(await checkCalendarAccess());
              setRunning(null);
            });
          }}
        >
          {running === "check" ? (
            <Loader2 className="animate-spin" />
          ) : (
            <PlugZap />
          )}
          Check connection
        </Button>

        <Button
          type="button"
          size="sm"
          disabled={running !== null || !configured}
          onClick={() => sweep("recent")}
        >
          {running === "recent" ? (
            <Loader2 className="animate-spin" />
          ) : (
            <CalendarSync />
          )}
          {running === "recent" ? "Syncing" : "Sync calendars now"}
        </Button>

        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={running !== null || !configured}
          onClick={() => sweep("everything")}
          title="Every job there has ever been, however old"
        >
          {running === "everything" ? <Loader2 className="animate-spin" /> : null}
          Rebuild from every job
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        The usual sync covers the last month plus anything already in a
        calendar, and sends only what has changed. Rebuilding reaches work older
        than that and writes every event again — use it when a calendar has come
        up empty, or after somebody has edited one at the NextCloud end.
      </p>

      {!configured ? (
        <p className="flex items-start gap-2 text-xs text-warning">
          <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
          Set CALDAV_USERNAME and CALDAV_PASSWORD to enable this. Use a
          NextCloud app password for the system account, not its login password.
        </p>
      ) : null}

      {check ? (
        <p
          className={`flex items-start gap-2 text-xs ${check.ok ? "text-success" : "text-danger"}`}
        >
          {check.ok ? (
            <CircleCheck className="mt-0.5 size-3.5 shrink-0" />
          ) : (
            <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
          )}
          {check.message}
        </p>
      ) : null}

      {error ? <p className="text-sm text-danger">{error}</p> : null}

      {result ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="success">{result.pushed} pushed</Badge>
            <Badge variant="neutral">{result.skipped} skipped</Badge>
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

          {reasons.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              Skipped:{" "}
              {reasons.map(([reason, count]) => `${count} ${reason}`).join(", ")}
              .
            </p>
          ) : null}

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
