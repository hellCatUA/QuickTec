"use client";

import { ChevronDown } from "lucide-react";
import * as React from "react";
import { timelineMeta, type TimelineGroup } from "@/lib/timeline";
import { cn } from "@/lib/utils";

const TONE_CLASS = {
  neutral: "text-muted-foreground",
  primary: "text-primary",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
} as const;

export type TimelineRow = {
  key: string;
  action: string;
  entries: {
    id: string;
    /** Already formatted in the site's zone by the server. */
    when: string;
    /** What the event was about — a field name, or a person. */
    subject: string | null;
    /** Who did it. */
    actor: string | null;
    from: string | null;
    to: string | null;
    reason: string | null;
  }[];
};

/**
 * The history of a job or a project.
 *
 * A run of like events collapses into one row that opens on a tap: adding five
 * jobs to a project should read as one thing that happened, not push the rest
 * of the history off the screen. Everything else is a plain line.
 */
export function Timeline({ rows }: { rows: TimelineRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>
    );
  }

  return (
    <ol className="flex flex-col gap-1.5">
      {rows.map((row) => (
        <TimelineItem key={row.key} row={row} />
      ))}
    </ol>
  );
}

function TimelineItem({ row }: { row: TimelineRow }) {
  const [open, setOpen] = React.useState(false);
  const meta = timelineMeta(row.action);
  const Icon = meta.icon;
  const grouped = row.entries.length > 1;
  const first = row.entries[0];

  return (
    <li className="flex gap-2.5">
      <Icon className={cn("mt-0.5 size-4 shrink-0", TONE_CLASS[meta.tone])} />

      <div className="min-w-0 flex-1">
        {grouped ? (
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            className="flex w-full flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded text-left text-sm hover:text-primary"
          >
            <span className="font-medium">
              {meta.label} · {row.entries.length}
            </span>
            <span className="tabular text-xs text-muted-foreground">
              {row.entries[row.entries.length - 1].when} – {first.when}
            </span>
            {first.actor ? (
              <span className="text-xs text-muted-foreground">
                by {first.actor}
              </span>
            ) : null}
            <ChevronDown
              className={cn(
                "size-3.5 shrink-0 text-muted-foreground transition-transform",
                open && "rotate-180",
              )}
            />
          </button>
        ) : (
          <Entry label={meta.label} entry={first} />
        )}

        {grouped && open ? (
          <ul className="mt-1 flex flex-col gap-1 border-l border-border pl-3">
            {row.entries.map((entry) => (
              <li key={entry.id}>
                <Entry label={meta.label} entry={entry} />
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </li>
  );
}

function Entry({
  label,
  entry,
}: {
  label: string;
  entry: TimelineRow["entries"][number];
}) {
  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
        <span className="font-medium">{label}</span>
        {entry.subject ? (
          <span className="text-muted-foreground">· {entry.subject}</span>
        ) : null}
        <span className="tabular text-xs text-muted-foreground">
          {entry.when}
        </span>
      </div>

      {entry.from !== null || entry.to !== null ? (
        <div className="flex flex-wrap items-baseline gap-1.5 text-xs">
          <span className="text-muted-foreground line-through">
            {entry.from || "empty"}
          </span>
          <span className="text-muted-foreground">→</span>
          <span>{entry.to || "empty"}</span>
        </div>
      ) : null}

      {entry.reason ? (
        <div className="text-xs text-muted-foreground">
          Reason: {entry.reason}
        </div>
      ) : null}

      {entry.actor ? (
        <div className="text-[11px] text-muted-foreground">by {entry.actor}</div>
      ) : null}
    </div>
  );
}
