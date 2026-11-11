"use client";

import type { PrivacyLevel } from "@prisma-client";
import * as React from "react";
import { HistoryButton, HistoryPanel, useHistoryOf } from "@/components/profile/history";
import { LevelBadge } from "@/components/profile/parts";
import type { HistoryField } from "@/lib/profile-history";

/**
 * A line of somebody else's profile, read rather than edited: what it is, its
 * value, who may see it, and — for whoever may read it — its history, opened
 * under the line.
 */
export function Line({
  label,
  level,
  field,
  children,
}: {
  label: string;
  level: PrivacyLevel;
  field?: HistoryField;
  children: React.ReactNode;
}) {
  const userId = useHistoryOf();
  const [open, setOpen] = React.useState(false);
  return (
    <div className="border-t border-border first:border-t-0">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-1 px-4 py-3 text-sm sm:grid-cols-[10rem_minmax(0,1fr)_auto] sm:items-center sm:gap-4">
        {/* Each told its cell. With only a row to go on, the grid seated
            the controls first — in the wide column — and the label in what
            was left, so on a phone every label sat at the right-hand edge
            over a value at the left.

            On a phone the label sits directly on its value and the history
            button stands beside the pair, across both rows. Sharing the
            label's row alone, the button made that row its own height and
            pushed the value a finger's width down from what it belongs to. */}
        <dt className="col-start-1 row-start-1 text-muted-foreground">{label}</dt>
        <div className="col-start-2 row-span-2 row-start-1 flex items-center justify-end gap-1 self-center sm:col-start-3 sm:row-span-1">
          <LevelBadge level={level} iconOnly className="hidden sm:inline-flex" />
          {userId && field ? (
            <HistoryButton label={label} open={open} onToggle={() => setOpen((was) => !was)} />
          ) : null}
        </div>
        <dd className="col-start-1 row-start-2 min-w-0 break-words sm:col-start-2 sm:row-start-1">
          {children}
        </dd>
      </div>
      {userId && field && open ? (
        <HistoryPanel userId={userId} field={field} className="mx-4 mb-3" />
      ) : null}
    </div>
  );
}
