"use client";

import {
  AlertTriangle,
  ChevronDown,
  Clock,
  History,
  Loader2,
  MoreHorizontal,
  Pencil,
  PenLine,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import type { PunchHistoryRow } from "@/lib/punch-history";
import { acceptTimeFlag, addVisit, editPunch, removeVisit } from "../actions";
import { ReasonPicker } from "./reason-picker";

/** A time as the picker wants it and as a person reads it. */
export type PunchClock = { value: string; text: string };

export type BreakRow = {
  text: string;
  minutes: number;
  paid: boolean;
  /** Datetime-local, so the same row can be handed to the editor. */
  startValue: string;
  endValue: string;
};

export type { PunchHistoryRow } from "@/lib/punch-history";

export type Punch = {
  assignmentId: string;
  who: string;
  /** Null when this person never clocked in. */
  visitId: string | null;
  clockIn: PunchClock | null;
  clockOut: PunchClock | null;
  breaks: BreakRow[];
  breakTotal: string | null;
  /** Written by hand rather than pressed on site. */
  manual: boolean;
  /** Set when they arrived well after the job was due to start. */
  late: string | null;
  /** Set when they were still on site past the scheduled time plus estimate. */
  over: string | null;
  /** A reviewer has looked at that flag and accepted it, so it stops shouting. */
  lateAccepted: boolean;
  overAccepted: boolean;
  canEdit: boolean;
  canRemove: boolean;
  canAdd: boolean;
  /** Accepting a flag is part of signing the job off. */
  canAccept: boolean;
  history: PunchHistoryRow[];
};

/**
 * One block per person: when they arrived, what they took, when they left.
 *
 * The flat list this replaces mixed two techs' clock-ins and clock-outs into a
 * single column of rows that all looked the same, which is how a Remove button
 * meant for one person read as one that would take everybody's day.
 *
 * Reading and changing are separated: the block itself is four lines somebody
 * can take in at a glance, and everything that writes lives behind its own "…"
 * — including the history, because "who moved this and why" is a question you
 * ask about a punch rather than about the job.
 */
export function Punches({
  punches,
  companyName,
}: {
  punches: Punch[];
  companyName: string;
}) {
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
        <PunchBlock
          key={punch.assignmentId}
          punch={punch}
          companyName={companyName}
          onNote={setNote}
        />
      ))}
    </div>
  );
}

type Pane = "edit" | "add" | "remove" | "history" | null;

/** A break as the form holds it, before it goes back as JSON. */
type DraftBreak = { id: number; startAt: string; endAt: string; paid: boolean };

