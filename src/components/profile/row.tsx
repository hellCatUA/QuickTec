import type { PrivacyLevel } from "@prisma-client";
import { Cloud, History } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { LevelBadge } from "@/components/profile/parts";
import type { ProfileField } from "@/lib/profile-privacy";
import { cn } from "@/lib/utils";

/**
 * One line of a profile: what it is and where it came from, the value, and
 * who may see it with the way into its history.
 *
 * Shared by the profile itself, its pay card and a manager's panel, so a line
 * looks the same wherever it is: the level in a column of its own width — the
 * values end on one edge whatever their badge says — and, where the card is
 * too narrow for three columns, beside the line's name rather than under its
 * value, so a line is not three rows tall.
 *
 * By the card's width rather than the window's: beside the profile's own
 * column of picture and legend, a card on a laptop is as narrow as a tablet,
 * and three columns there left a City box 26px wide.
 */
export function ProfileRow({
  label,
  htmlFor,
  source,
  note,
  level,
  field,
  hint,
  highlight,
  children,
}: {
  label: string;
  htmlFor?: string;
  source?: string | null;
  note?: string;
  level: PrivacyLevel;
  /** For the way into this line's history. Left out where there is none. */
  field?: ProfileField;
  hint?: React.ReactNode;
  highlight?: boolean;
  children: React.ReactNode;
}) {
  const Tag = htmlFor ? "label" : "span";
  return (
    <div
      className={cn("@container border-t border-border first:border-t-0", highlight && "bg-primary/5")}
    >
      <div className="grid gap-2 p-4 @2xl:grid-cols-[10rem_minmax(0,1fr)_8.5rem] @2xl:gap-4">
        <div className="flex items-start gap-2 @2xl:pt-2.5">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <Tag {...(htmlFor ? { htmlFor } : {})} className="text-sm font-medium">
              {label}
            </Tag>
            {source ? (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Cloud className="size-3 text-primary" /> {source}
              </span>
            ) : note ? (
              <span className="text-xs text-muted-foreground">{note}</span>
            ) : null}
          </div>
          <LevelControls level={level} field={field} label={label} className="@2xl:hidden" />
        </div>
        <div className="@container min-w-0">
          {children}
          {hint ? <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p> : null}
        </div>
        <LevelControls
          level={level}
          field={field}
          label={label}
          className="hidden @2xl:flex @2xl:self-start @2xl:pt-1.5"
        />
      </div>
    </div>
  );
}

function LevelControls({
  level,
  field,
  label,
  className,
}: {
  level: PrivacyLevel;
  field?: ProfileField;
  label: string;
  className?: string;
}) {
  return (
    <div className={cn("flex shrink-0 items-center justify-end gap-1", className)}>
      <LevelBadge level={level} />
      {field ? (
        <HistoryLink field={field} label={label} />
      ) : (
        // Holds the place, so a line without a history ends where the
        // others do.
        <span aria-hidden className="size-10 sm:size-8" />
      )}
    </div>
  );
}

/** The way into one line's history, on whichever page it is. */
export function HistoryLink({ field, label }: { field: ProfileField; label: string }) {
  return (
    <Link
      href={`?history=${field}#history`}
      scroll={false}
      aria-label={`History of ${label.toLowerCase()}`}
      title="History"
      className="flex size-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground sm:size-8"
    >
      <History className="size-4" />
    </Link>
  );
}
