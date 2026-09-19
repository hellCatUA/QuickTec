"use client";

import { MoreHorizontal } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";
import { NAV_ICONS, splitNav, type NavItem } from "@/components/nav-icons";
import { cn } from "@/lib/utils";

function useIsActive() {
  const pathname = usePathname();
  return (href: string) =>
    href === "/dashboard" ? pathname === href : pathname.startsWith(href);
}

function subscribeToViewport(onChange: () => void) {
  const viewport = window.visualViewport;
  if (!viewport) return () => {};

  viewport.addEventListener("resize", onChange);
  viewport.addEventListener("scroll", onChange);
  return () => {
    viewport.removeEventListener("resize", onChange);
    viewport.removeEventListener("scroll", onChange);
  };
}

/**
 * Whether an on-screen keyboard is covering the bottom of the screen.
 *
 * `position: fixed` anchors to the layout viewport, and an on-screen keyboard
 * does not always shrink it — iOS never does, and Chrome only does when asked
 * (the `interactiveWidget` setting in the root layout is that ask). The bar
 * then sits at the bottom of a viewport that is no longer the bottom of the
 * screen, which is how a tab bar ends up floating across the middle of a page.
 *
 * Zoom is deliberately left on, for photos and serial numbers, and pinching in
 * shrinks the visual viewport in exactly the same way. `scale` is what tells
 * the two apart; without that guard the bar would vanish every time somebody
 * zoomed into a label.
 *
 * 150px because a keyboard is 250–350 and nothing else down there is that
 * tall: a collapsing browser toolbar moves both viewports together and leaves
 * this difference at zero.
 */
function useKeyboardOpen(): boolean {
  return React.useSyncExternalStore(
    subscribeToViewport,
    () => {
      const viewport = window.visualViewport;
      if (!viewport || viewport.scale > 1.05) return false;
      return window.innerHeight - viewport.height > 150;
    },
    // Rendered on the server, where there is no keyboard and no viewport.
    () => false,
  );
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
 * Bottom tab bar on phones: four destinations and More, always.
 *
 * The split is fixed rather than an overflow of whatever the user happens to
 * have permission for — muscle memory is most of what a tab bar is for, and a
 * bar that changes shape between two people looking at the same phone is worse
 * than one tap more.
 */
export function BottomNav({ items }: { items: NavItem[] }) {
  const isActive = useIsActive();
  const keyboardOpen = useKeyboardOpen();

  const { primary: visible, overflow: overflowItems } = splitNav(items);
  const overflows = overflowItems.length > 0;

  return (
    <nav
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-surface md:hidden",
        // Out of the way while somebody is typing, rather than stranded
        // wherever the keyboard left the bottom of the viewport. Nobody
        // navigates mid-sentence, and the field gets the room.
        keyboardOpen && "hidden",
      )}
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
