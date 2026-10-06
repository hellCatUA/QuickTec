"use client";

import { Check, Search, X } from "lucide-react";
import * as React from "react";
import {
  ICON_GROUPS,
  type IconEntry,
  LOCATION_ICONS,
  locationIcon,
  searchIcons,
} from "@/lib/location-icons";
import { cn } from "@/lib/utils";

/** A location's icon, from the key it stores. */
export function LocationIcon({
  icon,
  className,
}: {
  icon: string | null | undefined;
  className?: string;
}) {
  const Icon = locationIcon(icon).icon;
  return <Icon aria-hidden className={cn("shrink-0", className)} />;
}

/**
 * Picks an icon from the collection, by search or by browsing.
 *
 * Searched by the words a tech uses — "telco", "facp", "elev" — rather than
 * by what the picture is called; browsed by group when nothing is typed, so
 * somebody who does not know the word can still find the rack by looking.
 */
export function IconPicker({
  value,
  onChange,
  label,
  disabled,
  className,
}: {
  value: string | null;
  onChange: (key: string) => void;
  /** What the icon is for, so the button says more than "icon". */
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const root = React.useRef<HTMLDivElement>(null);
  const current = locationIcon(value);

  React.useEffect(() => {
    if (!open) return;
    function away(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const Icon = current.icon;

  return (
    <div ref={root} className={cn("relative", className)}>
      <button
        type="button"
        aria-label={`Icon for ${label}: ${current.label}. Change it`}
        aria-expanded={open}
        aria-haspopup="dialog"
        disabled={disabled}
        onClick={() => setOpen((was) => !was)}
        className={cn(
          "flex size-11 items-center justify-center rounded-lg border bg-input text-foreground transition-colors",
          "hover:bg-muted disabled:pointer-events-none disabled:opacity-50",
          open ? "border-primary" : "border-border",
        )}
      >
        <Icon className="size-5" />
      </button>

      {open ? (
        <IconGrid
          value={current.key}
          label={label}
          onPick={(key) => {
            onChange(key);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}

function IconGrid({
  value,
  label,
  onPick,
  onClose,
}: {
  value: string;
  label: string;
  onPick: (key: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = React.useState("");
  const found = query.trim() ? searchIcons(query) : null;

  const tile = (entry: IconEntry) => {
    const Glyph = entry.icon;
    const chosen = entry.key === value;
    return (
      <button
        key={entry.key}
        type="button"
        title={entry.label}
        aria-label={entry.label}
        aria-pressed={chosen}
        onClick={() => onPick(entry.key)}
        className={cn(
          "relative flex h-16 flex-col items-center justify-center gap-1 rounded-lg px-0.5 text-center",
          "hover:bg-muted",
          chosen && "bg-primary/15 text-primary ring-1 ring-inset ring-primary/40",
        )}
      >
        <Glyph aria-hidden className="size-5" />
        <span className="line-clamp-2 text-[10px] leading-tight text-muted-foreground">
          {entry.label}
        </span>
        {chosen ? (
          <Check className="absolute right-1 top-1 size-3" strokeWidth={3} />
        ) : null}
      </button>
    );
  };

  return (
    <div
      role="dialog"
      aria-label={`Pick an icon for ${label}`}
      className={cn(
        // Opens from a button that sits inset in its row, so the width leaves
        // room for that inset as well as the page's gutters.
        "absolute left-0 top-12 z-50 flex w-[min(24rem,calc(100vw-4.5rem))] flex-col",
        "rounded-xl border border-border bg-surface-raised shadow-xl",
      )}
    >
      <div className="flex items-center gap-1 border-b border-border p-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            aria-label="Search icons"
            placeholder="Search: rack, telco, elevator, fire…"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                if (found?.[0]) onPick(found[0].key);
              }
            }}
            className="min-h-10 w-full rounded-lg border border-border bg-input pl-9 pr-3 text-sm placeholder:text-muted-foreground"
          />
        </div>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="flex size-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="max-h-80 overflow-y-auto p-2">
        {found ? (
          found.length > 0 ? (
            <div className="grid grid-cols-5 gap-1">{found.map(tile)}</div>
          ) : (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
              No icon for “{query.trim()}”. Try another word — the plain pin
              works for anything.
            </p>
          )
        ) : (
          ICON_GROUPS.map((group) => (
            <div key={group} className="flex flex-col gap-1 pb-2">
              <span className="px-1 pt-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {group}
              </span>
              <div className="grid grid-cols-5 gap-1">
                {LOCATION_ICONS.filter((entry) => entry.group === group).map(
                  tile,
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
