"use client";

import { Loader2, RefreshCw } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { runPayrollForWeek } from "./actions";

/**
 * One button for the whole week.
 *
 * Building used to be a per-person form buried in an empty state, so closing a
 * week meant visiting everybody to find out whether there was anything to
 * close. The unit of work is the week, so the unit of the button is too.
 */
export function BuildWeekButton({
  week,
  count,
}: {
  week: string;
  count: number;
}) {
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  return (
    <div className="flex flex-col gap-1.5">
      <Button
        type="button"
        className="w-full"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const formData = new FormData();
            formData.set("week", week);
            const result = await runPayrollForWeek(formData);
            if (!result.ok) setError(result.error);
          });
        }}
      >
        {pending ? (
          <Loader2 className="animate-spin" />
        ) : (
          <RefreshCw className="size-4" />
        )}
        Build the whole week
        {count > 0 ? ` (${count} to go)` : ""}
      </Button>
      {error ? <p className="text-xs text-danger">{error}</p> : null}
    </div>
  );
}
