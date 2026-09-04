"use client";

import { Loader2, Undo2, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { resubmitReport } from "../actions";

/**
 * What the reviewer said, at the top of the job it is about.
 *
 * A report sent back with the reason buried in a notification is a report that
 * comes back unchanged: the notification is read on a phone in a van, and by
 * the time somebody opens the job they are looking for what to fix and it is
 * not there. So it sits above the work, in the reviewer's own words, until the
 * crew resubmit.
 *
 * A rejection shows the same way and has no button. There is nothing to send:
 * the job is over, and what is left is the record of why.
 */
export function SentBack({
  jobId,
  rejected,
  reason,
  who,
  when,
  canResubmit,
}: {
  jobId: string;
  rejected: boolean;
  reason: string;
  who: string | null;
  when: string | null;
  canResubmit: boolean;
}) {
  const router = useRouter();
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function resubmit() {
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("jobId", jobId);
      const result = await resubmitReport(formData);
      if (!result.ok) return setError(result.error);
      router.refresh();
    });
  }

  return (
    <div
      data-sent-back={rejected ? "rejected" : "changes"}
      className={`flex flex-col gap-2 rounded-lg border p-3 ${
        rejected ? "border-danger/50 bg-danger/5" : "border-warning/50 bg-warning/5"
      }`}
    >
      <div className="flex items-center gap-2 text-sm font-semibold">
        {rejected ? (
          <XCircle className="size-4 text-danger" />
        ) : (
          <Undo2 className="size-4 text-warning" />
        )}
        {rejected ? "Report rejected" : "Sent back for changes"}
      </div>

      <p className="whitespace-pre-wrap text-sm">{reason}</p>

      {who || when ? (
        <p className="text-xs text-muted-foreground">
          {[who, when].filter(Boolean).join(" · ")}
        </p>
      ) : null}

      {error ? <p className="text-sm text-danger">{error}</p> : null}

      {!rejected && canResubmit ? (
        <div className="flex flex-col gap-1">
          <Button
            type="button"
            size="sm"
            className="self-start"
            disabled={pending}
            onClick={resubmit}
          >
            {pending ? <Loader2 className="animate-spin" /> : null}
            Send back for review
          </Button>
          <p className="text-xs text-muted-foreground">
            Fix what is above first. This puts the job back in their queue and
            clears this notice.
          </p>
        </div>
      ) : null}
    </div>
  );
}
