"use client";

import { ChevronDown } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * A part of the form that stays shut until somebody needs it.
 *
 * The page was 4,699px at phone width — five and a half screens — with nine
 * cards all open at once, required and optional mixed together, when five
 * fields are all that is needed to create a job. Everything after those five is
 * here.
 *
 * `summary` is what makes closing them safe. A row reading "Schedule & crew"
 * tells you nothing, so you open it to check, and you have paid the scroll
 * anyway; a row reading "Tue 15:00 · 1 tech" answers the question from the
 * closed state. Sections with nothing in them yet say so in the warning colour,
 * which is how the form admits what it is still missing without a modal.
 *
 * A plain <details>, so the browser handles the open state and a section that
 * is open stays open across a re-render — including the one after a refused
 * submit, where being silently collapsed back would hide the field somebody was
 * being asked about.
 */
export function Section({
  title,
  summary,
  tone = "neutral",
  defaultOpen = false,
  children,
}: {
  title: string;
  /** What is already in here, read from the closed row. */
  summary?: string | null;
  tone?: "neutral" | "warning";
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details
      open={defaultOpen}
      className="group rounded-xl border border-border bg-surface shadow-sm"
    >
      <summary
        className={cn(
          "flex min-h-12 cursor-pointer list-none items-center gap-3 p-4",
          "text-sm font-semibold tracking-tight",
          "group-open:border-b group-open:border-border",
          "[&::-webkit-details-marker]:hidden",
        )}
      >
        {title}
        {summary ? (
          <span
            className={cn(
              "ml-auto truncate text-xs font-normal",
              tone === "warning" ? "text-warning" : "text-muted-foreground",
            )}
          >
            {summary}
          </span>
        ) : null}
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            "group-open:rotate-180",
            summary ? "" : "ml-auto",
          )}
        />
      </summary>
      <div className="p-4">{children}</div>
    </details>
  );
}
