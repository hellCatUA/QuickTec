"use client";

import type { PrivacyLevel, ProfileRequestField } from "@prisma-client";
import { Camera, Check, Loader2, RotateCcw, TriangleAlert, X } from "lucide-react";
import * as React from "react";
import { HistoryButton, HistoryPanel, historyChanged, useHistoryOf } from "@/components/profile/history";
import { Avatar, LevelBadge } from "@/components/profile/parts";
import { ProfileRow } from "@/components/profile/row";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/field";
import { NameInput } from "@/components/ui/name-input";
import { PhoneInput } from "@/components/ui/phone-input";
import { StatePicker } from "@/components/ui/state-picker";
import { prepareForUpload } from "@/lib/photo-upload";
import { stateName } from "@/lib/us-regions";
import { cn } from "@/lib/utils";
import {
  answerRequest,
  removePictureAsManager,
  restorePictureAsManager,
  saveProfileAsManager,
  setPictureAsManager,
  type ManagerResult,
} from "./actions";

type Subject = {
  id: string;
  name: string;
  legalName: string | null;
  serviceStartDate: string;
  workPhone: string | null;
  voipPhone: string | null;
  primaryRegion: string | null;
  statesOfOperation: string[];
  hasPicture: boolean;
};

type Request = {
  id: string;
  field: ProfileRequestField;
  value: string | null;
  /** Why a first picture was asked for. */
  reason: string | null;
  at: string;
  pictureSrc: string | null;
};

type Earlier = { id: string; src: string; at: string; source: string; takenDown: boolean };

/**
 * What a direct supervisor — or, past a warning, another manager — keeps on
 * somebody's profile, and what that person is waiting on them for.
 *
 * Every save here can come back asking to be confirmed: the server decides
 * whether the change needs the "not your employee" warning, and this only
 * shows it and sends the same thing again when the answer is yes.
 */
