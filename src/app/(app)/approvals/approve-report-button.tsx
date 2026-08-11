"use client";

import { CircleCheck, Loader2 } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { approveReport } from "../jobs/actions";

/**
 * Approving from the queue.
 *
 * A client component rather than an inline server action because the action can
 * refuse — the job was signed off in another tab, or it is not this person's to
 * approve — and an inline action threw that answer away. The row stayed put
 * with nothing said, so the only feedback was pressing it again.
 */
export function ApproveReportButton({ jobId }: { jobId: string }) {
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  return (
    <div className="flex flex-col items-end gap-1">
      {error ? <span className="text-xs text-danger">{error}</span> : null}
      <Button
        type="button"
        size="sm"
        variant="success"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const formData = new FormData();
            formData.set("jobId", jobId);
            const result = await approveReport(formData);
            if (!result.ok) setError(result.error);
          });
        }}
      >
        {pending ? <Loader2 className="animate-spin" /> : <CircleCheck />}
        Approve
      </Button>
    </div>
  );
}
