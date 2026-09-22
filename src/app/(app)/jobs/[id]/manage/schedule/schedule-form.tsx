"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { HoursPicker, Stepper } from "@/components/ui/stepper";
import { saveJobDetails, type DetailsResult } from "../../actions";
import { Marker, routeOf, type Route } from "../../field-routing";

/**
 * When the crew is due, how long it is expected to take and how many go.
 *
 * These three used to sit at the bottom of the job's details, between the
 * ticket numbers and the scope. They are not what the job *is* — they are what
 * it is scheduled as, which is the same question as who is on it and what it
 * pays, and now sits beside them.
 *
 * Same rules as the details form: whoever cannot change a planner's decision
 * outright is asking, and each field says so before Save is pressed.
 */
export type ScheduleValues = {
  /** Site-local, as a datetime-local box wants it. */
  scheduledStart: string;
  estimateMinutes: string;
  techsRequired: string;
};

export function ScheduleForm({
  jobId,
  values,
  canEditPlanned,
  canFillMissing,
  canSuggest,
  pending: pendingSuggestions,
}: {
  jobId: string;
  values: ScheduleValues;
  canEditPlanned: boolean;
  canFillMissing: boolean;
  canSuggest: boolean;
  pending: Partial<Record<keyof ScheduleValues, string>>;
}) {
  const [scheduled, setScheduled] = useState(values.scheduledStart);
  const [estimate, setEstimate] = useState<number | null>(
    values.estimateMinutes ? Number(values.estimateMinutes) : null,
  );
  const [techs, setTechs] = useState(Number(values.techsRequired) || 1);

  const [state, action, pending] = useActionState<
    DetailsResult | null,
    FormData
  >(saveJobDetails, null);

  function route(field: keyof ScheduleValues, next: string): Route {
    return routeOf({
      current: String(values[field] ?? ""),
      next,
      canEditPlanned,
      canFillMissing,
      canSuggest,
    });
  }

  const routes = {
    scheduledStart: route("scheduledStart", scheduled),
    estimateMinutes: route(
      "estimateMinutes",
      estimate === null ? "" : String(estimate),
    ),
    techsRequired: route("techsRequired", String(techs)),
  };
  const anySuggested = Object.values(routes).includes("suggest");
  const anyChanged = Object.values(routes).some((one) => one !== "unchanged");

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="jobId" value={jobId} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1 sm:col-span-2">
          <Field
            label="Scheduled start"
            htmlFor="schedule-start"
            hint="Site time. Moving it moves the crew's calendars with it."
          >
            <Input
              id="schedule-start"
              name="scheduledStart"
              type="datetime-local"
              value={scheduled}
              onChange={(event) => setScheduled(event.target.value)}
            />
          </Field>
          <Marker
            field="scheduledStart"
            going={routes.scheduledStart}
            waiting={pendingSuggestions.scheduledStart}
          />
        </div>

        <div className="flex flex-col gap-1">
          <Field label="Estimated time" htmlFor="schedule-estimate">
            <HoursPicker
              name="estimateMinutes"
              minutes={estimate}
              onChange={setEstimate}
            />
          </Field>
          <Marker
            field="estimateMinutes"
            going={routes.estimateMinutes}
            waiting={pendingSuggestions.estimateMinutes}
          />
        </div>

        <div className="flex flex-col gap-1">
          <Field label="Techs required" htmlFor="schedule-techs">
            <Stepper
              name="techsRequired"
              value={techs}
              onChange={setTechs}
              min={1}
              max={12}
            />
          </Field>
          <Marker
            field="techsRequired"
            going={routes.techsRequired}
            waiting={pendingSuggestions.techsRequired}
          />
        </div>
      </div>

      {anySuggested ? (
        <Field
          label="Why?"
          htmlFor="schedule-reason"
          hint="Goes with every change here that needs approving."
        >
          <Input
            id="schedule-reason"
            name="reason"
            placeholder="Customer moved the window to the evening"
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

      <div>
        <Button type="submit" size="sm" disabled={pending || !anyChanged}>
          {pending
            ? "Saving…"
            : anySuggested
              ? "Send for approval"
              : "Save schedule"}
        </Button>
      </div>
    </form>
  );
}
