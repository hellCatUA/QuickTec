"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { setBreakPaid } from "./actions";

/**
 * Whether breaks on this job are paid.
 *
 * It arrives from the project, which is right almost always — and wrong often
 * enough that being unable to change it means somebody is paid incorrectly.
 * Changing it here rewrites the break periods already recorded against the
 * job as well, because a break that was logged unpaid and is now paid has to
 * reach payroll as paid; leaving the old rows alone would show the new
 * setting on screen and pay the old one.
 */
export function BreakPay({
  jobId,
  paid,
  canChange,
}: {
  jobId: string;
  paid: boolean;
  canChange: boolean;
}) {
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function set(next: boolean) {
    if (next === paid) return;
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("jobId", jobId);
      formData.set("paid", String(next));
      const result = await setBreakPaid(formData);
      if (!result.ok) setError(result.error ?? "That did not work.");
    });
  }

  if (!canChange) {
    return (
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Breaks</span>
        <span className="text-sm">{paid ? "Paid" : "Unpaid"}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">Breaks</span>
      <div
        role="radiogroup"
        aria-label="Breaks"
        className="flex w-fit gap-1 rounded-lg border border-border bg-input p-1"
      >
        {[
          { value: true, label: "Paid" },
          { value: false, label: "Unpaid" },
        ].map((option) => (
          <Button
            key={option.label}
            type="button"
            role="radio"
            aria-checked={paid === option.value}
            size="sm"
            variant={paid === option.value ? "primary" : "ghost"}
            disabled={pending}
            onClick={() => set(option.value)}
          >
            {option.label}
          </Button>
        ))}
      </div>
      <span className="text-xs text-muted-foreground">
        Inherited from the project. Changing it also changes the breaks already
        logged on this job.
      </span>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
    </div>
  );
}
