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
        <dt className="text-muted-foreground">{label}</dt>
        <div className="row-start-1 flex items-center justify-end gap-1 sm:col-start-3">
          <LevelBadge level={level} iconOnly className="hidden sm:inline-flex" />
          {userId && field ? (
            <HistoryButton label={label} open={open} onToggle={() => setOpen((was) => !was)} />
          ) : null}
        </div>
        <dd className="col-span-2 min-w-0 break-words sm:col-span-1 sm:col-start-2 sm:row-start-1">
          {children}
        </dd>
      </div>
      {userId && field && open ? (
        <HistoryPanel userId={userId} field={field} className="mx-4 mb-3" />
      ) : null}
    </div>
  );
}
