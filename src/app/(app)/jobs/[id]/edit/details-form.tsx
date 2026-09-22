"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboOption } from "@/components/ui/combobox";
import { Field, Input } from "@/components/ui/field";
import { MarkdownEditor } from "@/components/ui/markdown-editor";
import { cn } from "@/lib/utils";
import { Marker, routeOf, type Route } from "../field-routing";
import { saveJobDetails, type DetailsResult } from "../actions";

export type DetailValues = {
  siteId: string;
  externalAssignmentId: string;
  ticketNumber: string;
  incNumber: string;
  scopeOfWork: string;
};

/** A site, with enough of its customer to pick the two separately. */
export type SiteOption = ComboOption & {
  customerId: string;
  customerName: string;
};

/**
 * Correcting what was decided when the job was raised.
 *
 * Every field says, before anything is pressed, where it is going: straight
 * onto the job, or to a supervisor. A tech on site is the person most likely to
 * find the mistake and least likely to be allowed to fix it, and being told
 * that after pressing Save is how people stop reporting mistakes.
 *
 * Two fields to a row from 640px. On a phone one column is the only honest
 * layout; on anything wider a single column of short boxes makes a form look
 * three times as long as it is, and the pairs here belong together anyway —
 * the customer with their site, the ticket with the incident.
 *
 * When the crew is due, how long it should take and how many go are *not*
 * here. They are the job's schedule, and they live with the crew and the
 * budget under Schedule & Budget.
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
  sites: SiteOption[];
  canEditPlanned: boolean;
  canFillMissing: boolean;
  canSuggest: boolean;
  /** What this person already has waiting on a supervisor, by field. */
  pending: Partial<Record<keyof DetailValues, string>>;
}) {
  const [siteId, setSiteId] = useState(values.siteId);
  const [customerId, setCustomerId] = useState(
    sites.find((site) => site.value === values.siteId)?.customerId ?? "",
  );
  const [assignmentId, setAssignmentId] = useState(values.externalAssignmentId);
  const [ticket, setTicket] = useState(values.ticketNumber);
  const [inc, setInc] = useState(values.incNumber);
  const [scope, setScope] = useState(values.scopeOfWork);

  // The reason is asked once, after the button is pressed, rather than sitting
  // open above it: on a form where most saves need no reason at all, a box
  // that is usually irrelevant is a box people learn to scroll past.
  const [asking, setAsking] = useState(false);

  const [state, action, pending] = useActionState<
    DetailsResult | null,
    FormData
  >(saveJobDetails, null);

  const customers: ComboOption[] = [];
  for (const site of sites) {
    if (customers.some((one) => one.value === site.customerId)) continue;
    customers.push({ value: site.customerId, label: site.customerName });
  }
  customers.sort((a, b) => a.label.localeCompare(b.label));

  const sitesOfCustomer = customerId
    ? sites.filter((site) => site.customerId === customerId)
    : sites;

  /** Where this field would go if it were changed right now. */
  function route(field: keyof DetailValues, next: string): Route {
    return routeOf({
      current: String(values[field] ?? ""),
      next,
      canEditPlanned,
      canFillMissing,
      canSuggest,
    });
  }

  const routes = {
    siteId: route("siteId", siteId),
    externalAssignmentId: route("externalAssignmentId", assignmentId),
    ticketNumber: route("ticketNumber", ticket),
    incNumber: route("incNumber", inc),
    scopeOfWork: route("scopeOfWork", scope),
  };
  const anySuggested = Object.values(routes).includes("suggest");
  const anyChanged = Object.values(routes).some((one) => one !== "unchanged");

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="jobId" value={jobId} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Field
            label="Customer"
            htmlFor="detail-customer"
            hint="Narrows the sites below. The work order number does not change."
          >
            <Combobox
              id="detail-customer"
              value={customerId}
              onChange={(next) => {
                setCustomerId(next);
                // The site that was picked belongs to somebody else now, so it
                // is cleared rather than left as a mismatched pair.
                if (
                  next &&
                  sites.find((site) => site.value === siteId)?.customerId !==
                    next
                ) {
                  setSiteId("");
                }
              }}
              options={customers}
              allowClear={false}
              placeholder="Search a customer…"
            />
          </Field>
        </div>

        <div className="flex flex-col gap-1">
          <Field
            label="Site"
            htmlFor="detail-site"
            hint={
              customerId
                ? "Sites this customer has."
                : "Pick a customer first, or search every site."
            }
          >
            <Combobox
              id="detail-site"
              name="siteId"
              value={siteId}
              onChange={(next) => {
                setSiteId(next);
                const picked = sites.find((site) => site.value === next);
                if (picked) setCustomerId(picked.customerId);
              }}
              options={sitesOfCustomer}
              allowClear={false}
              placeholder="Search a site number or address…"
            />
          </Field>
          <Marker
            field="siteId"
            going={routes.siteId}
            waiting={pendingSuggestions.siteId}
          />
        </div>

        <div className="flex flex-col gap-1">
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
        </div>

        <div className="flex flex-col gap-1">
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
        </div>

        <div className="flex flex-col gap-1 sm:col-span-2">
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
          <Marker
            field="incNumber"
            going={routes.incNumber}
            waiting={pendingSuggestions.incNumber}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <Field label="Scope of work" htmlFor="detail-scope">
          <MarkdownEditor
            id="detail-scope"
            name="scopeOfWork"
            value={scope}
            onChange={setScope}
            rows={8}
          />
        </Field>
        <Marker
          field="scopeOfWork"
          going={routes.scopeOfWork}
          waiting={pendingSuggestions.scopeOfWork}
        />
      </div>

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

      {asking && anySuggested ? (
        <div className="flex flex-col gap-3 rounded-xl border border-warning/40 bg-warning/10 p-3">
          <Field
            label="Why?"
            htmlFor="detail-reason"
            hint="Goes to the supervisor with every change on this page that needs approving."
          >
            <Input
              id="detail-reason"
              name="reason"
              autoFocus
              placeholder="Dispatch read out the wrong store"
            />
          </Field>
          <div className="flex gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Sending…" : "Send for approval"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setAsking(false)}
              disabled={pending}
            >
              Back
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          {anySuggested ? (
            <Button
              type="button"
              disabled={pending || !anyChanged}
              onClick={() => setAsking(true)}
            >
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
              setSiteId(values.siteId);
              setCustomerId(
                sites.find((site) => site.value === values.siteId)
                  ?.customerId ?? "",
              );
              setAssignmentId(values.externalAssignmentId);
              setTicket(values.ticketNumber);
              setInc(values.incNumber);
              setScope(values.scopeOfWork);
            }}
            disabled={pending || !anyChanged}
          >
            Undo my changes
          </Button>
        </div>
      )}

      <p
        className={cn("text-xs text-muted-foreground", anyChanged || "hidden")}
      >
        Nothing is written until you press the button.
      </p>
    </form>
  );
}
