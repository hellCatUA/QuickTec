"use client";

import { ArrowRight, History, Loader2 } from "lucide-react";
import * as React from "react";
import {
  loadFieldHistory,
  type FieldHistoryEntry,
} from "@/app/(app)/people/history-actions";
import type { HistoryField } from "@/lib/profile-history";
import { cn } from "@/lib/utils";

/**
 * A line's history, opened under the line itself.
 *
 * Each line of a profile has its own: the button beside its level opens it in
 * place, rather than sending somebody to a list of every change at the foot
 * of the page. The entries are asked for when it opens — most never are.
 */

/** Said by whatever saves a profile, so an open history shows what was just done. */
const STALE = "profile-history-stale";
export function historyChanged() {
  window.dispatchEvent(new Event(STALE));
}

/** Whose history the lines below belong to; absent where it is not the reader's to read. */
const HistoryOf = React.createContext<string | null>(null);

export function HistoryProvider({
  userId,
  children,
}: {
  /** Null when the reader may not read it: no buttons are drawn. */
  userId: string | null;
  children: React.ReactNode;
}) {
  return <HistoryOf.Provider value={userId}>{children}</HistoryOf.Provider>;
}

export function useHistoryOf(): string | null {
  return React.useContext(HistoryOf);
}

/** The button that opens and closes a line's history. */
export function HistoryButton({
  label,
  open,
  onToggle,
  className,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-label={`History of ${label.toLowerCase()}`}
      title="History"
      className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground sm:size-8",
        open && "bg-muted text-foreground",
        className,
      )}
    >
      <History className="size-4" />
    </button>
  );
}

/** How many entries show before somebody asks for the rest. */
const FIRST = 5;

/** A line's entries, newest first. */
export function HistoryPanel({
  userId,
  field,
  className,
}: {
  userId: string;
  field: HistoryField;
  className?: string;
}) {
  const [entries, setEntries] = React.useState<FieldHistoryEntry[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [all, setAll] = React.useState(false);

  const [version, setVersion] = React.useState(0);
  React.useEffect(() => {
    const again = () => setVersion((was) => was + 1);
    window.addEventListener(STALE, again);
    return () => window.removeEventListener(STALE, again);
  }, []);

  React.useEffect(() => {
    let live = true;
    loadFieldHistory(userId, field).then(
      (result) => {
        if (!live) return;
        if (result.ok) setEntries(result.entries);
        else setError(result.error);
      },
      () => live && setError("The history could not be loaded."),
    );
    return () => {
      live = false;
    };
  }, [userId, field, version]);

  const shown = entries ? (all ? entries : entries.slice(0, FIRST)) : [];

  return (
    <div className={cn("rounded-lg border border-border bg-background/60 p-3", className)}>
      {error ? (
        <p className="text-xs text-danger">{error}</p>
      ) : entries === null ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> Loading history…
        </p>
      ) : entries.length === 0 ? (
        <p className="text-xs text-muted-foreground">No changes yet.</p>
      ) : (
        <ol className="flex flex-col">
          {shown.map((entry) => (
            <HistoryItem key={entry.id} entry={entry} />
          ))}
        </ol>
      )}
      {entries && entries.length > FIRST ? (
        <button
          type="button"
          onClick={() => setAll((was) => !was)}
          className="mt-1 inline-flex min-h-10 items-center text-xs font-medium text-primary hover:underline"
        >
          {all ? "Show fewer" : `Show all ${entries.length} changes`}
        </button>
      ) : null}
    </div>
  );
}

function HistoryItem({ entry }: { entry: FieldHistoryEntry }) {
  return (
    <li className="relative flex flex-col gap-1 border-l border-border pb-4 pl-4 last:pb-0">
      <span
        aria-hidden
        className="absolute -left-[5px] top-1.5 size-2.5 rounded-full bg-muted-foreground/40 ring-2 ring-surface"
      />
      <div className="text-xs text-muted-foreground">{entry.at}</div>
      <div className="text-sm font-medium">{entry.action}</div>
      {entry.list ? (
        <ListLine list={entry.list} />
      ) : entry.from || entry.to ? (
        <div className="flex flex-wrap items-center gap-1.5 text-sm">
          {entry.from ? <s className="text-muted-foreground">{entry.from}</s> : null}
          {entry.from && entry.to ? (
            <ArrowRight aria-label="to" className="size-3.5 shrink-0 text-muted-foreground" />
          ) : null}
          {entry.to ? <span>{entry.to}</span> : null}
        </div>
      ) : null}
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-xs">
        <Fact label="Requested" value={entry.requested} />
        <Fact label="By" value={entry.by} />
        <Fact label="Approved By" value={entry.approvedBy} />
        <Fact label="Source" value={entry.source} />
        <Fact label="Reason" value={entry.reason} />
      </dl>
    </li>
  );
}

/** A list before and after: what went struck through, what came in bold. */
function ListLine({ list }: { list: NonNullable<FieldHistoryEntry["list"]> }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-sm">
      {list.from.length > 0 ? (
        <span>
          {list.from.map((item, index) => (
            <React.Fragment key={item.text}>
              {index > 0 ? ", " : null}
              {item.gone ? <s className="text-muted-foreground">{item.text}</s> : item.text}
            </React.Fragment>
          ))}
        </span>
      ) : null}
      {list.from.length > 0 && list.to.length > 0 ? (
        <ArrowRight aria-label="to" className="size-3.5 shrink-0 text-muted-foreground" />
      ) : null}
      {list.to.length > 0 ? (
        <span>
          {list.to.map((item, index) => (
            <React.Fragment key={item.text}>
              {index > 0 ? ", " : null}
              {item.added ? <strong className="font-semibold">{item.text}</strong> : item.text}
            </React.Fragment>
          ))}
        </span>
      ) : null}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <>
      <dt className="text-muted-foreground">{label}:</dt>
      <dd className="break-words">{value}</dd>
    </>
  );
}

/**
 * Every line's history by name, for a page that does not draw every line —
 * a number since taken off, a name shown only in the header — so nothing
 * recorded is out of reach.
 */
export function HistoryIndex({ lines }: { lines: { field: HistoryField; label: string }[] }) {
  const userId = useHistoryOf();
  const [open, setOpen] = React.useState<HistoryField | null>(null);
  if (!userId) return null;
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
      <div>
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <History className="size-4 text-muted-foreground" /> History by line
        </h2>
        <p className="text-xs text-muted-foreground">
          Every line&rsquo;s history, including lines not shown above.
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {lines.map((line) => (
          <button
            key={line.field}
            type="button"
            aria-expanded={open === line.field}
            onClick={() => setOpen((was) => (was === line.field ? null : line.field))}
            className={cn(
              "inline-flex min-h-10 items-center rounded-md border border-border px-3 text-xs hover:bg-muted sm:min-h-8",
              open === line.field && "bg-muted text-foreground",
            )}
          >
            {line.label}
          </button>
        ))}
      </div>
      {open ? <HistoryPanel key={open} userId={userId} field={open} /> : null}
    </section>
  );
}
