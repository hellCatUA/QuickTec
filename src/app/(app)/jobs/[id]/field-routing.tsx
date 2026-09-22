"use client";

import { AlertTriangle, MessageSquarePlus } from "lucide-react";

/**
 * Where a field is going when Save is pressed, said before it is pressed.
 *
 * A tech on site is the person most likely to find a mistake and least likely
 * to be allowed to fix it, and being told that *after* pressing Save is how
 * people stop reporting mistakes.
 *
 * Shared between the job's details and its schedule, which are two forms over
 * the same fields with the same rules — and one set of words for them, so the
 * same situation is never described two ways.
 */
export type Route = "unchanged" | "direct" | "suggest" | "no";

export function routeOf(input: {
  current: string;
  next: string;
  canEditPlanned: boolean;
  canFillMissing: boolean;
  canSuggest: boolean;
}): Route {
  if (input.current === input.next) return "unchanged";
  if (input.canEditPlanned) return "direct";
  if (input.current === "") return input.canFillMissing ? "direct" : "no";
  return input.canSuggest ? "suggest" : "no";
}

export function Marker({
  field,
  going,
  waiting,
}: {
  field: string;
  going: Route;
  /** What this person already has waiting on a supervisor for this field. */
  waiting?: string;
}) {
  if (going === "suggest") {
    return (
      <span
        data-route={`${field}:suggest`}
        className="flex items-center gap-1 text-xs text-warning"
      >
        <MessageSquarePlus className="size-3.5 shrink-0" />
        Requires approval
      </span>
    );
  }
  if (going === "no") {
    return (
      <span
        data-route={`${field}:no`}
        className="flex items-center gap-1 text-xs text-danger"
      >
        <AlertTriangle className="size-3.5 shrink-0" />
        You cannot change this one
      </span>
    );
  }
  if (waiting) {
    return (
      <span className="text-xs text-muted-foreground">
        Waiting on approval: {waiting}
      </span>
    );
  }
  return null;
}
