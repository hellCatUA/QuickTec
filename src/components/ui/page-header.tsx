import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  backHref,
  actions,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  backHref?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start gap-3", className)}>
      {backHref ? (
        <Link
          href={backHref}
          aria-label="Back"
          className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ChevronLeft className="size-5" />
        </Link>
      ) : null}

      {/* The title asks for ten rem before it will share the row. Without
          that, two buttons beside it on a phone left it a column one word
          wide — "Starbucks / POS / refresh / 2026" down the screen — where
          dropping the buttons to their own line costs nothing. Ten and not
          more: one button still has to fit beside it at 320px, which is any
          phone with its display set to larger text, or the job's ⋯ menu
          lands on a line of its own under the title. */}
      <div className="min-w-0 flex-1 basis-40">
        <h1 className="text-lg font-semibold">{title}</h1>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>

      {actions ? (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border p-8 text-center">
      <p className="text-sm font-medium">{title}</p>
      {description ? (
        <p className="max-w-sm text-xs text-muted-foreground">{description}</p>
      ) : null}
      {children}
    </div>
  );
}
