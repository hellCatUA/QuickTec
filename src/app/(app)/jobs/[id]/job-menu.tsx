"use client";

import { MoreHorizontal, X } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";

/**
 * The things done to a job rather than on it.
 *
 * Pay, a revisit and correcting a clock are all rare, all consequential, and
 * none of them belong in the scroll a tech reads standing on site — they had a
 * card each, between the work and the photos. One menu, opened by the people
 * who ever need it.
 *
 * Each item carries its own right: leading a job is enough to fix a clock and
 * not enough to change what it pays.
 */
export function JobMenu({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);

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
          {/* Anchored to the bottom on a phone, where a thumb is, and centred
              on anything wider. */}
          <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-border bg-surface p-4 sm:rounded-2xl">
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

            <div className="flex flex-col gap-4">{children}</div>
          </div>
        </div>
      ) : null}
    </>
  );
}

/** One titled thing inside the menu, so the sections read apart. */
export function JobMenuSection({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2 border-t border-border pt-3 first:border-t-0 first:pt-0">
      <div>
        <h3 className="text-sm font-medium">{title}</h3>
        {hint ? (
          <p className="text-xs text-muted-foreground">{hint}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}
