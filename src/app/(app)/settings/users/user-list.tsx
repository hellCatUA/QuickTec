"use client";

import { Search } from "lucide-react";
import * as React from "react";
import { ROLE_LABEL } from "@/lib/profile-format";
import { UserRow, type UserRowData } from "./user-row";

/**
 * Everybody, and a box to find one of them in.
 *
 * The rows are all here whatever is typed — hidden rather than unmounted — so
 * a form opened and half filled in is still half filled in when the search is
 * cleared.
 */
export function UserList({ rows }: { rows: UserRowData[] }) {
  const [query, setQuery] = React.useState("");
  const needle = query.trim().toLowerCase();

  const matches = (row: UserRowData) =>
    needle === "" ||
    [
      row.user.name,
      row.user.email,
      ROLE_LABEL[row.user.baseRole] ?? row.user.baseRole,
      row.supervisorName ?? "",
      row.user.city ?? "",
    ].some((value) => value.toLowerCase().includes(needle));

  const shown = rows.filter(matches).length;
  const found =
    shown === 0 ? "Nobody matches that." : `${shown} of ${rows.length} accounts`;

  return (
    <div className="flex flex-col gap-3">
      {/* Not worth a box for a handful of people; from a screenful up it is
          how anybody is found. */}
      {rows.length > 6 ? (
        <label className="relative block">
          <span className="sr-only">Find an account</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find by name, email, role or supervisor"
            autoComplete="off"
            className="min-h-11 w-full rounded-lg border border-border bg-input pl-9 pr-3 text-foreground placeholder:text-muted-foreground"
          />
        </label>
      ) : null}

      {/* Read out by a region that is always there: a live region only
          speaks up about changes to one that already exists, so one mounted
          with its first message said nothing on the first keystroke. The
          visible line is for the eye only, so it is not read twice. */}
      <p className="sr-only" aria-live="polite">
        {needle === "" ? null : found}
      </p>
      {needle !== "" ? (
        <p className="text-xs text-muted-foreground" aria-hidden>
          {found}
        </p>
      ) : null}

      {rows.map((row) => (
        <div key={row.user.id} hidden={!matches(row)}>
          <UserRow {...row} />
        </div>
      ))}
    </div>
  );
}
