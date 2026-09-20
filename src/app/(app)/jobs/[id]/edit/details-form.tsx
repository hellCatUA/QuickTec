"use client";

import { AlertTriangle, MessageSquarePlus } from "lucide-react";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboOption } from "@/components/ui/combobox";
import { Field, Input } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import { saveJobDetails, type DetailsResult } from "../actions";

export type DetailValues = {
  siteId: string;
  externalAssignmentId: string;
  ticketNumber: string;
  incNumber: string;
};

type Route = "unchanged" | "direct" | "suggest" | "no";

/** Where a field is about to go, said before anything is pressed. */
function Marker({
  field,
  going,
  waiting,
}: {
  field: keyof DetailValues;
  going: Route;
  waiting?: string;
}) {
  if (going === "suggest") {
    return (
      <span
        data-route={`${field}:suggest`}
        className="flex items-center gap-1 text-xs text-warning"
      >
        <MessageSquarePlus className="size-3.5 shrink-0" />
        Goes to a supervisor
      </span>
    );
  }
  if (going === "no") {
    return (
      <span
        data-route={`${field}:no`}
        className="flex items-center gap-1 text-xs text-danger">
        <AlertTriangle className="size-3.5 shrink-0" />
        You cannot change this one
      </span>
    );
  }
  if (waiting) {
    return (
      <span className="text-xs text-muted-foreground">
        Waiting on approval: {waiting}
      </span>
    );
  }
  return null;
}

/**
 * Correcting what was decided when the job was raised.
 *
 * Every field says, before anything is pressed, where it is going: straight
 * onto the job, or to a supervisor. A tech on site is the person most likely to
 * find the mistake and least likely to be allowed to fix it, and being told
 * that after pressing Save is how people stop reporting mistakes.
 */
export function DetailsForm({
  jobId,
  values,
  sites,
  canEditPlanned,
  canFillMissing,
  canSuggest,
  pending: pendingSuggestions,
}: {
  jobId: string;
  values: DetailValues;
  sites: ComboOption[];
  canEditPlanned: boolean;
  canFillMissing: boolean;
  canSuggest: boolean;
  /** What this person already has waiting on a supervisor, by field. */
  pending: Partial<Record<keyof DetailValues, string>>;
}) {
  const [siteId, setSiteId] = useState(values.siteId);
  const [assignmentId, setAssignmentId] = useState(values.externalAssignmentId);
  const [ticket, setTicket] = useState(values.ticketNumber);
  const [inc, setInc] = useState(values.incNumber);

  const [state, action, pending] = useActionState<
    DetailsResult | null,
    FormData
  >(saveJobDetails, null);

  /** Where this field would go if it were changed right now. */
  function route(field: keyof DetailValues, next: string): Route {
    if (String(values[field] ?? "") === next) return "unchanged";
    if (canEditPlanned) return "direct";
    const wasEmpty = String(values[field] ?? "") === "";
    if (wasEmpty) return canFillMissing ? "direct" : "no";
    return canSuggest ? "suggest" : "no";
  }

  const routes = {
    siteId: route("siteId", siteId),
    externalAssignmentId: route("externalAssignmentId", assignmentId),
    ticketNumber: route("ticketNumber", ticket),
    incNumber: route("incNumber", inc),
  };
  const anySuggested = Object.values(routes).includes("suggest");
  const anyChanged = Object.values(routes).some((one) => one !== "unchanged");

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="jobId" value={jobId} />

      <Field
        label="Customer &amp; site"
        htmlFor="detail-site"
        hint="The customer comes with the site. The work order number does not change."
      >
        <Combobox
          id="detail-site"
          name="siteId"
          value={siteId}
          onChange={setSiteId}
          options={sites}
          allowClear={false}
          placeholder="Search a site or a customer…"
        />
      </Field>
      <Marker field="siteId" going={routes.siteId} waiting={pendingSuggestions.siteId} />

      <Field label="Assignment ID" htmlFor="detail-assignment">
        <Input
          id="detail-assignment"
          name="externalAssignmentId"
          value={assignmentId}
          onChange={(event) => setAssignmentId(event.target.value)}
        />
      </Field>
      <Marker
        field="externalAssignmentId"
        going={routes.externalAssignmentId}
        waiting={pendingSuggestions.externalAssignmentId}
      />

      <Field label="Ticket #" htmlFor="detail-ticket">
        <Input
          id="detail-ticket"
          name="ticketNumber"
          value={ticket}
          onChange={(event) => setTicket(event.target.value)}
        />
      </Field>
      <Marker
        field="ticketNumber"
        going={routes.ticketNumber}
        waiting={pendingSuggestions.ticketNumber}
      />

      <Field
        label="INC #"
        htmlFor="detail-inc"
        hint="Plenty of work has no incident behind it."
      >
        <Input
          id="detail-inc"
          name="incNumber"
          value={inc}
          onChange={(event) => setInc(event.target.value)}
        />
      </Field>
      <Marker field="incNumber" going={routes.incNumber} waiting={pendingSuggestions.incNumber} />

      {anySuggested ? (
        <Field
          label="Why?"
          htmlFor="detail-reason"
          hint="Goes with every change on this page that needs approving."
        >
          <Input
            id="detail-reason"
            name="reason"
            placeholder="Dispatch read out the wrong store"
          />
        </Field>
      ) : null}

      {state && !state.ok ? (
        <p className="text-sm text-danger">{state.error}</p>
      ) : null}

      {state?.ok ? (
        <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface-raised p-3 text-sm">
          {state.saved && state.saved.length > 0 ? (
            <p>Changed on the job: {state.saved.join(", ")}.</p>
          ) : null}
          {state.suggested && state.suggested.length > 0 ? (
            <p className="text-warning">
              Sent for approval: {state.suggested.join(", ")}. Nothing changes
              on the job until a supervisor says yes.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="flex gap-2">
        <Button type="submit" disabled={pending || !anyChanged}>
          {pending
            ? "Saving…"
            : anySuggested
              ? "Send for approval"
              : "Save changes"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setSiteId(values.siteId);
            setAssignmentId(values.externalAssignmentId);
            setTicket(values.ticketNumber);
            setInc(values.incNumber);
          }}
          disabled={pending || !anyChanged}
        >
          Undo my changes
        </Button>
      </div>

      <p
        className={cn("text-xs text-muted-foreground", anyChanged || "hidden")}
      >
        Nothing is written until you press the button.
      </p>
    </form>
  );
}
