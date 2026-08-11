"use client";

import { AlertTriangle, CircleCheck, Info, Loader2 } from "lucide-react";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useRouter } from "next/navigation";
import type { ReviewFlag } from "@/lib/job-review";
import { approveReport } from "../actions";

export type ReviewStep = {
  key: "times" | "deliverables" | "reimbursements" | "work";
  title: string;
  /** What the reviewer is actually looking at, in plain rows. */
  rows: { label: string; value: string }[];
  flags: ReviewFlag[];
};

/**
 * Signing a job off, one pass at a time.
 *
 * The button on its own asked somebody to vouch for a day they did not see, and
 * the only possible answer was yes. This walks the four things that go wrong —
 * the clock, what was produced, what is being paid back, and what the client is
 * about to be told — with the things that do not look right already found and
 * put in front of them.
 *
 * Nothing here refuses. A late start is usually the site's fault and a long day
 * is usually real work; the reviewer is the one who knows which, and this exists
 * so they are looking at it rather than so it decides for them. Anything they
 * disagree with they can still change on the page below and come back.
 */
export function JobReview({
  jobId,
  steps,
}: {
  jobId: string;
  steps: ReviewStep[];
}) {
  const router = useRouter();
  const [index, setIndex] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const step = steps[index];
  const last = index === steps.length - 1;

  function approve() {
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("jobId", jobId);

      const result = await approveReport(formData);
      if (!result.ok) return setError(result.error);
      // Back to the job, which now says Approved. Staying here would show a
      // read-through of something already decided.
      router.push(`/jobs/${jobId}`);
    });
  }

  return (
    <Card className="border-primary/50">
      <CardHeader>
        <CardTitle>Review before approving</CardTitle>
        <CardDescription>
          Step {index + 1} of {steps.length} · {step.title}
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {/* All four along the top, so it is obvious from the first screen
            whether anything further on needs attention. */}
        <div className="flex flex-wrap gap-1.5">
          {steps.map((one, position) => {
            const level = one.flags.some((flag) => flag.level === "warn")
              ? "warning"
              : one.flags.length > 0
                ? "neutral"
                : "success";

            return (
              <Button
                key={one.key}
                type="button"
                size="sm"
                variant={position === index ? "primary" : "ghost"}
                onClick={() => setIndex(position)}
              >
                <Badge variant={level}>
                  {level === "warning" ? (
                    <AlertTriangle className="size-3" />
                  ) : level === "neutral" ? (
                    <Info className="size-3" />
                  ) : (
                    <CircleCheck className="size-3" />
                  )}
                </Badge>
                {one.title}
              </Button>
            );
          })}
        </div>

        {error ? <p className="text-sm text-danger">{error}</p> : null}

        <div
          data-review-step={step.key}
          className="flex flex-col gap-2 rounded-lg border border-border p-3"
        >
          {step.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing recorded.</p>
          ) : (
            step.rows.map((row) => (
              <div
                key={`${row.label}-${row.value}`}
                className="flex flex-wrap items-baseline justify-between gap-2 text-sm"
              >
                <span className="text-muted-foreground">{row.label}</span>
                <span className="min-w-0 whitespace-pre-wrap text-right">
                  {row.value}
                </span>
              </div>
            ))
          )}

          {step.flags.length > 0 ? (
            <div className="flex flex-col gap-1 border-t border-border pt-2">
              {step.flags.map((flag) => (
                <p
                  key={flag.text}
                  className={`flex items-start gap-1.5 text-xs ${
                    flag.level === "warn" ? "text-warning" : "text-muted-foreground"
                  }`}
                >
                  {flag.level === "warn" ? (
                    <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                  ) : (
                    <Info className="mt-0.5 size-3 shrink-0" />
                  )}
                  {flag.text}
                </p>
              ))}
            </div>
          ) : (
            <p className="flex items-center gap-1.5 border-t border-border pt-2 text-xs text-success">
              <CircleCheck className="size-3" /> Nothing looks out of place.
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {index > 0 ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => setIndex(index - 1)}
            >
              Back
            </Button>
          ) : null}

          {last ? (
            <Button
              type="button"
              variant="success"
              disabled={pending}
              onClick={approve}
            >
              {pending ? <Loader2 className="animate-spin" /> : <CircleCheck />}
              Approve report
            </Button>
          ) : (
            <Button type="button" onClick={() => setIndex(index + 1)}>
              Looks right
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
