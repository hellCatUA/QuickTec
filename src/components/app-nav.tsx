"use client";

import { MoreHorizontal } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ICONS, type NavItem } from "@/components/nav-icons";
import { cn } from "@/lib/utils";

/** How many tabs fit on a 375px phone before the labels start colliding. */
const MOBILE_TAB_LIMIT = 5;

function useIsActive() {
  const pathname = usePathname();
  return (href: string) =>
    href === "/dashboard" ? pathname === href : pathname.startsWith(href);
}

/** Left rail on tablet and desktop, where everything fits. */
export function SideNav({ items }: { items: NavItem[] }) {
  const isActive = useIsActive();

  return (
    <nav className="hidden w-56 shrink-0 flex-col gap-1 border-r border-border bg-surface p-3 md:flex">
      {items.map((item) => {
        const Icon = NAV_ICONS[item.icon];
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors",
              isActive(item.href)
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className="size-4 shrink-0" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Bottom tab bar on phones. A manager has six destinations and a phone has
 * room for five, so anything past the fourth collapses into More rather than
 * shrinking every tab into an unhittable sliver.
 */
export function BottomNav({ items }: { items: NavItem[] }) {
  const isActive = useIsActive();

  const overflows = items.length > MOBILE_TAB_LIMIT;
  const visible = overflows ? items.slice(0, MOBILE_TAB_LIMIT - 1) : items;
  const overflowItems = overflows ? items.slice(MOBILE_TAB_LIMIT - 1) : [];

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-surface md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {visible.map((item) => {
        const Icon = NAV_ICONS[item.icon];
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex flex-1 flex-col items-center justify-center gap-1 py-2 text-[10px] font-medium transition-colors",
              isActive(item.href) ? "text-primary" : "text-muted-foreground",
            )}
          >
            <Icon className="size-5" />
            {item.label}
          </Link>
        );
      })}

      {overflows ? (
        <Link
          href="/more"
          className={cn(
            "flex flex-1 flex-col items-center justify-center gap-1 py-2 text-[10px] font-medium transition-colors",
            overflowItems.some((item) => isActive(item.href)) ||
              isActive("/more")
              ? "text-primary"
              : "text-muted-foreground",
          )}
        >
          <MoreHorizontal className="size-5" />
          More
        </Link>
      ) : null}
    </nav>
  );
}
