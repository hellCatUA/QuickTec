"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

type Key = "details" | "notes" | "deliverables";

const TABS: { key: Key; label: string }[] = [
  { key: "details", label: "Details" },
  { key: "notes", label: "Notes" },
  { key: "deliverables", label: "Deliverables" },
];

/**
 * The job, in three drawers.
 *
 * The page was 4,222px at phone width — five screens on a job with no photos
 * and nothing filled in — with the thing a tech needs right now somewhere in
 * the middle of it. Three tabs, and everything that is not a tab stays above
 * them: the title, the badges and the clock. The clock especially, because it
 * is the one part that is time-critical and the one part that must never be
 * two taps away.
 *
 * `missing` is what stops the tabs making things worse. Splitting a page hides
 * whatever you are not looking at, and what a tech most needs to know is
 * exactly the thing they are not looking at: what is still outstanding before
 * they can leave. So the count rides on the tab, and the strip under the clock
 * says it in words and jumps here.
 *
 * Details is the resting tab because it is what somebody opens the job to read
 * — the address, who to call, what they were sent to do.
 */
export function JobTabs({
  missing,
  details,
  notes,
  deliverables,
}: {
  /** Required deliverables not yet supplied. */
  missing: string[];
  details: React.ReactNode;
  notes: React.ReactNode;
  deliverables: React.ReactNode;
}) {
  const [tab, setTab] = React.useState<Key>("details");

  const panes: Record<Key, React.ReactNode> = { details, notes, deliverables };

  return (
    <>
      {missing.length > 0 ? (
        <button
          type="button"
          onClick={() => setTab("deliverables")}
          className={cn(
            "flex w-full items-center gap-2 rounded-xl border border-warning/40",
            "bg-warning/10 px-4 py-3 text-left text-xs text-warning",
            "hover:bg-warning/15",
          )}
        >
          <span>
            <strong className="font-semibold">
              {missing.length} required
            </strong>{" "}
            still missing before you can close — {missing.join(", ")}
          </span>
          <span className="ml-auto shrink-0 text-muted-foreground">›</span>
        </button>
      ) : null}

      <div
        role="tablist"
        aria-label="Job"
        className="flex gap-0.5 rounded-lg border border-border bg-surface-raised p-0.5"
      >
        {TABS.map((one) => (
          <button
            key={one.key}
            type="button"
            role="tab"
            aria-selected={tab === one.key}
            onClick={() => setTab(one.key)}
            className={cn(
              "flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-md",
              "text-[13px] font-medium transition-colors",
              tab === one.key
                ? "bg-primary font-semibold text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {one.label}
            {one.key === "deliverables" && missing.length > 0 ? (
              <span
                className={cn(
                  "flex min-w-4 items-center justify-center rounded-full px-1",
                  "text-[10px] font-semibold",
                  tab === one.key
                    ? "bg-black/20 text-primary-foreground"
                    : "bg-warning/20 text-warning",
                )}
              >
                {missing.length}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {/* All three stay mounted. A tab that unmounts loses whatever was half
          typed into it, which on this page is somebody's Work performed. */}
      {TABS.map((one) => (
        <div
          key={one.key}
          hidden={tab !== one.key}
          className={cn("flex-col gap-4", tab === one.key ? "flex" : "hidden")}
        >
          {panes[one.key]}
        </div>
      ))}
    </>
  );
}
