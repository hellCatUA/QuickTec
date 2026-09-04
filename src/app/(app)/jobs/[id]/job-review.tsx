"use client";

import {
  AlertTriangle,
  CircleCheck,
  Info,
  Loader2,
  RotateCcw,
  Undo2,
  XCircle,
} from "lucide-react";
import { useRouter } from "next/navigation";
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
import type { ReviewFlag } from "@/lib/job-review";
import {
  approveReport,
  confirmReviewStep,
  rejectReport,
  sendBackReport,
} from "../actions";
import { Punches, type Punch } from "./manage/punches";

export type ReviewStep = {
  key: "times" | "deliverables" | "reimbursements" | "work";
  title: string;
  /** What the reviewer is actually looking at, in plain rows. */
  rows: { label: string; value: string; missing?: boolean }[];
  flags: ReviewFlag[];
  /** Photos and receipts, so a count can be disbelieved. */
  images: { id: string; label: string }[];
  /** Signed off already, against the findings as they stand now. */
  checked: boolean;
  /** Signed off against findings that have since changed. */
  stale: boolean;
  note: string | null;
  checkedBy: string | null;
  checkedAt: string | null;
};

type Outcome = "back" | "reject";

/**
 * Signing a job off, one pass at a time.
 *
 * The button on its own asked somebody to vouch for a day they did not see, and
 * the only possible answer was yes. This walks the four things that go wrong —
 * the clock, what was produced, what is being paid back, and what the client is
 * about to be told — with the things that do not look right already found and
 * put in front of them.
 *
 * Three changes from the version that was only a slideshow. Each pass is ticked
 * and the tick is recorded, so a review survives a phone going to sleep and so
 * that months later there is an answer to who looked at this. A pass with a
 * warning on it costs a sentence to get past. And there are two ways out other
 * than yes, because a read-through that can only approve is not a
 * read-through — it is a formality with extra steps.
 *
 * Nothing here refuses on the reviewer's behalf. A late start is usually the
 * site's fault and a long day is usually real work; they are the one who knows
 * which. The job is to make sure they are looking at it.
 */