export function ManagerPanel({
  subject,
  directSupervisor,
  notTheirEmployee,
  requests,
  currentPicture,
  earlier,
  levels,
}: {
  subject: Subject;
  directSupervisor: string | null;
  notTheirEmployee: boolean;
  requests: Request[];
  currentPicture: string | null;
  /** Pictures they had before, to put back. */
  earlier: Earlier[];
  levels: Record<
    | "legalName"
    | "yearsOfService"
    | "workPhone"
    | "voipPhone"
    | "primaryRegion"
    | "statesOfOperation"
    | "picture",
    PrivacyLevel
  >;
}) {
  const [warning, setWarning] = React.useState<{ message: string; go: () => void } | null>(null);
  const [result, setResult] = React.useState<ManagerResult | null>(null);
  const [busy, startTransition] = React.useTransition();
  const historyOf = useHistoryOf();
  // One thing open under the picture at a time.
  const [picturePanel, setPicturePanel] = React.useState<"remove" | "restore" | "history" | null>(null);
  const [removeReason, setRemoveReason] = React.useState("");
  const togglePanel = (next: typeof picturePanel) =>
    setPicturePanel((was) => (was === next ? null : next));

  /**
   * Runs an action, and when the server wants the warning answered first,
   * holds on to it until it is.
   */
  function submit(build: () => Promise<FormData> | FormData, action: (formData: FormData) => Promise<ManagerResult>) {
    startTransition(async () => {
      const formData = await build();
      const answer = await action(formData);
      if (!answer.ok && "confirm" in answer) {
        setWarning({
          message: answer.confirm,
          go: () => {
            setWarning(null);
            formData.set("confirmed", "1");
            startTransition(async () => {
              const confirmed = await action(formData);
              setResult(confirmed);
              if (confirmed.ok) {
                setPicturePanel((was) => (was === "history" ? was : null));
                historyChanged();
              }
            });
          },
        });
        return;
      }
      setResult(answer);
      if (answer.ok) {
        setPicturePanel((was) => (was === "history" ? was : null));
        historyChanged();
      }
    });
  }

  return (
    <>
      {requests.length > 0 ? (
        <Card id="requests" className="scroll-mt-20 border-warning/40">
          <CardHeader>
            <CardTitle>Waiting for you</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {requests.map((request) => (
              <RequestRow
                key={request.id}
                request={request}
                subject={subject}
                currentPicture={currentPicture}
                busy={busy}
                onAnswer={(formData) => submit(() => formData, answerRequest)}
              />
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>
            {notTheirEmployee ? "Managed by you as a manager" : "Set by you"}
          </CardTitle>
          {notTheirEmployee ? (
            <p className="flex items-start gap-1.5 text-xs text-warning">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
              {subject.name} reports to {directSupervisor}. Their legal name, years of service and
              picture are {directSupervisor}&rsquo;s to change; you will be asked to confirm, and they
              will be told.
            </p>
          ) : null}
        </CardHeader>
        {/* Opened afresh whenever what is stored changes — an answer given
            above, a save here — so every box shows what is stored and says it
            was opened on it. Kept as typed, a box would go on showing the old
            legal name after a request for a new one was approved, and the next
            save would put the old one back. */}
        <ManagerFields
          key={[
            subject.legalName,
            subject.serviceStartDate,
            subject.workPhone,
            subject.voipPhone,
            subject.primaryRegion,
            [...subject.statesOfOperation].sort().join(","),
          ].join("|")}
          subject={subject}
          levels={levels}
          busy={busy}
          onSave={(formData) => submit(() => formData, saveProfileAsManager)}
        />
        <div className="flex flex-wrap items-center gap-2 border-t border-border p-4">
          <span className="flex w-full items-center gap-2 text-sm font-medium sm:mr-auto sm:w-auto">
            Profile picture <LevelBadge level={levels.picture} iconOnly />
            {historyOf ? (
              <HistoryButton
                label="Profile picture"
                open={picturePanel === "history"}
                onToggle={() => togglePanel("history")}
              />
            ) : null}
          </span>
          <PicturePicker
            label="From a Photo ID"
            busy={busy}
            onPick={(file) =>
              submit(async () => {
                const formData = new FormData();
                formData.set("userId", subject.id);
                formData.set("source", "photo-id");
                formData.set("picture", (await prepareForUpload(file)).file);
                return formData;
              }, setPictureAsManager)
            }
          />
          <PicturePicker
            label="Upload"
            busy={busy}
            onPick={(file) =>
              submit(async () => {
                const formData = new FormData();
                formData.set("userId", subject.id);
                formData.set("picture", (await prepareForUpload(file)).file);
                return formData;
              }, setPictureAsManager)
            }
          />
          {earlier.length > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              aria-expanded={picturePanel === "restore"}
              onClick={() => togglePanel("restore")}
            >
              <RotateCcw /> Earlier pictures
            </Button>
          ) : null}
          {subject.hasPicture ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              aria-expanded={picturePanel === "remove"}
              onClick={() => togglePanel("remove")}
            >
              Remove
            </Button>
          ) : null}
        </div>
        {picturePanel === "remove" ? (
          <div className="flex flex-col gap-2 border-t border-border p-4">
            <label htmlFor="m-remove-reason" className="text-xs font-medium text-muted-foreground">
              Why is it taken down? It goes on their history.
            </label>
            <Input
              id="m-remove-reason"
              value={removeReason}
              onChange={(event) => setRemoveReason(event.target.value)}
              placeholder="Not a clear photo of their face"
            />
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="danger"
                disabled={busy || !removeReason.trim()}
                onClick={() =>
                  submit(() => {
                    const formData = new FormData();
                    formData.set("userId", subject.id);
                    formData.set("reason", removeReason);
                    return formData;
                  }, removePictureAsManager)
                }
              >
                Take it down
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setPicturePanel(null)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
        {picturePanel === "restore" ? (
          <ul className="flex flex-col gap-2 border-t border-border p-4">
            {earlier.map((picture) => (
              <li key={picture.id} className="flex items-center gap-3">
                <Avatar src={picture.src} name={subject.name} size={48} />
                <span className="min-w-0 flex-1 text-xs">
                  <span className="block">
                    {picture.at}
                    {picture.takenDown ? <span className="text-danger"> · Taken down</span> : null}
                  </span>
                  <span className="block truncate text-muted-foreground">{picture.source}</span>
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    submit(() => {
                      const formData = new FormData();
                      formData.set("userId", subject.id);
                      formData.set("pictureId", picture.id);
                      return formData;
                    }, restorePictureAsManager)
                  }
                >
                  Put back
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
        {picturePanel === "history" && historyOf ? (
          <HistoryPanel userId={historyOf} field="picture" className="mx-4 mb-4" />
        ) : null}
        {result ? (
          <p
            role={result.ok ? "status" : "alert"}
            className={`border-t border-border px-4 py-3 text-sm ${result.ok ? "text-success" : "text-danger"}`}
          >
            {result.ok ? (result.message ?? "Saved.") : "error" in result ? result.error : null}
          </p>
        ) : null}
      </Card>

      {warning ? (
        <NotYourEmployee
          name={subject.name}
          message={warning.message}
          onCancel={() => setWarning(null)}
          onConfirm={warning.go}
        />
      ) : null}
    </>
  );
}

function ManagerFields({
  subject,
  levels,
  busy,
  onSave,
}: {
  subject: Subject;
  levels: Record<string, PrivacyLevel>;
  busy: boolean;
  onSave: (formData: FormData) => void;
}) {
  const [primary, setPrimary] = React.useState(subject.primaryRegion ?? "");
  const [legalCleared, setLegalCleared] = React.useState(false);
  const [states, setStates] = React.useState(subject.statesOfOperation);
  const [adding, setAdding] = React.useState("");

  return (
    <form
      className="flex flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(new FormData(event.currentTarget));
      }}
    >
      <input type="hidden" name="userId" value={subject.id} />
      {/* What each field held when this was opened: only what is changed
          from it is saved, so an answer given meanwhile is not undone. */}
      <input type="hidden" name="was.legalName" value={subject.legalName ?? ""} />
      <input type="hidden" name="was.serviceStartDate" value={subject.serviceStartDate} />
      <input type="hidden" name="was.workPhone" value={subject.workPhone ?? ""} />
      <input type="hidden" name="was.voipPhone" value={subject.voipPhone ?? ""} />
      <input type="hidden" name="was.primaryRegion" value={subject.primaryRegion ?? ""} />
      <input
        type="hidden"
        name="was.statesOfOperation"
        value={[...subject.statesOfOperation].sort().join(",")}
      />
      <ProfileRow label="Legal name" htmlFor="m-legal" level={levels.legalName} field="legalName">
        <div
          className="flex flex-col gap-2"
          onInput={(event) => {
            const target = event.target as HTMLInputElement;
            if (target.name === "legalName") setLegalCleared(Boolean(subject.legalName) && !target.value.trim());
          }}
        >
          <NameInput id="m-legal" name="legalName" defaultValue={subject.legalName} placeholder="As on their ID" />
          {/* Taking a legal name off says why, as taking a picture down does. */}
          {legalCleared ? (
            <Input
              name="legalNameReason"
              aria-label="Why is the legal name taken off?"
              placeholder="Why is it taken off? It goes on their history."
              required
            />
          ) : null}
        </div>
      </ProfileRow>
      <ProfileRow
        label="Started"
        htmlFor="m-start"
        level={levels.yearsOfService}
        field="yearsOfService"
        hint="Years of service count from here."
      >
        <Input id="m-start" name="serviceStartDate" type="date" defaultValue={subject.serviceStartDate} />
      </ProfileRow>
      <ProfileRow label="Work phone" htmlFor="m-work" level={levels.workPhone} field="workPhone">
        <PhoneInput id="m-work" name="workPhone" defaultValue={subject.workPhone} />
      </ProfileRow>
      <ProfileRow label="VoIP" htmlFor="m-voip" level={levels.voipPhone} field="voipPhone">
        <PhoneInput id="m-voip" name="voipPhone" defaultValue={subject.voipPhone} />
      </ProfileRow>
      <ProfileRow
        label="Primary region"
        htmlFor="m-primary"
        level={levels.primaryRegion}
        field="primaryRegion"
      >
        <StatePicker id="m-primary" name="primaryRegion" value={primary} onChange={setPrimary} />
      </ProfileRow>
      <ProfileRow
        label="States of operation"
        htmlFor="m-states"
        level={levels.statesOfOperation}
        field="statesOfOperation"
      >
        <div className="flex flex-col gap-2">
          {states.length > 0 ? (
            <ul className="flex flex-wrap gap-1.5" aria-label="States of operation">
              {states.map((code) => (
                <li
                  key={code}
                  className="inline-flex h-10 items-center gap-1 rounded-md border border-border bg-input pl-2.5 pr-1 text-sm sm:h-8"
                >
                  {stateName(code) ?? code}
                  <input type="hidden" name="statesOfOperation" value={code} />
                  <button
                    type="button"
                    aria-label={`Remove ${stateName(code) ?? code}`}
                    onClick={() => setStates((was) => was.filter((entry) => entry !== code))}
                    className="flex size-8 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground sm:size-6"
                  >
                    <X className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <StatePicker
            id="m-states"
            value={adding}
            onChange={(next) => {
              if (next && !states.includes(next)) setStates((was) => [...was, next]);
              setAdding("");
            }}
          />
        </div>
      </ProfileRow>
      <div className="border-t border-border p-4">
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : null}
          Save
        </Button>
      </div>
    </form>
  );
}

function RequestRow({
  request,
  subject,
  currentPicture,
  busy,
  onAnswer,
}: {
  request: Request;
  subject: Subject;
  currentPicture: string | null;
  busy: boolean;
  onAnswer: (formData: FormData) => void;
}) {
  const [denying, setDenying] = React.useState(false);
  const [note, setNote] = React.useState("");

  function answer(decision: "approve" | "deny") {
    const formData = new FormData();
    formData.set("requestId", request.id);
    formData.set("decision", decision);
    if (decision === "deny") formData.set("note", note);
    onAnswer(formData);
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
      <div className="text-sm">
        {request.field === "PICTURE" ? (
          <>
            {subject.name} asked for {currentPicture ? "a new profile picture" : "a profile picture"}.
            {request.reason ? <span className="text-muted-foreground"> Reason: {request.reason}.</span> : null}
          </>
        ) : (
          <>
            {subject.name} asked to change their legal name from{" "}
            <b>{subject.legalName ?? "nothing"}</b> to <b>{request.value}</b>.
          </>
        )}
      </div>
      {request.field === "PICTURE" ? (
        <div className="flex items-center gap-3">
          <figure className="flex flex-col items-center gap-1 text-xs text-muted-foreground">
            <Avatar src={currentPicture} name={subject.name} size={72} />
            Now
          </figure>
          <span aria-hidden className="text-muted-foreground">→</span>
          <figure className="flex flex-col items-center gap-1 text-xs text-muted-foreground">
            <Avatar src={request.pictureSrc} name={subject.name} size={72} />
            Asked for
          </figure>
        </div>
      ) : null}
      {denying ? (
        <div className="flex flex-col gap-2">
          <label htmlFor={`deny-${request.id}`} className="text-xs font-medium text-muted-foreground">
            Why not — they will read this
          </label>
          <Textarea
            id={`deny-${request.id}`}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className="min-h-16"
          />
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {denying ? (
          <>
            <Button type="button" size="sm" variant="danger" disabled={busy || !note.trim()} onClick={() => answer("deny")}>
              Turn it down
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setDenying(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button type="button" size="sm" disabled={busy} onClick={() => answer("approve")}>
              <Check /> Approve
            </Button>
            <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => setDenying(true)}>
              <X /> Deny…
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function PicturePicker({
  label,
  busy,
  onPick,
}: {
  label: string;
  busy: boolean;
  onPick: (file: File) => void;
}) {
  const input = React.useRef<HTMLInputElement>(null);
  return (
    <>
      <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => input.current?.click()}>
        <Camera /> {label}
      </Button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="hidden"
        aria-label={label}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) onPick(file);
        }}
      />
    </>
  );
}

/** The warning another manager gets before changing what is a direct supervisor's. */
function NotYourEmployee({
  name,
  message,
  onCancel,
  onConfirm,
}: {
  name: string;
  message: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancel = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    cancel.current?.focus();
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="not-yours-title"
        aria-describedby="not-yours-body"
        className="flex w-full max-w-md flex-col gap-4 rounded-xl border border-border bg-surface-raised p-5 shadow-xl"
      >
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-warning/15 text-warning">
            <TriangleAlert className="size-5" />
          </span>
          <div>
            <h2 id="not-yours-title" className="text-base font-semibold">
              {name} isn&rsquo;t your employee
            </h2>
            <p id="not-yours-body" className="mt-1 text-sm text-muted-foreground">
              {message}
            </p>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button
            ref={cancel}
            type="button"
            onClick={onCancel}
            className={buttonVariants({ variant: "ghost" })}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={cn(
              buttonVariants(),
              "bg-warning text-warning-foreground hover:bg-warning/90 active:bg-warning/80",
            )}
          >
            Change anyway
          </button>
        </div>
      </div>
    </div>
  );
}
