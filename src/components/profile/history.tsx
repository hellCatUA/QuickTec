import { History } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { usDateTimeInZone } from "@/lib/datetime";
import type { HistoryEntry, ProfileEventKind } from "@/lib/profile-history";
import { PROFILE_FIELDS, type ProfileField } from "@/lib/profile-privacy";

const KIND: Record<
  ProfileEventKind,
  { label: string; variant: "neutral" | "primary" | "success" | "warning" | "danger" }
> = {
  changed: { label: "Changed", variant: "neutral" },
  requested: { label: "Requested", variant: "warning" },
  withdrawn: { label: "Withdrawn", variant: "neutral" },
  approved: { label: "Approved", variant: "success" },
  denied: { label: "Denied", variant: "danger" },
  imported: { label: "NextCloud", variant: "primary" },
};

function who(entry: HistoryEntry): string {
  const actor = entry.actor ?? (entry.source ? `Imported from ${entry.source}` : "QuickTec");
  switch (entry.kind) {
    case "requested":
      return `Requested by ${actor}`;
    case "withdrawn":
      return `Withdrawn by ${actor}`;
    case "approved":
      return `Approved by ${actor}`;
    case "denied":
      return `Denied by ${actor}`;
    case "imported":
      return entry.actor ? `Imported by ${actor}` : actor;
    default:
      return entry.actor ? `By ${actor}` : actor;
  }
}

/**
 * The history of a profile, newest first: what changed, from what to what,
 * who did it, and what was asked for and how it was answered.
 */
/** How many changes are shown before somebody asks for the rest. */
const RECENT = 10;

export function ProfileHistory({
  entries,
  field,
  all,
  timeZone,
  basePath,
}: {
  entries: HistoryEntry[];
  field: ProfileField | null;
  /** Every change rather than the latest few. */
  all: boolean;
  timeZone: string;
  /** The page this sits on, for the links between views of the history. */
  basePath: string;
}) {
  const shown = field || all ? entries : entries.slice(0, RECENT);
  return (
    <Card id="history" className="scroll-mt-20">
      <CardHeader className="flex-row flex-wrap items-center gap-2">
        <CardTitle className="flex items-center gap-2">
          <History className="size-4 text-muted-foreground" />
          {field ? `History — ${PROFILE_FIELDS[field].label}` : "History"}
        </CardTitle>
        {field ? (
          <Link
            href={`${basePath}#history`}
            scroll={false}
            className="ml-auto text-xs font-medium text-primary hover:underline"
          >
            Every field
          </Link>
        ) : null}
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {field ? "Nothing has changed here yet." : "No changes yet."}
          </p>
        ) : (
          <ol className="flex flex-col">
            {shown.map((entry) => (
              <li
                key={entry.id}
                className="relative flex flex-col gap-1 border-l border-border pb-4 pl-4 last:pb-0"
              >
                <span
                  aria-hidden
                  className="absolute -left-[5px] top-1.5 size-2.5 rounded-full border border-border bg-surface"
                />
                <div className="text-xs text-muted-foreground">
                  {usDateTimeInZone(entry.at, timeZone)}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {entry.fieldLabel}
                  <Badge variant={KIND[entry.kind].variant}>{KIND[entry.kind].label}</Badge>
                </div>
                <div className="text-xs text-foreground/80">
                  {who(entry)}
                  {entry.warned ? (
                    <span className="text-warning">
                      {" "}
                      — not their direct supervisor, past the warning
                    </span>
                  ) : null}
                  {entry.note ? <span>: &ldquo;{entry.note}&rdquo;</span> : null}
                </div>
                {entry.from || entry.to ? (
                  <div className="mt-0.5 rounded-md bg-muted/60 px-2.5 py-1.5 text-xs">
                    {entry.from ? (
                      <>
                        <s className="text-muted-foreground">{entry.from}</s>
                        {entry.to ? " → " : null}
                      </>
                    ) : null}
                    {entry.to ?? (entry.from ? <span className="text-muted-foreground">removed</span> : null)}
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
        )}
        {shown.length < entries.length ? (
          <Link
            href={`${basePath}?history=all#history`}
            scroll={false}
            className="mt-3 inline-block text-xs font-medium text-primary hover:underline"
          >
            Show all {entries.length} changes
          </Link>
        ) : null}
      </CardContent>
    </Card>
  );
}
