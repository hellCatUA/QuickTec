"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { clockOptions } from "@/lib/time-tracking";

/**
 * "Clock in/out early or later".
 *
 * Offsets are measured from the *snapped* current time, so at 09:57 with
 * five-minute rounding the row reads 09:50 / 09:55 / 10:00 / 10:05 / 10:10
 * rather than a set of off-grid times nobody would recognise.
 *
 * The manual field is a plain time input combined with today's date on the
 * device, which is the site's date — the tech is standing on it. The server
 * snaps and range-checks whatever comes back regardless.
 */
export function ClockPicker({
  intervalMinutes,
  timeLabel,
  onPick,
  onCancel,
  pending,
}: {
  intervalMinutes: number;
  timeLabel: (date: Date) => string;
  onPick: (at: Date) => void;
  onCancel: () => void;
  pending: boolean;
}) {
  // Frozen at open so the buttons do not renumber under a thumb mid-tap.
  const [now] = React.useState(() => new Date());
  const [manual, setManual] = React.useState("");

  const options = clockOptions(now, intervalMinutes);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-raised p-3">
      <div className="grid grid-cols-5 gap-1.5">
        {options.map((option) => (
          <Button
            key={option.offset}
            type="button"
            variant={option.offset === 0 ? "primary" : "secondary"}
            size="sm"
            disabled={pending}
            onClick={() => onPick(option.at)}
            className="flex-col gap-0 px-1 py-1.5"
          >
            <span className="tabular text-xs">{timeLabel(option.at)}</span>
            <span className="text-[10px] opacity-70">
              {option.offset === 0
                ? "now"
                : `${option.offset > 0 ? "+" : ""}${option.offset}`}
            </span>
          </Button>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Or enter a time
          </span>
          <input
            type="time"
            value={manual}
            onChange={(event) => setManual(event.target.value)}
            className="min-h-11 w-full rounded-lg border border-border bg-input px-3"
          />
        </label>

        <Button
          type="button"
          variant="secondary"
          disabled={!manual || pending}
          onClick={() => {
            const [hours, minutes] = manual.split(":").map(Number);
            const at = new Date();
            at.setHours(hours, minutes, 0, 0);
            onPick(at);
          }}
        >
          Use
        </Button>

        <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
