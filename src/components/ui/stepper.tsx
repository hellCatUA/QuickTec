"use client";

import { Minus, Plus } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * A small whole number, set by thumb.
 *
 * A number input on a phone opens the numeric keypad over the form and then
 * has to be dismissed — for "how many techs" that is three interactions to
 * move from 1 to 2. Presets cover the usual answers and the arrows cover the
 * rest.
 */
export function Stepper({
  name,
  value,
  onChange,
  min = 1,
  max = 20,
  presets = [],
  suffix,
}: {
  name?: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  presets?: number[];
  suffix?: string;
}) {
  const clamp = (next: number) => Math.min(max, Math.max(min, next));

  return (
    <div className="flex flex-wrap items-center gap-2">
      {name ? <input type="hidden" name={name} value={value} /> : null}

      <div className="flex items-center gap-1 rounded-lg border border-border bg-input p-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="One fewer"
          disabled={value <= min}
          onClick={() => onChange(clamp(value - 1))}
        >
          <Minus />
        </Button>

        <span className="tabular min-w-12 text-center text-base font-medium">
          {value}
          {suffix ? (
            <span className="ml-1 text-xs text-muted-foreground">{suffix}</span>
          ) : null}
        </span>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="One more"
          disabled={value >= max}
          onClick={() => onChange(clamp(value + 1))}
        >
          <Plus />
        </Button>
      </div>

      {presets.map((preset) => (
        <Button
          key={preset}
          type="button"
          size="sm"
          variant={value === preset ? "primary" : "secondary"}
          onClick={() => onChange(clamp(preset))}
          className={cn("tabular")}
        >
          {preset}
          {suffix ? <span className="ml-0.5 text-xs">{suffix}</span> : null}
        </Button>
      ))}
    </div>
  );
}

const HOUR_PRESETS = [1, 2, 4, 8];

/**
 * An estimate in hours, stored in minutes.
 *
 * Nobody plans a job in minutes — they say "half a day". Quarter-hour steps
 * keep the odd 1.5 reachable without turning it into a text field.
 */
export function HoursPicker({
  name,
  minutes,
  onChange,
}: {
  name: string;
  minutes: number | null;
  onChange: (minutes: number | null) => void;
}) {
  const hours = minutes === null ? null : minutes / 60;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input type="hidden" name={name} value={minutes ?? ""} />

      <div className="flex items-center gap-1 rounded-lg border border-border bg-input p-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Fifteen minutes less"
          disabled={minutes === null || minutes <= 15}
          onClick={() => onChange(Math.max(15, (minutes ?? 60) - 15))}
        >
          <Minus />
        </Button>

        <span className="tabular min-w-20 text-center text-base font-medium">
          {hours === null ? (
            <span className="text-sm text-muted-foreground">not set</span>
          ) : (
            <>
              {Number.isInteger(hours) ? hours : hours.toFixed(2)}
              <span className="ml-1 text-xs text-muted-foreground">hrs</span>
            </>
          )}
        </span>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Fifteen minutes more"
          onClick={() => onChange(Math.min(60 * 24, (minutes ?? 0) + 15))}
        >
          <Plus />
        </Button>
      </div>

      {HOUR_PRESETS.map((preset) => (
        <Button
          key={preset}
          type="button"
          size="sm"
          variant={minutes === preset * 60 ? "primary" : "secondary"}
          onClick={() => onChange(preset * 60)}
        >
          {preset}h
        </Button>
      ))}

      {minutes !== null ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => onChange(null)}
        >
          Clear
        </Button>
      ) : null}
    </div>
  );
}
