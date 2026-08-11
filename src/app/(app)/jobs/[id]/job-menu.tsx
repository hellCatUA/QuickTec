"use client";

import { CircleCheck, MoreHorizontal, Repeat, SlidersHorizontal, X } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { Button } from "@/components/ui/button";

export type JobMenuItem = {
  href: string;
  label: string;
  hint: string;
  icon: "portal" | "revisit" | "approval";
};

const ICONS = {
  portal: SlidersHorizontal,
  revisit: Repeat,
  approval: CircleCheck,
} as const;

/**
 * Where the things done *to* a job are chosen from.
 *
 * It used to be the drawer that held them, and on a phone the page behind it
 * scrolled as often as the drawer did — an overlay over a long page is a fight
 * between two scroll containers, and the finger usually loses. So this is now a
 * short list of destinations and nothing else: everything it points at is a
 * page, with its own address and a Back that works.
 */
export function JobMenu({ items }: { items: JobMenuItem[] }) {
  const [open, setOpen] = React.useState(false);

  if (items.length === 0) return null;

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Job settings"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <MoreHorizontal />
      </Button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-label="Job settings"
          onClick={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          {/* Short enough that it never scrolls, which is the whole point. */}
          <div className="w-full max-w-lg rounded-t-2xl border border-border bg-surface p-4 sm:rounded-2xl">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold">Job settings</h2>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Close job settings"
                onClick={() => setOpen(false)}
              >
                <X />
              </Button>
            </div>

            <div className="flex flex-col gap-2">
              {items.map((item) => {
                const Icon = ICONS[item.icon];
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="flex items-start gap-3 rounded-lg border border-border p-3 hover:border-primary/50"
                    onClick={() => setOpen(false)}
                  >
                    <Icon className="mt-0.5 size-4 shrink-0 text-[var(--color-primary)]" />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">
                        {item.label}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {item.hint}
                      </span>
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