function PunchBlock({
  punch,
  companyName,
  onNote,
}: {
  punch: Punch;
  companyName: string;
  onNote: (note: string | null) => void;
}) {
  const [menu, setMenu] = React.useState(false);
  const [pane, setPane] = React.useState<Pane>(null);
  const [value, setValue] = React.useState("");
  const [newOut, setNewOut] = React.useState("");
  const [draftBreaks, setDraftBreaks] = React.useState<DraftBreak[]>([]);
  const nextBreakId = React.useRef(0);
  const [code, setCode] = React.useState("");
  const [reasonNote, setReasonNote] = React.useState("");
  const [showBreaks, setShowBreaks] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  function choose(next: Pane) {
    onNote(null);
    setMenu(false);
    setCode("");
    setReasonNote("");
    setNewOut("");
    setValue(next === "edit" ? (punch.clockIn?.value ?? "") : "");
    if (next === "edit") {
      setNewOut(punch.clockOut?.value ?? "");
      setDraftBreaks(
        punch.breaks.map((entry) => ({
          id: nextBreakId.current++,
          startAt: entry.startValue,
          endAt: entry.endValue,
          paid: entry.paid,
        })),
      );
    }
    setPane(next);
  }

  function run(work: () => Promise<{ ok: boolean; error?: string }>) {
    startTransition(async () => {
      const result = await work();
      // A refusal and a request both come back as a message; the words come
      // from the server, so they can say which this was.
      if (!result.ok) return onNote(result.error ?? "That did not work.");
      setPane(null);
      onNote(null);
    });
  }

  function save() {
    if (!punch.visitId) return;
    run(async () => {
      const formData = new FormData();
      formData.set("visitId", punch.visitId!);
      formData.set("clockIn", value);
      if (newOut) formData.set("clockOut", newOut);
      formData.set(
        "breaks",
        JSON.stringify(
          draftBreaks
            .filter((entry) => entry.startAt && entry.endAt)
            .map((entry) => ({
              startAt: entry.startAt,
              endAt: entry.endAt,
              paid: entry.paid,
            })),
        ),
      );
      formData.set("reasonCode", code);
      if (reasonNote) formData.set("note", reasonNote);
      return editPunch(formData);
    });
  }

  function drop() {
    if (!punch.visitId) return;
    run(async () => {
      const formData = new FormData();
      formData.set("visitId", punch.visitId!);
      formData.set("reasonCode", code);
      if (reasonNote) formData.set("note", reasonNote);
      return removeVisit(formData);
    });
  }

  function create() {
    run(async () => {
      const formData = new FormData();
      formData.set("assignmentId", punch.assignmentId);
      formData.set("clockIn", value);
      if (newOut) formData.set("clockOut", newOut);
      formData.set("reasonCode", code);
      if (reasonNote) formData.set("note", reasonNote);
      return addVisit(formData);
    });
  }

  function accept(kind: "late" | "over", on: boolean) {
    if (!punch.visitId) return;
    startTransition(async () => {
      const formData = new FormData();
      formData.set("visitId", punch.visitId!);
      formData.set("kind", kind);
      formData.set("accept", String(on));
      const result = await acceptTimeFlag(formData);
      if (!result.ok) onNote(result.error);
    });
  }

  const actions: { key: Pane; label: string; icon: React.ReactNode }[] = [
    ...(punch.visitId && punch.canEdit
      ? [{ key: "edit" as Pane, label: "Edit Punch", icon: <Pencil /> }]
      : []),
    ...(!punch.visitId && punch.canAdd
      ? [{ key: "add" as Pane, label: "Add a punch", icon: <Plus /> }]
      : []),
    ...(punch.visitId && punch.canRemove
      ? [{ key: "remove" as Pane, label: "Remove punch", icon: <Trash2 /> }]
      : []),
    // Last, always: it is the thing you reach for when one of the others has
    // already been used and somebody is asking why.
    { key: "history" as Pane, label: "History", icon: <History /> },
  ];

  return (
    <section
      data-punch={punch.assignmentId}
      className="flex flex-col gap-2 rounded-lg border border-border p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">{punch.who}</h3>

        <div className="relative ml-auto">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Punch actions for ${punch.who}`}
            aria-expanded={menu}
            onClick={() => setMenu((was) => !was)}
          >
            <MoreHorizontal />
          </Button>

          {menu ? (
            <>
              {/* Catches the tap that closes it, without a portal. */}
              <button
                type="button"
                aria-hidden
                tabIndex={-1}
                className="fixed inset-0 z-40 cursor-default"
                onClick={() => setMenu(false)}
              />
              <div className="absolute right-0 z-50 mt-1 flex w-56 flex-col rounded-lg border border-border bg-surface p-1 shadow-lg">
                {actions.map((action) => (
                  <button
                    key={action.label}
                    type="button"
                    className="flex min-h-11 items-center gap-2 rounded-md px-3 text-left text-sm hover:bg-muted"
                    onClick={() => choose(action.key)}
                  >
                    {action.icon}
                    {action.label}
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </div>
      </div>

      {/* Their own line. Three badges beside a name wrapped into a knot on a
          phone, and the name is what somebody is looking for. */}
      {punch.manual || punch.late || punch.over ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {punch.manual ? (
            <Badge variant="neutral">
              <PenLine className="size-3" /> Manually added
            </Badge>
          ) : null}
          {punch.late ? (
            <FlagBadge
              label="Late in"
              accepted={punch.lateAccepted}
              canAccept={punch.canAccept}
              pending={pending}
              onToggle={() => accept("late", !punch.lateAccepted)}
            />
          ) : null}
          {punch.over ? (
            <FlagBadge
              label="Over estimate"
              accepted={punch.overAccepted}
              canAccept={punch.canAccept}
              pending={pending}
              onToggle={() => accept("over", !punch.overAccepted)}
            />
          ) : null}
        </div>
      ) : null}

      {punch.visitId === null ? (
        <p className="text-sm text-muted-foreground">No punch recorded.</p>
      ) : (
        <>
          <Line label="CI" clock={punch.clockIn} flag={punch.late} greyed={punch.lateAccepted} />

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

          <Line label="CO" clock={punch.clockOut} flag={punch.over} greyed={punch.overAccepted} />
        </>
      )}

      {pane === "history" ? (
        <Pane title={`What has happened to ${punch.who}'s punch`} onClose={() => setPane(null)}>
          {punch.history.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing but the punch itself.
            </p>
          ) : (
            <ol className="flex flex-col gap-2">
              {punch.history.map((row) => (
                <HistoryLine key={row.id} row={row} />
              ))}
            </ol>
          )}
        </Pane>
      ) : null}

      {/* One pane, because it is one decision: this is what the day was. Two
          buttons and a third somewhere else made three out of it. */}
      {pane === "edit" ? (
        <Pane title="Edit Punch" onClose={() => setPane(null)}>
          <Field label="CI" htmlFor={`edit-${punch.assignmentId}`}>
            <Input
              id={`edit-${punch.assignmentId}`}
              type="datetime-local"
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
          </Field>
          <Field label="CO" htmlFor={`edit-out-${punch.assignmentId}`}>
            <Input
              id={`edit-out-${punch.assignmentId}`}
              type="datetime-local"
              value={newOut}
              onChange={(event) => setNewOut(event.target.value)}
            />
          </Field>

          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Breaks
            </span>
            {draftBreaks.map((entry, index) => (
              <div key={entry.id} className="flex flex-wrap items-end gap-2">
                <Input
                  aria-label={`Break ${index + 1} start`}
                  type="datetime-local"
                  value={entry.startAt}
                  onChange={(event) =>
                    setDraftBreaks((was) =>
                      was.map((row) =>
                        row.id === entry.id
                          ? { ...row, startAt: event.target.value }
                          : row,
                      ),
                    )
                  }
                />
                <Input
                  aria-label={`Break ${index + 1} end`}
                  type="datetime-local"
                  value={entry.endAt}
                  onChange={(event) =>
                    setDraftBreaks((was) =>
                      was.map((row) =>
                        row.id === entry.id
                          ? { ...row, endAt: event.target.value }
                          : row,
                      ),
                    )
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove break ${index + 1}`}
                  onClick={() =>
                    setDraftBreaks((was) =>
                      was.filter((row) => row.id !== entry.id),
                    )
                  }
                >
                  <X />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="self-start"
              onClick={() =>
                setDraftBreaks((was) => [
                  ...was,
                  {
                    id: nextBreakId.current++,
                    startAt: value,
                    endAt: value,
                    paid: false,
                  },
                ])
              }
            >
              <Plus /> Another break
            </Button>
          </div>

          <ReasonPicker
            action="adjust"
            companyName={companyName}
            code={code}
            note={reasonNote}
            onCode={setCode}
            onNote={setReasonNote}
            idPrefix={`adjust-${punch.assignmentId}`}
          />
          <Actions pending={pending} onSave={save} onCancel={() => setPane(null)} label="Save" />
        </Pane>
      ) : null}

      {pane === "add" ? (
        <Pane title="Add a punch" onClose={() => setPane(null)}>
          <Field label="CI" htmlFor={`add-in-${punch.assignmentId}`}>
            <Input
              id={`add-in-${punch.assignmentId}`}
              type="datetime-local"
              value={value}
              onChange={(event) => setValue(event.target.value)}
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
          <ReasonPicker
            action="add"
            companyName={companyName}
            code={code}
            note={reasonNote}
            onCode={setCode}
            onNote={setReasonNote}
            idPrefix={`add-${punch.assignmentId}`}
          />
          <Actions
            pending={pending || !value}
            onSave={create}
            onCancel={() => setPane(null)}
            label="Save punch"
          />
        </Pane>
      ) : null}

      {pane === "remove" ? (
        <Pane title={`Remove ${punch.who}'s punch`} onClose={() => setPane(null)}>
          <p className="text-sm text-muted-foreground">
            Their time on this job goes with it. Nobody else&apos;s is touched.
          </p>
          <ReasonPicker
            action="remove"
            companyName={companyName}
            code={code}
            note={reasonNote}
            onCode={setCode}
            onNote={setReasonNote}
            idPrefix={`remove-${punch.assignmentId}`}
          />
          <div className="flex gap-2">
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
              onClick={() => setPane(null)}
            >
              Keep
            </Button>
          </div>
        </Pane>
      ) : null}
    </section>
  );
}

const TONE_TEXT: Record<string, string> = {
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
  primary: "text-primary",
  neutral: "text-muted-foreground",
};

/**
 * One thing that happened to this punch.
 *
 * The time being written about and the moment somebody wrote it are two
 * different clocks, and a history that shows only one of them cannot answer
 * the question it exists for. So the headline carries the time the record
 * says, and the small line underneath carries who touched it and when.
 */
function HistoryLine({ row }: { row: PunchHistoryRow }) {
  return (
    <li
      data-history={row.action}
      className={
        // A request and the answer to it are the same event from both ends,
        // so they are drawn as one thing rather than left to be matched by eye.
        row.paired
          ? "border-l-2 border-primary/40 pl-2 text-sm"
          : "text-sm"
      }
    >
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className={`font-medium ${TONE_TEXT[row.tone] ?? ""}`}>
          {row.title}
        </span>
        {row.suffix ? <span className="tabular">{row.suffix}</span> : null}
      </div>

      {row.changes.map((change) => (
        <div
          key={change.label}
          className="flex flex-wrap items-baseline gap-x-1.5 text-sm"
        >
          <span className="text-muted-foreground">{change.label}</span>
          {change.from ? (
            <span className="tabular text-muted-foreground line-through">
              {change.from}
            </span>
          ) : null}
          <span aria-hidden>→</span>
          <span className="tabular">{change.to}</span>
        </div>
      ))}

      {row.reason ? (
        <p className="text-xs text-muted-foreground">Reason: {row.reason}</p>
      ) : null}
      {row.denial ? (
        <p className="text-xs text-danger">Reason for denial: {row.denial}</p>
      ) : null}

      <p className="text-xs text-muted-foreground">
        by {row.by} @ {row.at}
      </p>
    </li>
  );
}

/**
 * A warning that can be answered.
 *
 * Both flags stay on the record whichever way this goes — a late start
 * happened. Accepting one means somebody has read it and decided, and the
 * badge goes quiet; the one nobody excused keeps its colour, which is the only
 * reason greying the other is worth anything.
 */
function FlagBadge({
  label,
  accepted,
  canAccept,
  pending,
  onToggle,
}: {
  label: string;
  accepted: boolean;
  canAccept: boolean;
  pending: boolean;
  onToggle: () => void;
}) {
  const badge = (
    <Badge variant={accepted ? "neutral" : "warning"}>
      {accepted ? <Clock className="size-3" /> : <AlertTriangle className="size-3" />}
      {label}
      {accepted ? " · accepted" : ""}
    </Badge>
  );

  if (!canAccept) return badge;

  return (
    <button
      type="button"
      disabled={pending}
      aria-pressed={accepted}
      aria-label={`${accepted ? "Reopen" : "Accept"} ${label}`}
      onClick={onToggle}
    >
      {badge}
    </button>
  );
}

function Pane({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-raised p-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-medium">{title}</h4>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Close"
          onClick={onClose}
        >
          <X />
        </Button>
      </div>
      {children}
    </div>
  );
}

function Actions({
  pending,
  onSave,
  onCancel,
  label,
}: {
  pending: boolean;
  onSave: () => void;
  onCancel: () => void;
  label: string;
}) {
  return (
    <div className="flex gap-2">
      <Button type="button" size="sm" disabled={pending} onClick={onSave}>
        {pending ? <Loader2 className="animate-spin" /> : null}
        {label}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={onCancel}
      >
        Cancel
      </Button>
    </div>
  );
}

function Line({
  label,
  clock,
  flag,
  greyed,
}: {
  label: string;
  clock: PunchClock | null;
  flag: string | null;
  /** The flag has been accepted, so it is a note rather than a warning. */
  greyed: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="text-muted-foreground">{label}</span>
        {clock ? (
          <span className="tabular" data-clock={label}>
            {clock.text}
          </span>
        ) : (
          <span className="text-muted-foreground">Still on site</span>
        )}
      </div>
      {flag ? (
        <p className={`text-xs ${greyed ? "text-muted-foreground" : "text-warning"}`}>
          {flag}
        </p>
      ) : null}
    </div>
  );
}
