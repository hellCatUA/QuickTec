"use client";

import { MoreHorizontal } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

export type RowMenuItem = {
  label: string;
  onSelect: () => void;
  tone?: "default" | "danger";
  /** Asked before it runs. For anything that cannot be undone. */
  confirm?: string;
};

/**
 * The little menu on a row that has been filled in.
 *
 * Contacts and numbers are taken down at a desk from somebody speaking, and a
 * wrong digit is the ordinary case. Until now a row carried a cross and
 * nothing else, so the only way to correct one was to delete it and type the
 * whole thing again — which on a MOD/POC throws away the signature attached to
 * them.
 *
 * A menu rather than two buttons: on a phone a row already holds a name, a
 * number, an address and a role, and two more targets at the end of it is how
 * somebody deletes a contact while meaning to edit it.
 */
export function RowMenu({
  items,
  label,
  disabled,
  className,
}: {
  items: RowMenuItem[];
  /** Named for a screen reader: several of these sit in one list. */
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const root = React.useRef<HTMLDivElement>(null);

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

  return (
    <div ref={root} className={cn("relative", className)}>
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={disabled}
        onClick={() => setOpen((was) => !was)}
        className={cn(
          "flex size-9 items-center justify-center rounded-lg",
          "text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
          "disabled:pointer-events-none disabled:opacity-50",
        )}
      >
        <MoreHorizontal className="size-4" />
      </button>

      {open ? (
        <div
          role="menu"
          aria-label={label}
          // Right-aligned: the button lives at the end of its row, and a menu
          // hanging off the left edge of it would run off a phone.
          className={cn(
            "absolute right-0 z-50 mt-1 min-w-36 overflow-hidden rounded-lg",
            "border border-border bg-surface-raised shadow-lg",
          )}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                if (item.confirm && !window.confirm(item.confirm)) return;
                item.onSelect();
              }}
              className={cn(
                "flex min-h-11 w-full items-center px-3 text-left text-sm hover:bg-muted",
                item.tone === "danger" ? "text-danger" : "text-foreground",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
