"use client";

import { Loader2, MapPin, Plus, Search, X } from "lucide-react";
import * as React from "react";
import { LocationIcon } from "@/components/icon-picker";
import { MAX_LOCATION_NAME } from "@/lib/deliverables";
import { searchIcons } from "@/lib/location-icons";
import { cn } from "@/lib/utils";

/** An entry from the location dictionary (Settings → Locations). */
export type KnownLocationOption = { label: string; icon: string | null };

/**
 * Naming a room: pick it from the dictionary, or type one it does not have.
 *
 * Shared by a job and by its project's Job Settings, which hold the same rooms
 * — the project's are copied onto each job raised under it — so both are named
 * the same way, with the same icons, and the same "already there".
 */
export function AddLocation({
  known,
  taken: takenNames,
  where,
  onAdd,
  onError,
}: {
  known: KnownLocationOption[];
  /** Names already there, which are not offered again. */
  taken: string[];
  /** "this job", "this project" — said when a name is already there. */
  where: string;
  /** Resolves to an error message, or null when it was added. */
  onAdd: (name: string, icon: string | null) => Promise<string | null>;
  onError: (message: string | null) => void;
}) {
  const [naming, setNaming] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [pending, startTransition] = React.useTransition();

  const typed = query.replace(/\s+/g, " ").trim();
  const lower = typed.toLowerCase();
  const taken = new Set(takenNames.map((name) => name.toLowerCase()));
  const offered = known.filter(
    (entry) =>
      !taken.has(entry.label.toLowerCase()) &&
      (!lower || entry.label.toLowerCase().includes(lower)),
  );
  const already = typed && taken.has(lower) ? typed : null;
  const exact = known.some((entry) => entry.label.toLowerCase() === lower);
  const custom = typed && !already && !exact ? typed : null;
  // A room the list does not know still gets a picture: the one its list
  // namesake has — "IDF 2" the IDF's — or failing that the one its words
  // suggest, and the plain pin if they suggest nothing.
  const namesake = custom
    ? known.find((entry) => lower.startsWith(`${entry.label.toLowerCase()} `))
    : undefined;
  const customIcon = custom
    ? (namesake?.icon ?? searchIcons(custom)[0]?.key ?? null)
    : null;

  function add(name: string, icon: string | null) {
    onError(null);
    startTransition(async () => {
      const error = await onAdd(name, icon);
      if (error) return onError(error);
      setQuery("");
      setNaming(false);
    });
  }

  if (!naming) {
    return (
      <button
        type="button"
        onClick={() => setNaming(true)}
        className="flex min-h-9 items-center gap-1.5 self-start rounded-[9px] border border-dashed border-border px-3 text-[13px] font-semibold text-muted-foreground hover:text-foreground"
      >
        <MapPin className="size-3.5" />
        Add a location
      </button>
    );
  }

  const row =
    "flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm hover:bg-muted disabled:opacity-50";

  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface-raised p-2">
      <div className="flex items-center gap-1">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            autoFocus
            maxLength={MAX_LOCATION_NAME}
            aria-label="Name of the location"
            placeholder="Search or type a location…"
            disabled={pending}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                if (offered[0]) add(offered[0].label, offered[0].icon);
                else if (custom) add(custom, customIcon);
              } else if (event.key === "Escape") {
                setNaming(false);
              }
            }}
            className="min-h-10 w-full rounded-lg border border-border bg-input pl-9 pr-3 text-sm placeholder:text-muted-foreground"
          />
        </div>
        <button
          type="button"
          aria-label="Cancel adding a location"
          disabled={pending}
          onClick={() => {
            setNaming(false);
            setQuery("");
          }}
          className="flex size-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />}
        </button>
      </div>

      <div className="flex max-h-64 flex-col overflow-y-auto">
        {already ? (
          <p className="px-2.5 py-2 text-sm text-muted-foreground">
            “{already}” is already on {where}.
          </p>
        ) : null}
        {offered.map((entry) => (
          <button
            key={entry.label}
            type="button"
            disabled={pending}
            onClick={() => add(entry.label, entry.icon)}
            className={row}
          >
            <LocationIcon icon={entry.icon} className="size-4 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{entry.label}</span>
          </button>
        ))}
        {custom ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => add(custom, customIcon)}
            className={cn(row, "text-primary")}
          >
            <Plus className="size-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate">Add “{custom}”</span>
            <LocationIcon icon={customIcon} className="size-4 text-muted-foreground" />
          </button>
        ) : null}
        {offered.length === 0 && !custom && !already ? (
          <p className="px-2.5 py-2 text-sm text-muted-foreground">
            Everything on the list is on {where}. Type a name to add another.
          </p>
        ) : null}
      </div>
    </div>
  );
}
