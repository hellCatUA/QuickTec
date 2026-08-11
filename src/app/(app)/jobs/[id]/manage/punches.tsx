"use client";

import {
  AlertTriangle,
  ChevronDown,
  Loader2,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { addVisit, adjustVisitTime, removeVisit } from "../actions";

/** A time as the picker wants it and as a person reads it. */
export type Clock = { value: string; text: string };

export type BreakRow = { text: string; minutes: number; paid: boolean };

export type Punch = {
  assignmentId: string;
  who: string;
  /** Null when this person never clocked in. */
  visitId: string | null;
  clockIn: Clock | null;
  clockOut: Clock | null;
  breaks: BreakRow[];
  breakTotal: string | null;
  /** Set when they arrived well after the job was due to start. */
  late: string | null;
  /** Set when they were still on site past the scheduled time plus estimate. */
  over: string | null;
  canEdit: boolean;
  canRemove: boolean;
  canAdd: boolean;
};

/**
 * One block per person: when they arrived, what they took, when they left.
 *
 * The flat list this replaces mixed two techs' clock-ins and clock-outs into a
 * single column of rows that all looked the same, which is how a Remove button
 * meant for one person read as one that would take everybody's day.
 *
 * Late and overrun are marked here rather than left for somebody to work out
 * from two timestamps and an estimate they would have to go and find.
 */
export function Punches({ punches }: { punches: Punch[] }) {
  const [note, setNote] = React.useState<string | null>(null);

  if (punches.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nobody is on this job yet, so there is nothing to record time against.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {note ? <p className="text-sm text-warning">{note}</p> : null}
      {punches.map((punch) => (
        <PunchBlock key={punch.assignmentId} punch={punch} onNote={setNote} />
      ))}
    </div>
  );
}

function PunchBlock({
  punch,
  onNote,
}: {
  punch: Punch;
  onNote: (note: string | null) => void;
}) {
  const [editing, setEditing] = React.useState<"clockIn" | "clockOut" | null>(
    null,
  );
  const [value, setValue] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [showBreaks, setShowBreaks] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);
  const [adding, setAdding] = React.useState(false);
  const [newIn, setNewIn] = React.useState("");
  const [newOut, setNewOut] = React.useState("");
  const [pending, startTransition] = React.useTransition();

  function open(field: "clockIn" | "clockOut", clock: Clock) {
    onNote(null);
    setEditing(field);
    setValue(clock.value);
    setReason("");
  }

  function save() {
    if (!punch.visitId || !editing) return;
    startTransition(async () => {
      const formData = new FormData();
      formData.set("visitId", punch.visitId!);
      formData.set("field", editing);
      formData.set("at", value);
      if (reason) formData.set("reason", reason);

      const result = await adjustVisitTime(formData);
      // A refusal and a request both come back as a message; the words come
      // from the server, so they can say which this was.
      if (!result.ok) return onNote(result.error);
      setEditing(null);
      onNote(null);
    });
  }

  function drop() {
    if (!punch.visitId) return;
    startTransition(async () => {
      const formData = new FormData();
      formData.set("visitId", punch.visitId!);
      const result = await removeVisit(formData);
      if (!result.ok) return onNote(result.error);
      setConfirming(false);
      onNote(null);
    });
  }

  function create() {
    startTransition(async () => {
      const formData = new FormData();
      formData.set("assignmentId", punch.assignmentId);
      formData.set("clockIn", newIn);
      if (newOut) formData.set("clockOut", newOut);

      const result = await addVisit(formData);
      if (!result.ok) return onNote(result.error);
      setAdding(false);
      onNote(null);
    });
  }

  return (
    <section
      data-punch={punch.assignmentId}
      className="flex flex-col gap-2 rounded-lg border border-border p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">{punch.who}</h3>
        {punch.late ? (
          <Badge variant="warning">
            <AlertTriangle className="size-3" /> Late in
          </Badge>
        ) : null}
        {punch.over ? (
          <Badge variant="warning">
            <AlertTriangle className="size-3" /> Over estimate
          </Badge>
        ) : null}
      </div>

      {punch.visitId === null ? (
        <>
          <p className="text-sm text-muted-foreground">No punch recorded.</p>

          {punch.canAdd ? (
            adding ? (
              <div className="flex flex-col gap-2">
                <Field label="CI" htmlFor={`add-in-${punch.assignmentId}`}>
                  <Input
                    id={`add-in-${punch.assignmentId}`}
                    type="datetime-local"
                    value={newIn}
                    onChange={(event) => setNewIn(event.target.value)}
                  />
                </Field>
                <Field
                  label="CO"
                  htmlFor={`add-out-${punch.assignmentId}`}
                  hint="Leave blank if they are still on site."
                >
                  <Input
                    id={`add-out-${punch.assignmentId}`}
                    type="datetime-local"
                    value={newOut}
                    onChange={(event) => setNewOut(event.target.value)}
                  />
                </Field>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={pending || !newIn}
                    onClick={create}
                  >
                    {pending ? <Loader2 className="animate-spin" /> : null}
                    Save punch
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => setAdding(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="self-start"
                aria-label={`Add a punch for ${punch.who}`}
                onClick={() => setAdding(true)}
              >
                <Plus /> Add a punch
              </Button>
            )
          ) : null}
        </>
      ) : (
        <>
          <Line
            label="CI"
            clock={punch.clockIn}
            flag={punch.late}
            canEdit={punch.canEdit}
            editing={editing === "clockIn"}
            onOpen={() => punch.clockIn && open("clockIn", punch.clockIn)}
            person={punch.who}
            field="clockIn"
          />

          {/* One break reads as a time; several read as a total, because the
              question is almost always "how long were they off". The detail is
              a tap away for the day somebody argues about it. */}
          {punch.breaks.length > 0 ? (
            <div className="flex flex-col gap-1">
              <button
                type="button"
                className="flex items-center justify-between gap-2 text-sm"
                aria-expanded={showBreaks}
                onClick={() => setShowBreaks((was) => !was)}
              >
                <span className="text-muted-foreground">
                  Breaks
                  {punch.breaks.length > 1 ? ` (${punch.breaks.length})` : ""}
                </span>
                <span className="flex items-center gap-1">
                  {punch.breakTotal}
                  <ChevronDown
                    className={`size-3.5 transition-transform ${
                      showBreaks ? "rotate-180" : ""
                    }`}
                  />
                </span>
              </button>

              {showBreaks ? (
                <div className="flex flex-col gap-0.5 rounded-lg bg-surface-raised p-2 text-xs">
                  {punch.breaks.map((entry, index) => (
                    <div
                      key={`${index}-${entry.text}`}
                      className="flex justify-between gap-2"
                    >
                      <span>{entry.text}</span>
                      <span className="text-muted-foreground">
                        {entry.paid ? "paid" : "unpaid"}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          <Line
            label="CO"
            clock={punch.clockOut}
            flag={punch.over}
            canEdit={punch.canEdit}
            editing={editing === "clockOut"}
            onOpen={() => punch.clockOut && open("clockOut", punch.clockOut)}
            person={punch.who}
            field="clockOut"
          />

          {editing ? (
            <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-raised p-2">
              <Field
                label={editing === "clockIn" ? "CI" : "CO"}
                htmlFor={`edit-${punch.assignmentId}`}
              >
                <Input
                  id={`edit-${punch.assignmentId}`}
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
                <Button type="button" size="sm" disabled={pending} onClick={save}>
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
          ) : null}

          {/* Named for the person, and inside their block, because it takes
              their whole day and nobody else's. */}
          {punch.canRemove ? (
            confirming ? (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-danger/50 p-2 text-xs">
                <span className="min-w-0 flex-1">
                  Remove {punch.who}&apos;s punch? Their time on this job goes
                  with it.
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="danger"
                  disabled={pending}
                  onClick={drop}
                >
                  {pending ? <Loader2 className="animate-spin" /> : null}
                  Remove
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => setConfirming(false)}
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
                aria-label={`Remove ${punch.who}'s punch`}
                onClick={() => {
                  onNote(null);
                  setConfirming(true);
                }}
              >
                <Trash2 /> Remove {punch.who}&apos;s punch
              </Button>
            )
          ) : null}
        </>
      )}
    </section>
  );
}

function Line({
  label,
  clock,
  flag,
  canEdit,
  editing,
  onOpen,
  person,
  field,
}: {
  label: string;
  clock: Clock | null;
  flag: string | null;
  canEdit: boolean;
  editing: boolean;
  onOpen: () => void;
  person: string;
  field: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="text-muted-foreground">{label}</span>
        {clock ? (
          canEdit ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-clock={field}
              aria-label={`Edit ${person} ${label}`}
              aria-pressed={editing}
              onClick={onOpen}
            >
              {clock.text} <Pencil />
            </Button>
          ) : (
            <span className="tabular">{clock.text}</span>
          )
        ) : (
          <span className="text-muted-foreground">Still on site</span>
        )}
      </div>
      {flag ? <p className="text-xs text-warning">{flag}</p> : null}
    </div>
  );
}
