"use client";

import { usePathname } from "next/navigation";
import * as React from "react";
import { cn } from "@/lib/utils";
import type { ApprovalsBadge } from "@/lib/waiting";

const BadgeContext = React.createContext<ApprovalsBadge | null>(null);

/**
 * Keeps the Approvals tab's count current for both navigations.
 *
 * Starts from what the server counted when the shell was rendered, and asks
 * again whenever the page changes or the app comes back to the front. The
 * shell itself is not rendered again on those, so without the asking the
 * number would sit at whatever it was on arrival — approve three reports and
 * it still says three.
 *
 * When the server does render the shell again — after an action that
 * revalidates it — its fresh count replaces whatever was fetched.
 */
export function ApprovalsBadgeProvider({
  initial,
  children,
}: {
  initial: ApprovalsBadge | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [badge, setBadge] = React.useState(initial);
  const [seen, setSeen] = React.useState(initial);
  if (initial !== seen) {
    setSeen(initial);
    setBadge(initial);
  }

  const refresh = React.useCallback(() => {
    fetch("/api/waiting", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((next: ApprovalsBadge | null) => {
        if (next) setBadge(next);
      })
      // Offline, or between deploys: the last count stands.
      .catch(() => {});
  }, []);

  // Not on the first render: the server's count is that fresh already.
  const arrived = React.useRef(pathname);
  React.useEffect(() => {
    if (arrived.current === pathname) return;
    arrived.current = pathname;
    refresh();
  }, [pathname, refresh]);

  React.useEffect(() => {
    function onVisible() {
      if (document.visibilityState === "visible") refresh();
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  return <BadgeContext.Provider value={badge}>{children}</BadgeContext.Provider>;
}

export function useApprovalsBadge(): ApprovalsBadge | null {
  return React.useContext(BadgeContext);
}

/** "12", or "99+" — a pill can only be so wide under an icon. */
function countText(count: number): string {
  return count > 99 ? "99+" : String(count);
}

/** What a screen reader hears after the tab's own name. */
export function badgeSpeech(badge: ApprovalsBadge | null): string {
  if (!badge) return "";
  if (badge.decisions > 0) {
    return `, ${badge.decisions} waiting on you`;
  }
  return badge.notices ? ", something new" : "";
}

/**
 * Over the corner of the tab bar's icon: the count of decisions, or a dot
 * when there are none but something new happened to them.
 */
export function IconBadge({ badge }: { badge: ApprovalsBadge | null }) {
  if (!badge) return null;
  if (badge.decisions > 0) {
    return (
      <span
        aria-hidden
        className="tabular absolute -right-2.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-warning px-1 text-[10px] font-semibold leading-none text-warning-foreground ring-2 ring-surface"
      >
        {countText(badge.decisions)}
      </span>
    );
  }
  if (badge.notices) {
    return (
      <span
        aria-hidden
        className="absolute -right-1 -top-0.5 size-2 rounded-full bg-primary ring-2 ring-surface"
      />
    );
  }
  return null;
}

/** At the end of the side navigation's row, where there is room for it. */
export function RowBadge({
  badge,
  className,
}: {
  badge: ApprovalsBadge | null;
  className?: string;
}) {
  if (!badge) return null;
  if (badge.decisions > 0) {
    return (
      <span
        aria-hidden
        className={cn(
          "tabular ml-auto rounded-full bg-warning px-2 py-0.5 text-xs font-semibold text-warning-foreground",
          className,
        )}
      >
        {countText(badge.decisions)}
      </span>
    );
  }
  if (badge.notices) {
    return (
      <span
        aria-hidden
        className={cn("ml-auto size-2 rounded-full bg-primary", className)}
      />
    );
  }
  return null;
}
