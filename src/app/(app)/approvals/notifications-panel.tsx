"use client";

import { BellRing, Check } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { acknowledgeNotification, acknowledgeAll } from "./actions";

export type NotificationRow = {
  id: string;
  title: string;
  body: string | null;
  href: string | null;
  when: string;
  actor: string | null;
};

/**
 * Things that happened to you, waiting to be acknowledged.
 *
 * Kept visually apart from the approvals below it: those are decisions, these
 * are facts. Acknowledging is not approving — it only records that the person
 * has seen it, which is what turns "they were told" into something checkable.
 */
export function NotificationsPanel({ rows }: { rows: NotificationRow[] }) {
  const [dismissed, setDismissed] = React.useState<Set<string>>(new Set());
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const visible = rows.filter((row) => !dismissed.has(row.id));
  if (visible.length === 0) return null;

  /** Puts rows back when the server did not in fact record the acknowledgement. */
  function restore(ids: string[]) {
    setDismissed((current) => {
      const back = new Set(current);
      for (const id of ids) back.delete(id);
      return back;
    });
  }

  function acknowledge(id: string) {
    // Off the screen immediately: the record is what matters, and waiting for
    // a round trip to remove a line you have read feels broken. If it did not
    // land, the line comes back rather than leaving somebody sure they have
    // acknowledged something the record says they have not.
    setError(null);
    setDismissed((current) => new Set(current).add(id));
    startTransition(async () => {
      const formData = new FormData();
      formData.set("id", id);
      const result = await acknowledgeNotification(formData);
      if (!result.ok) {
        restore([id]);
        setError(result.error ?? "That did not go through.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-primary/30 bg-primary/5 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <BellRing className="size-4 shrink-0 text-primary" />
        <span className="text-sm font-semibold">
          For your information · {visible.length}
        </span>
        <span className="text-xs text-muted-foreground">
          Nothing to decide — mark them read so it is on record.
        </span>

        {visible.length > 1 ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto"
            disabled={pending}
            onClick={() => {
              const ids = visible.map((row) => row.id);
              setError(null);
              setDismissed((current) => {
                const next = new Set(current);
                for (const id of ids) next.add(id);
                return next;
              });
              startTransition(async () => {
                const result = await acknowledgeAll();
                if (!result.ok) {
                  restore(ids);
                  setError(result.error ?? "That did not go through.");
                }
              });
            }}
          >
            <Check /> Mark all read
          </Button>
        ) : null}
      </div>

      {error ? <p className="text-sm text-danger">{error}</p> : null}

      <ul className="flex flex-col gap-1.5">
        {visible.map((row) => (
          <li
            key={row.id}
            className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface p-2 text-sm"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-2">
                {row.href ? (
                  <Link
                    href={row.href}
                    className="font-medium text-primary underline-offset-4 hover:underline"
                  >
                    {row.title}
                  </Link>
                ) : (
                  <span className="font-medium">{row.title}</span>
                )}
                <span className="tabular text-xs text-muted-foreground">
                  {row.when}
                </span>
              </div>
              {row.body ? (
                <div className="text-xs text-muted-foreground">{row.body}</div>
              ) : null}
              {row.actor ? (
                <div className="text-[11px] text-muted-foreground">
                  by {row.actor}
                </div>
              ) : null}
            </div>

            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={pending}
              aria-label={`Mark read: ${row.title}`}
              onClick={() => acknowledge(row.id)}
            >
              <Check /> Got it
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
