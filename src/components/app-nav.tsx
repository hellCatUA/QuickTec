"use client";

import {
  Car,
  ClipboardList,
  LayoutDashboard,
  Settings,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export type NavItem = {
  href: string;
  label: string;
  icon: "dashboard" | "jobs" | "mileage" | "pay" | "settings";
};

const ICONS = {
  dashboard: LayoutDashboard,
  jobs: ClipboardList,
  mileage: Car,
  pay: Wallet,
  settings: Settings,
} as const;

function useIsActive() {
  const pathname = usePathname();
  return (href: string) =>
    href === "/dashboard" ? pathname === href : pathname.startsWith(href);
}

/** Left rail on tablet and desktop. */
export function SideNav({ items }: { items: NavItem[] }) {
  const isActive = useIsActive();

  return (
    <nav className="hidden w-56 shrink-0 flex-col gap-1 border-r border-border bg-surface p-3 md:flex">
      {items.map((item) => {
        const Icon = ICONS[item.icon];
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

/** Bottom tab bar on phones, sized for thumbs and clear of the home indicator. */
export function BottomNav({ items }: { items: NavItem[] }) {
  const isActive = useIsActive();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-surface md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {items.map((item) => {
        const Icon = ICONS[item.icon];
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex flex-1 flex-col items-center justify-center gap-1 py-2 text-[10px] font-medium transition-colors",
              isActive(item.href)
                ? "text-primary"
                : "text-muted-foreground",
            )}
          >
            <Icon className="size-5" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
