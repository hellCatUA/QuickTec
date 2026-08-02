"use client";

import { ChevronDown, CircleUser, LogOut, Settings } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Who you are signed in as, and the three things you do about it.
 *
 * A bare sign-out icon in the corner is one mis-tap from ending somebody's
 * shift, and it was the only route to the account page besides knowing the
 * URL. Sign out is still here, at the bottom, behind a deliberate open.
 */
export function AccountMenu({
  name,
  role,
  canManageSettings,
  signOutAction,
}: {
  name: string;
  role: string;
  canManageSettings: boolean;
  /** A server action: the sign-out has to happen on the server. */
  signOutAction: () => Promise<void>;
}) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "?";

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account"
        className={cn(
          "flex min-h-11 items-center gap-2 rounded-lg px-2 transition-colors hover:bg-muted",
          open && "bg-muted",
        )}
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
          {initials}
        </span>
        <span className="hidden text-left sm:block">
          <span className="block text-xs font-medium leading-tight">{name}</span>
          <span className="block text-[10px] leading-tight text-muted-foreground">
            {role}
          </span>
        </span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-1 w-56 overflow-hidden rounded-lg border border-border bg-surface-raised shadow-lg"
        >
          <div className="border-b border-border px-3 py-2 sm:hidden">
            <div className="text-sm font-medium">{name}</div>
            <div className="text-xs text-muted-foreground">{role}</div>
          </div>

          <Link
            href="/account"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex min-h-11 items-center gap-2 px-3 text-sm hover:bg-muted"
          >
            <CircleUser className="size-4 shrink-0 text-muted-foreground" />
            Your profile
          </Link>

          {canManageSettings ? (
            <Link
              href="/settings"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex min-h-11 items-center gap-2 px-3 text-sm hover:bg-muted"
            >
              <Settings className="size-4 shrink-0 text-muted-foreground" />
              Settings
            </Link>
          ) : null}

          <form action={signOutAction} className="border-t border-border">
            <button
              type="submit"
              role="menuitem"
              className="flex min-h-11 w-full items-center gap-2 px-3 text-left text-sm text-danger hover:bg-muted"
            >
              <LogOut className="size-4 shrink-0" />
              Sign out
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