export function JobReview({
  jobId,
  steps,
  punches,
  companyName,
}: {
  jobId: string;
  steps: ReviewStep[];
  /** The crew's clocks, editable in place. Empty where they may not be shown. */
  punches: Punch[];
  companyName: string;
}) {
  const router = useRouter();

  // Opens on the first pass still wanting attention rather than always at the
  // start, so coming back to a half-finished review lands where it was left.
  const [index, setIndex] = React.useState(() => {
    const next = steps.findIndex((one) => !one.checked);
    return next === -1 ? 0 : next;
  });
  const [notes, setNotes] = React.useState<Record<string, string>>(() =>
    Object.fromEntries(steps.map((one) => [one.key, one.note ?? ""])),
  );
  const [outcome, setOutcome] = React.useState<Outcome | null>(null);
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const step = steps[index];
  const last = index === steps.length - 1;
  const outstanding = steps.filter((one) => !one.checked);
  const warns = step.flags.filter((flag) => flag.level === "warn");

  function run(work: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await work();
      if (!result.ok) return setError(result.error ?? "That did not work.");
      after?.();
      router.refresh();
    });
  }

  function confirm() {
    const formData = new FormData();
    formData.set("jobId", jobId);
    formData.set("step", step.key);
    formData.set("note", notes[step.key] ?? "");
    run(
      () => confirmReviewStep(formData),
      () => {
        // Straight on to the next thing that still needs looking at, which is
        // almost never simply the next one along by the end of a review.
        const next = steps.findIndex(
          (one, position) => position !== index && !one.checked,
        );
        if (next !== -1) setIndex(next);
      },
    );
  }

  function approve() {
    const formData = new FormData();
    formData.set("jobId", jobId);
    run(
      () => approveReport(formData),
      () => router.push(`/jobs/${jobId}`),
    );
  }

  function decide(which: Outcome) {
    const formData = new FormData();
    formData.set("jobId", jobId);
    formData.set("reason", reason);
    run(
      () => (which === "back" ? sendBackReport : rejectReport)(formData),
      () => router.push(`/jobs/${jobId}`),
    );
  }

  return (
    <Card className="border-primary/50">
      <CardHeader>
        <CardTitle>Review before approving</CardTitle>
        <CardDescription>
          {outstanding.length === 0
            ? "All four passes done. Approve, or send it back."
            : `${outstanding.length} of ${steps.length} still to go through.`}
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {/* All four along the top, so it is obvious from the first screen
            whether anything further on needs attention — and which passes have
            already been signed off. */}
        <div className="flex flex-wrap gap-1.5">
          {steps.map((one, position) => {
            const level = one.checked
              ? "success"
              : one.stale
                ? "warning"
                : one.flags.some((flag) => flag.level === "warn")
                  ? "warning"
                  : one.flags.length > 0
                    ? "neutral"
                    : "primary";

            return (
              <Button
                key={one.key}
                type="button"
                size="sm"
                variant={position === index ? "primary" : "ghost"}
                onClick={() => setIndex(position)}
              >
                <Badge variant={level}>
                  {one.checked ? (
                    <CircleCheck className="size-3" />
                  ) : one.stale ? (
                    <RotateCcw className="size-3" />
                  ) : one.flags.some((flag) => flag.level === "warn") ? (
                    <AlertTriangle className="size-3" />
                  ) : (
                    <Info className="size-3" />
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
          {step.stale ? (
            <p className="flex items-start gap-1.5 text-xs text-warning">
              <RotateCcw className="mt-0.5 size-3 shrink-0" />
              Something on this step has changed since it was checked. Have
              another look and confirm it again.
            </p>
          ) : null}

          {step.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing recorded.</p>
          ) : (
            step.rows.map((row) => (
              <div
                key={`${row.label}-${row.value}`}
                className="flex flex-wrap items-baseline justify-between gap-2 text-sm"
              >
                <span className="text-muted-foreground">{row.label}</span>
                <span
                  className={`min-w-0 whitespace-pre-wrap text-right ${
                    row.missing ? "text-warning" : ""
                  }`}
                >
                  {row.value}
                </span>
              </div>
            ))
          )}

          {/* The clocks themselves, in the pass that is about them. A reviewer
              who reads "8:02 AM – 4:31 PM" and thinks the out is wrong can move
              it here; sending them to another page to do it means coming back
              to a read-through that has started again from the top. The block
              is the Manager Portal's, with its history and its reasons. */}
          {step.key === "times" && punches.length > 0 ? (
            <div className="border-t border-border pt-2">
              <Punches punches={punches} companyName={companyName} />
            </div>
          ) : null}

          {/* The photos themselves, not a count of them. "4 photos" read and
              believed is how a job goes to the client with four pictures of the
              same wall. */}
          {step.images.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 border-t border-border pt-2">
              {step.images.map((image) => (
                <a
                  key={image.id}
                  href={`/api/files/${image.id}`}
                  target="_blank"
                  rel="noreferrer"
                  title={image.label}
                  className="overflow-hidden rounded border border-border transition-colors hover:border-primary"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/files/${image.id}?w=200`}
                    alt={image.label}
                    loading="lazy"
                    className="size-16 object-cover"
                  />
                </a>
              ))}
            </div>
          ) : null}

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

          {/* Getting past a warning costs a sentence. Not because the finding is
              necessarily right, but because "why was this approved" has an
              answer six weeks later. */}
          {warns.length > 0 ? (
            <div className="flex flex-col gap-1 border-t border-border pt-2">
              <label
                htmlFor={`note-${step.key}`}
                className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
              >
                Why this is alright
              </label>
              <textarea
                id={`note-${step.key}`}
                rows={2}
                value={notes[step.key] ?? ""}
                onChange={(event) =>
                  setNotes({ ...notes, [step.key]: event.target.value })
                }
                className="w-full rounded-lg border border-border bg-input p-2 text-sm"
                placeholder="Site let them in late; the client knows."
              />
            </div>
          ) : null}

          {step.checked && step.checkedBy ? (
            <p className="border-t border-border pt-2 text-xs text-muted-foreground">
              Checked by {step.checkedBy}
              {step.checkedAt ? ` · ${step.checkedAt}` : ""}
            </p>
          ) : null}
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

          <Button
            type="button"
            variant={step.checked ? "secondary" : "primary"}
            disabled={pending}
            onClick={confirm}
          >
            {pending ? <Loader2 className="animate-spin" /> : <CircleCheck />}
            {step.checked ? "Checked" : "Looks right"}
          </Button>

          {!last ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => setIndex(index + 1)}
            >
              Skip for now
            </Button>
          ) : null}
        </div>

        <div className="flex flex-col gap-2 border-t border-border pt-3">
          {outcome === null ? (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="success"
                disabled={pending || outstanding.length > 0}
                title={
                  outstanding.length > 0
                    ? `Still to go through: ${outstanding
                        .map((one) => one.title)
                        .join(", ")}`
                    : undefined
                }
                onClick={approve}
              >
                {pending ? <Loader2 className="animate-spin" /> : <CircleCheck />}
                Approve report
              </Button>

              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setReason("");
                  setOutcome("back");
                }}
              >
                <Undo2 /> Send back
              </Button>

              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setReason("");
                  setOutcome("reject");
                }}
              >
                <XCircle /> Reject
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <label
                htmlFor="review-reason"
                className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
              >
                {outcome === "back"
                  ? "What needs fixing"
                  : "Why this is being rejected"}
              </label>
              <textarea
                id="review-reason"
                rows={3}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                className="w-full rounded-lg border border-border bg-input p-2 text-sm"
                placeholder={
                  outcome === "back"
                    ? "Post-install photos are of the old rack. Reshoot and resubmit."
                    : "Wrong site. This work was never authorised."
                }
              />
              <p className="text-xs text-muted-foreground">
                {outcome === "back"
                  ? "The crew are told, with this text, and the job comes back here once they resubmit."
                  : "Nothing goes to the client and nothing is paid against it. The crew are told, with this text."}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant={outcome === "back" ? "primary" : "danger"}
                  disabled={pending || reason.trim() === ""}
                  onClick={() => decide(outcome)}
                >
                  {pending ? <Loader2 className="animate-spin" /> : null}
                  {outcome === "back" ? "Send it back" : "Reject the report"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setOutcome(null)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {outstanding.length > 0 && outcome === null ? (
            <p className="text-xs text-muted-foreground">
              Approving needs all four passes:{" "}
              {outstanding.map((one) => one.title).join(", ")} still to go.
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
