"use client";

import { startTransition, useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import { saveJobDetails, type DetailsResult } from "../../actions";
import { Marker, routeOf } from "../../field-routing";

type Company = { id: string; name: string };

/**
 * What the job is called and who it is for: its title, the company that pays
 * for it and the one that represents the customer above them.
 *
 * Laid out like Job details, and saved by the same action: a field this form
 * does not hold is not sent, and a field not sent is a field nobody touched.
 * The title goes the way that person may send it — straight on, or to a
 * supervisor — and says which before anything is pressed. The two companies
 * are a planner's decision and are only offered to one.
 */
export function JobManagementForm({
  jobId,
  title: savedTitle,
  clientId: savedClientId,
  repCompanyId: savedRepCompanyId,
  clients,
  repCompanies,
  clientFixed,
  canChangeClient,
  moving,
  canEditPlanned,
  canFillMissing,
  canSuggest,
  pendingTitle,
}: {
  jobId: string;
  title: string;
  clientId: string;
  repCompanyId: string;
  /** The directory's paying companies, the job's own among them. */
  clients: Company[];
  repCompanies: Company[];
  /** Why the paying company can no longer change, or null when it can. */
  clientFixed: string | null;
  /** A planner who also runs the job's project, where it has one. */
  canChangeClient: boolean;
  /** What moving to another company brings, said before it is saved. */
  moving: {
    /** The coordinator on the job works for the current company. */
    coordinator: boolean;
    /** Blanks copied from the current company's templates. */
    oldBlanks: number;
    /** Each company's standing forms, by id. */
    formsOf: Record<string, number>;
  };
  canEditPlanned: boolean;
  canFillMissing: boolean;
  canSuggest: boolean;
  /** A new title this person already has waiting on a supervisor. */
  pendingTitle?: string;
}) {
  const [title, setTitle] = useState(savedTitle);
  const [clientId, setClientId] = useState(savedClientId);
  const [repCompanyId, setRepCompanyId] = useState(savedRepCompanyId);

  // As on Job details: the reason is asked for once, after the button, and
  // only when something is going to a supervisor.
  const [asking, setAsking] = useState(false);

  const [state, action, pending] = useActionState<DetailsResult | null, FormData>(
    async (previous, formData) => {
      const result = await saveJobDetails(previous, formData);
      if (result.ok) setAsking(false);
      return result;
    },
    null,
  );

  const titleRoute = routeOf({
    current: savedTitle,
    next: title,
    canEditPlanned,
    canFillMissing,
    canSuggest,
  });
  const clientChanged = clientId !== savedClientId;
  const repChanged = repCompanyId !== savedRepCompanyId;
  const anyChanged = titleRoute !== "unchanged" || clientChanged || repChanged;
  const anySuggested = titleRoute === "suggest";
  const clientLocked = !canChangeClient || clientFixed !== null;
  const movingTo = clients.find((client) => client.id === clientId)?.name ?? "";
  const newForms = moving.formsOf[clientId] ?? 0;
  const consequences = [
    moving.coordinator ? "their coordinator is taken off the job" : null,
    moving.oldBlanks > 0
      ? `${moving.oldBlanks === 1 ? "one blank" : `${moving.oldBlanks} blanks`} of theirs stay${moving.oldBlanks === 1 ? "s" : ""} attached`
      : null,
    newForms > 0
      ? `${newForms === 1 ? "one form" : `${newForms} forms`} of ${movingTo}'s ${newForms === 1 ? "is" : "are"} attached`
      : null,
  ].filter(Boolean);

  return (
    <form
      // Sent by hand rather than as the form's action: React resets a form its
      // action has saved, and the two company boxes here are held by the page —
      // they went on showing the first company in the list while holding the
      // one saved.
      onSubmit={(event) => {
        event.preventDefault();
        // Enter in the title box submits a form with one text box straight
        // away; a suggestion still asks why first.
        if (anySuggested && !asking) {
          setAsking(true);
          return;
        }
        const formData = new FormData(event.currentTarget);
        startTransition(() => action(formData));
      }}
      className="flex flex-col gap-4"
    >
      <input type="hidden" name="jobId" value={jobId} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1 sm:col-span-2">
          <Field label="Job title" htmlFor="manage-title">
            <Input
              id="manage-title"
              name="title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </Field>
          <Marker field="title" going={titleRoute} waiting={pendingTitle} />
        </div>

        <div className="flex flex-col gap-1">
          <Field
            label="Paying company"
            htmlFor="manage-client"
            hint={
              !canEditPlanned
                ? "Set by whoever plans the job."
                : !canChangeClient
                  ? "Set by whoever runs the job's project."
                  : clientFixed
                    ? `Can no longer change. ${clientFixed}`
                    : "Who pays for this job and whose paperwork it carries."
            }
          >
            {/* Not sent while it cannot change: a disabled box sends nothing,
                and nothing sent is nothing touched. */}
            <Select
              id="manage-client"
              name="clientId"
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
              disabled={clientLocked}
            >
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </Select>
          </Field>
          {clientChanged ? (
            <p className="text-xs text-warning">
              Moving the job to {movingTo}
              {consequences.length > 0 ? `: ${consequences.join("; ")}.` : "."}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1">
          <Field
            label="Rep company"
            htmlFor="manage-rep"
            hint={
              canEditPlanned
                ? "Who represents the customer above the paying company."
                : "Set by whoever plans the job."
            }
          >
            <Select
              id="manage-rep"
              name="repCompanyId"
              value={repCompanyId}
              onChange={(event) => setRepCompanyId(event.target.value)}
              disabled={!canEditPlanned}
            >
              <option value="">— none —</option>
              {repCompanies.map((repCompany) => (
                <option key={repCompany.id} value={repCompany.id}>
                  {repCompany.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </div>

      {state && !state.ok ? <p className="text-sm text-danger">{state.error}</p> : null}

      {state?.ok ? (
        <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface-raised p-3 text-sm">
          {state.saved && state.saved.length > 0 ? (
            <p>Changed on the job: {state.saved.join(", ")}.</p>
          ) : null}
          {state.notes?.map((note) => (
            <p key={note} className="text-muted-foreground">
              {note}
            </p>
          ))}
          {state.suggested && state.suggested.length > 0 ? (
            <p className="text-warning">
              Sent for approval: {state.suggested.join(", ")}. Nothing changes on the job until a
              supervisor says yes.
            </p>
          ) : null}
        </div>
      ) : null}

      {asking && anySuggested ? (
        <div className="flex flex-col gap-3 rounded-xl border border-warning/40 bg-warning/10 p-3">
          <Field
            label="Why?"
            htmlFor="manage-reason"
            hint="Goes to the supervisor with the new title."
          >
            <Input
              id="manage-reason"
              name="reason"
              autoFocus
              placeholder="The customer calls it something else"
            />
          </Field>
          <div className="flex gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Sending…" : "Send for approval"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setAsking(false)} disabled={pending}>
              Back
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          {anySuggested ? (
            <Button type="button" disabled={pending || !anyChanged} onClick={() => setAsking(true)}>
              Submit
            </Button>
          ) : (
            <Button type="submit" disabled={pending || !anyChanged}>
              {pending ? "Saving…" : "Save changes"}
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setTitle(savedTitle);
              setClientId(savedClientId);
              setRepCompanyId(savedRepCompanyId);
            }}
            disabled={pending || !anyChanged}
          >
            Undo my changes
          </Button>
        </div>
      )}

      <p className={cn("text-xs text-muted-foreground", anyChanged || "hidden")}>
        Nothing is written until you press the button.
      </p>
    </form>
  );
}
