import type { PrivacyLevel } from "@prisma-client";
import { Globe, Lock, PencilOff, Users } from "lucide-react";
import * as React from "react";
import { LEVEL_INFO } from "@/lib/profile-privacy";
import { cn } from "@/lib/utils";

/**
 * The pieces every view of a profile shares: who may see a line, a value the
 * viewer cannot change, and the picture.
 */

const LEVEL_ICON: Record<PrivacyLevel, typeof Lock> = {
  RESTRICTED: Lock,
  FEDERATED: Users,
  PUBLIC: Globe,
};

const LEVEL_TONE: Record<PrivacyLevel, string> = {
  RESTRICTED: "bg-muted text-foreground/80",
  FEDERATED: "bg-primary/15 text-primary",
  PUBLIC: "bg-success/15 text-success",
};

export function LevelIcon({
  level,
  className,
}: {
  level: PrivacyLevel;
  className?: string;
}) {
  const Icon = LEVEL_ICON[level];
  return <Icon aria-hidden className={cn("size-3.5 shrink-0", className)} />;
}

/** Who may see a line: the icon, and the word unless it is asked to be quiet. */
export function LevelBadge({
  level,
  iconOnly,
  className,
}: {
  level: PrivacyLevel;
  iconOnly?: boolean;
  className?: string;
}) {
  const info = LEVEL_INFO[level];
  return (
    <span
      title={`${info.label} — ${info.description}`}
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md text-xs font-medium",
        iconOnly ? "w-7 justify-center" : "px-2",
        LEVEL_TONE[level],
        className,
      )}
    >
      <LevelIcon level={level} />
      {iconOnly ? <span className="sr-only">{info.label}</span> : info.label}
    </span>
  );
}

/** The three levels, said once, so the icons on every line can be short. */
export function LevelsLegend({ className }: { className?: string }) {
  return (
    <ul className={cn("flex flex-col gap-3", className)}>
      {(["RESTRICTED", "FEDERATED", "PUBLIC"] as PrivacyLevel[]).map((level) => (
        <li key={level} className="flex items-start gap-2.5">
          <LevelBadge level={level} iconOnly />
          <div className="min-w-0">
            <div className="text-sm font-medium">{LEVEL_INFO[level].label}</div>
            <p className="text-xs text-muted-foreground">{LEVEL_INFO[level].description}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * A value the viewer may look at but not change.
 *
 * Drawn unlike an input on purpose — darker, a dashed edge, a crossed-out
 * pencil, and a cursor that says no — because a read-only value dressed as a
 * field is a field somebody taps, types into nothing, and then reports as
 * broken.
 */
export function ReadOnlyValue({
  children,
  className,
  empty = "Not set",
}: {
  children?: React.ReactNode;
  className?: string;
  empty?: string;
}) {
  const blank = children === null || children === undefined || children === "";
  return (
    <div
      className={cn(
        "flex min-h-11 cursor-not-allowed items-center gap-2 rounded-lg border border-dashed border-border bg-background px-3 text-sm",
        blank ? "text-muted-foreground" : "text-foreground/85",
        className,
      )}
    >
      <span className="min-w-0 flex-1 break-words">{blank ? empty : children}</span>
      <PencilOff aria-hidden className="size-4 shrink-0 text-muted-foreground/70" />
      <span className="sr-only">(read-only)</span>
    </div>
  );
}

/** What an editable field and a read-only one look like, side by side. */
export function EditableKey() {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-2">
        <span aria-hidden className="h-6 w-12 rounded-md border border-border bg-input" />
        You can change it
      </span>
      <span className="inline-flex items-center gap-2">
        <span
          aria-hidden
          className="flex h-6 w-12 items-center justify-end rounded-md border border-dashed border-border bg-background pr-1"
        >
          <PencilOff className="size-3.5 text-muted-foreground/70" />
        </span>
        Read-only — set by others, or by request
      </span>
    </div>
  );
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? [parts[0], parts[parts.length - 1]] : parts;
  return letters.map((part) => part[0]?.toLocaleUpperCase() ?? "").join("") || "?";
}

/** The picture, or the person's initials where there is none to show. */
export function Avatar({
  src,
  name,
  size = 40,
  className,
}: {
  src: string | null;
  name: string;
  size?: number;
  className?: string;
}) {
  const style = { width: size, height: size, fontSize: Math.round(size * 0.36) };
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- served by our own route, already square and small
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        style={style}
        className={cn("shrink-0 rounded-full bg-muted object-cover", className)}
      />
    );
  }
  return (
    <span
      aria-hidden
      style={style}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-muted font-semibold text-foreground/80",
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}
