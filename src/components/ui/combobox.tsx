"use client";

import { Check, ChevronDown, Plus, Search, X } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

export type ComboOption = {
  value: string;
  /** The line people read and search against. */
  label: string;
  /** Second line: an address, a role, whatever tells two apart. */
  hint?: string;
  /** Extra words to match on that are not worth showing. */
  keywords?: string;
};

/**
 * Type-to-filter picker.
 *
 * A native select opens the iOS wheel, which is fine for four options and
 * miserable for forty — and it cannot be searched at all. This keeps the
 * one-handed target size but lets somebody type three characters of a site
 * number instead of scrolling.
 *
 * The chosen value is submitted through a hidden input, so the surrounding
 * form still works the way every other form here does.
 */
export function Combobox({
  name,
  value,
  onChange,
  options,
  placeholder = "Search…",
  emptyText = "Nothing matches.",
  allowClear = true,
  disabled,
  id,
  onCreate,
  createLabel,
}: {
  name?: string;
  value: string;
  onChange: (value: string) => void;
  options: ComboOption[];
  placeholder?: string;
  emptyText?: string;
  /** Whether "none of them" is a valid answer. */
  allowClear?: boolean;
  disabled?: boolean;
  id?: string;
  /** Offered when the search matches nothing worth picking. */
  onCreate?: (query: string) => void;
  createLabel?: (query: string) => string;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const selected = options.find((option) => option.value === value) ?? null;

  const matches = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((option) =>
      `${option.label} ${option.hint ?? ""} ${option.keywords ?? ""}`
        .toLowerCase()
        .includes(needle),
    );
  }, [options, query]);

  // Clicking away closes it. Touch counts: on a phone the keyboard covers half
  // the screen and tapping elsewhere is how people dismiss things.
  React.useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function choose(next: string) {
    onChange(next);
    setQuery("");
    setOpen(false);
  }

  const canCreate =
    onCreate !== undefined && query.trim().length > 0;

  return (
    <div ref={rootRef} className="relative">
      {name ? <input type="hidden" name={name} value={value} /> : null}

      {open ? (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={inputRef}
            id={id}
            autoFocus
            value={query}
            disabled={disabled}
            placeholder={placeholder}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActive((index) => Math.min(index + 1, matches.length - 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActive((index) => Math.max(index - 1, 0));
              } else if (event.key === "Enter") {
                // Never submit the form from in here: Enter picks.
                event.preventDefault();
                if (matches[active]) choose(matches[active].value);
                else if (canCreate) {
                  onCreate?.(query.trim());
                  setOpen(false);
                }
              } else if (event.key === "Escape") {
                setOpen(false);
              }
            }}
            className="w-full min-h-11 rounded-lg border border-primary bg-input pl-9 pr-3 text-foreground placeholder:text-muted-foreground"
            role="combobox"
            aria-expanded="true"
            aria-controls={`${id ?? name ?? "combo"}-list`}
          />
        </div>
      ) : (
        <button
          type="button"
          id={id}
          disabled={disabled}
          onClick={() => {
            setQuery("");
            setOpen(true);
          }}
          className={cn(
            "flex w-full min-h-11 items-center gap-2 rounded-lg border border-border bg-input px-3 text-left disabled:cursor-not-allowed disabled:opacity-60",
          )}
        >
          <span className="min-w-0 flex-1">
            {selected ? (
              <>
                <span className="block truncate">{selected.label}</span>
                {selected.hint ? (
                  <span className="block truncate text-xs text-muted-foreground">
                    {selected.hint}
                  </span>
                ) : null}
              </>
            ) : (
              <span className="text-muted-foreground">{placeholder}</span>
            )}
          </span>

          {selected && allowClear ? (
            <span
              role="button"
              tabIndex={-1}
              aria-label="Clear"
              onClick={(event) => {
                event.stopPropagation();
                onChange("");
              }}
              className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="size-4" />
            </span>
          ) : null}
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        </button>
      )}

      {open ? (
        <ul
          id={`${id ?? name ?? "combo"}-list`}
          role="listbox"
          className="absolute z-50 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-border bg-surface-raised shadow-lg"
        >
          {allowClear && !query.trim() ? (
            <li>
              <button
                type="button"
                onClick={() => choose("")}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-muted"
              >
                <span className="flex-1 text-muted-foreground">— none —</span>
                {value === "" ? <Check className="size-4" /> : null}
              </button>
            </li>
          ) : null}

          {matches.map((option, index) => (
            <li key={option.value}>
              <button
                type="button"
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(option.value)}
                role="option"
                aria-selected={option.value === value}
                className={cn(
                  "flex w-full items-start gap-2 px-3 py-2.5 text-left text-sm hover:bg-muted",
                  index === active && "bg-muted",
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{option.label}</span>
                  {option.hint ? (
                    <span className="block truncate text-xs text-muted-foreground">
                      {option.hint}
                    </span>
                  ) : null}
                </span>
                {option.value === value ? (
                  <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                ) : null}
              </button>
            </li>
          ))}

          {matches.length === 0 && !canCreate ? (
            <li className="px-3 py-2.5 text-sm text-muted-foreground">
              {emptyText}
            </li>
          ) : null}

          {canCreate ? (
            <li className="border-t border-border">
              <button
                type="button"
                onClick={() => {
                  onCreate?.(query.trim());
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-primary hover:bg-muted"
              >
                <Plus className="size-4 shrink-0" />
                {createLabel?.(query.trim()) ?? `Create “${query.trim()}”`}
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
