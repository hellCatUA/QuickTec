"use client";

import { Loader2, Trash2 } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { adjustVisitTime, removeVisit } from "./actions";

/** One clock, as a value a picker understands and as text a person reads. */
export type VisitClock = { value: string; text: string };

export type EditableVisit = {
  id: string;
  who: string;
  clockIn: VisitClock;
  /** Absent while somebody is still on site. */
  clockOut: VisitClock | null;
};

/**
 * Correcting a clock after the fact.
 *
 * The commonest reason is the least dramatic: a crew forgot to clock out and
 * noticed the next morning. How far each person may move one is decided on the
 * server — the answer settles what somebody is paid, so it is not a rule the
 * browser gets to hold — and this shows what came back. A change beyond
 * somebody's reach is not lost: it becomes a request for whoever pays for the
 * time, and the record keeps saying what actually happened until they answer.
 */
export function VisitTimes({
  visits,
  canRemove,
}: {
  visits: EditableVisit[];
  /** Deleting a day is for whoever pays for it, not for the job's lead. */
  canRemove: boolean;
}) {
  const [editing, setEditing] = React.useState<string | null>(null);
  const [value, setValue] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [note, setNote] = React.useState<string | null>(null);
  const [confirming, setConfirming] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  if (visits.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nobody has clocked in yet, so there is no time to correct.
      </p>
    );
  }

  function open(key: string, clock: VisitClock) {
    setEditing(key);
    setValue(clock.value);
    setReason("");
    setNote(null);
  }

  function save(visitId: string, field: "clockIn" | "clockOut") {
    startTransition(async () => {
      const formData = new FormData();
      formData.set("visitId", visitId);
      formData.set("field", field);
      formData.set("at", value);
      if (reason) formData.set("reason", reason);

      const result = await adjustVisitTime(formData);
      // A refusal and a request both come back as a message; the difference is
      // in the words, and the words come from the server so they can say which.
      if (!result.ok) return setNote(result.error);

      setEditing(null);
      setNote(null);
    });
  }

  function drop(visitId: string) {
    startTransition(async () => {
      const formData = new FormData();
      formData.set("visitId", visitId);

      const result = await removeVisit(formData);
      if (!result.ok) return setNote(result.error);

      setConfirming(null);
      setNote(null);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {note ? <p className="text-xs text-warning">{note}</p> : null}

      {visits.map((visit) => (
        <React.Fragment key={visit.id}>
          {rows(visit)}

          {/* A punch on the wrong job is not a time to correct — there should
              be no time there at all. Two taps, because it takes somebody's
              whole day off the record. */}
          {!canRemove ? null : confirming === visit.id ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-danger/50 p-2 text-xs">
              <span className="min-w-0 flex-1">
                Remove {visit.who}&apos;s punch from this job? The time goes
                with it.
              </span>
              <Button
                type="button"
                size="sm"
                variant="danger"
                disabled={pending}
                onClick={() => drop(visit.id)}
              >
                {pending ? <Loader2 className="animate-spin" /> : null}
                Remove
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => setConfirming(null)}
              >
                Keep
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="self-start"
              aria-label={`Remove ${visit.who}'s punch`}
              onClick={() => {
                setNote(null);
                setConfirming(visit.id);
              }}
            >
              <Trash2 /> Remove punch
            </Button>
          )}
        </React.Fragment>
      ))}
    </div>
  );

  function rows(visit: EditableVisit) {
    return (["clockIn", "clockOut"] as const).map((field) => {
        const clock = field === "clockIn" ? visit.clockIn : visit.clockOut;
        if (!clock) return null;

        const key = `${visit.id}-${field}`;
        const label = `${visit.who} · clocked ${field === "clockIn" ? "in" : "out"}`;

        if (editing !== key) {
          return (
            <div
              key={key}
              className="flex items-center justify-between gap-2 text-sm"
            >
              <span className="min-w-0 truncate text-muted-foreground">
                {label}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                data-visit={visit.id}
                data-clock={field}
                onClick={() => open(key, clock)}
              >
                {clock.text}
              </Button>
            </div>
          );
        }

        return (
          <div
            key={key}
            data-visit={visit.id}
            data-clock={field}
            className="flex flex-col gap-2 rounded-lg border border-border bg-surface-raised p-2"
          >
            <Field label={label} htmlFor={`visit-${key}`}>
              <Input
                id={`visit-${key}`}
                type="datetime-local"
                value={value}
                onChange={(event) => setValue(event.target.value)}
              />
            </Field>
            <Input
              value={reason}
              placeholder="Why? (kept on the timeline)"
              onChange={(event) => setReason(event.target.value)}
            />
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                disabled={pending}
                onClick={() => save(visit.id, field)}
              >
                {pending ? <Loader2 className="animate-spin" /> : null}
                Save
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => setEditing(null)}
              >
                Cancel
              </Button>
            </div>
          </div>
    );
    });
  }
}
