"use client";

import { Tag } from "lucide-react";
import * as React from "react";
import { Input } from "@/components/ui/field";
import { MAX_PHOTO_LABEL } from "@/lib/photo-label";

/**
 * Where a photo's label is typed — or picked from the ones already used on
 * this job.
 *
 * Not a list kept anywhere: the labels on the job's photos are the list, so
 * one written once is offered for the next photo and nothing outside the job
 * ever sees it. Tapping one fills it in; typing something new is just as
 * good, and becomes one of them.
 */
export function PhotoLabelInput({
  id,
  value,
  labels,
  disabled,
  autoFocus,
  onChange,
  onEnter,
}: {
  id: string;
  value: string;
  /** The labels already on this job's photos. */
  labels: string[];
  disabled?: boolean;
  autoFocus?: boolean;
  onChange: (value: string) => void;
  onEnter?: () => void;
}) {
  const typed = value.trim().toLowerCase();
  const offered = labels
    .filter(
      (label) =>
        label.toLowerCase() !== typed &&
        (!typed || label.toLowerCase().includes(typed)),
    )
    .slice(0, 12);

  return (
    <div className="flex flex-col gap-2">
      <Input
        id={id}
        value={value}
        maxLength={MAX_PHOTO_LABEL}
        disabled={disabled}
        autoFocus={autoFocus}
        autoComplete="off"
        placeholder="Damaged port"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && onEnter) {
            event.preventDefault();
            onEnter();
          }
        }}
      />
      {offered.length > 0 ? (
        <div
          role="group"
          aria-label="Labels used on this job"
          className="flex flex-wrap gap-1.5"
        >
          {offered.map((label) => (
            <button
              key={label}
              type="button"
              disabled={disabled}
              aria-label={`Use the label ${label}`}
              onClick={() => onChange(label)}
              className="flex min-h-8 items-center gap-1 rounded-lg px-2.5 text-xs font-semibold ring-1 ring-inset ring-border hover:bg-muted disabled:opacity-50"
            >
              <Tag className="size-3 text-muted-foreground" />
              {label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
