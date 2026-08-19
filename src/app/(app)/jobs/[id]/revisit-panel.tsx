"use client";

import { RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { FormStatus, type SaveState } from "@/components/ui/form-status";
import { type RevisitCarry } from "@/lib/revisit";
import { createRevisit, type ActionResult } from "../actions";

/** Somebody who worked the original job. */
export type RevisitCrew = { id: string; name: string; isLead: boolean };

/** What the original has to offer, so nothing is proposed that is not there. */
export type RevisitSource = {
  scope: boolean;
  deliverables: number;
  tickets: string[];
  estimate: string | null;
  pay: string | null;
  dispatch: number;
  signOff: boolean;
};

/**
 * What can be started from, in the order somebody thinks about a job.
 *
 * Everything is offered ticked. A revisit is the same work at the same site
 * for the same people, and the planner is here to say what is *different*
 * about this trip — which is a much shorter list than what is the same.
 */
const CARRIES: {
  key: RevisitCarry;
  label: string;
  detail: (source: RevisitSource) => string | null;
}[] = [
  {
    key: "scope",
    label: "Scope of work",
    detail: (source) => (source.scope ? null : "The original has none."),
  },
  {
    key: "deliverables",
    label: "Deliverables",
    detail: (source) =>
      source.deliverables > 0
        ? `${source.deliverables} section${source.deliverables === 1 ? "" : "s"} as this job asked for them.`
        : "The original has no sheet of its own — the project's applies.",
  },
  {
    key: "tickets",
    label: "Ticket and INC numbers",
    detail: (source) =>
      source.tickets.length > 0
        ? source.tickets.join(", ")
        : "The original has none.",
  },
  {
    key: "estimate",
    label: "Estimate and crew size",
    detail: (source) => source.estimate,
  },
  {
    key: "pay",
    label: "Job pay and break rule",
    detail: (source) => source.pay,
  },
  {
    key: "dispatch",
    label: "Dispatch numbers",
    detail: (source) =>
      source.dispatch > 0
        ? `${source.dispatch} number${source.dispatch === 1 ? "" : "s"}, and the coordinator.`
        : "The original has none of its own.",
  },
  {
    key: "signOff",
    label: "Sign-off blank",
    detail: (source) =>
      source.signOff
        ? "A fresh copy of the same company blank."
        : "The original is not carrying one.",
  },
];

export function RevisitPanel({
  jobId,
  jobTitle,
  externalAssignmentId,
  crew = [],
  canAssign = false,
  source,
}: {
  jobId: string;
  jobTitle: string;
  externalAssignmentId: string | null;
  crew?: RevisitCrew[];
  canAssign?: boolean;
  source: RevisitSource;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"same" | "new">(
    externalAssignmentId ? "same" : "new",
  );

  const [carry, setCarry] = useState<RevisitCarry[]>(() =>
    CARRIES.map((entry) => entry.key),
  );
  // Resolved afresh by default: a revisit is a new job, and a rate copied
  // from a month ago is the kind of thing nobody notices until payroll.
  const [rates, setRates] = useState<"fresh" | "keep">("fresh");

  // Ticked by default: a revisit is the same work at the same site, and the
  // overwhelmingly common case is the same person going back. Untick anybody
  // who is not.
  const [going, setGoing] = useState<string[]>(() =>
    crew.map((person) => person.id),
  );
  const [leadId, setLeadId] = useState<string | null>(
    () => crew.find((person) => person.isLead)?.id ?? null,
  );

  const effectiveLead = leadId && going.includes(leadId) ? leadId : going[0];

  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async (prev, formData) => {
      const result = await createRevisit(prev, formData);
      if (result.ok && result.id) router.push(`/jobs/${result.id}`);
      return result;
    },
    null,
  );

  if (!open) {
    return (
      <Button
        type="button"
        variant="secondary"
        className="self-start"
        onClick={() => setOpen(true)}
      >
        <RotateCcw /> Schedule a revisit
      </Button>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="parentJobId" value={jobId} />

      <Field label="Title" htmlFor="revisit-title">
        <Input
          id="revisit-title"
          name="title"
          defaultValue={`${jobTitle} (revisit)`}
          autoComplete="off"
        />
      </Field>

      <Field label="Scheduled start" htmlFor="revisit-when">
        <Input
          id="revisit-when"
          name="scheduledStart"
          type="datetime-local"
        />
      </Field>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Assignment ID
        </legend>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="radio"
            name="assignmentIdMode"
            value="same"
            checked={mode === "same"}
            onChange={() => setMode("same")}
            disabled={!externalAssignmentId}
            className="mt-0.5 size-4 accent-[var(--color-primary)]"
          />
          <span>
            Client reused the original
            <span className="block text-xs text-muted-foreground">
              {externalAssignmentId
                ? `Stored as R-${externalAssignmentId.replace(/^R-/, "")} so the two are told apart.`
                : "The original job has no Assignment ID recorded."}
            </span>
          </span>
        </label>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="radio"
            name="assignmentIdMode"
            value="new"
            checked={mode === "new"}
            onChange={() => setMode("new")}
            className="mt-0.5 size-4 accent-[var(--color-primary)]"
          />
          <span>
            Client issued a new one
            <span className="block text-xs text-muted-foreground">
              Stored as given. Our internal number still gets its -R suffix.
            </span>
          </span>
        </label>
      </fieldset>

      {mode === "new" ? (
        <Field label="New Assignment ID" htmlFor="revisit-aid">
          <Input
            id="revisit-aid"
            name="externalAssignmentId"
            required
            autoComplete="off"
          />
        </Field>
      ) : null}

      {/* Without this the revisit was created with nobody on it, and the tech
          told to go back could not clock in — nor even see the job. */}
      {canAssign && crew.length > 0 ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Going back
          </legend>

          {crew.map((person) => {
            const ticked = going.includes(person.id);
            return (
              <div
                key={person.id}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2"
              >
                <label className="flex min-w-0 flex-1 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={ticked}
                    onChange={() =>
                      setGoing((was) =>
                        ticked
                          ? was.filter((id) => id !== person.id)
                          : [...was, person.id],
                      )
                    }
                    className="size-4 accent-[var(--color-primary)]"
                  />
                  <span className="truncate">{person.name}</span>
                </label>

                {ticked ? <input type="hidden" name="crewIds" value={person.id} /> : null}

                {ticked ? (
                  <label className="flex items-center gap-1.5 text-xs">
                    <input
                      type="radio"
                      name="leadId"
                      value={person.id}
                      checked={effectiveLead === person.id}
                      onChange={() => setLeadId(person.id)}
                      className="size-4 accent-[var(--color-primary)]"
                    />
                    Lead
                  </label>
                ) : null}
              </div>
            );
          })}

          {going.length === 0 ? (
            <p className="text-xs text-warning">
              Nobody is going back. The revisit will be created with no crew,
              and nobody will be able to clock in on it until someone is added.
            </p>
          ) : null}

          {/* Only worth asking once somebody is actually going. */}
          {going.length > 0 ? (
            <div className="flex flex-col gap-1 rounded-lg border border-border p-2">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Their rates
              </span>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  name="rates"
                  value="fresh"
                  checked={rates === "fresh"}
                  onChange={() => setRates("fresh")}
                  className="mt-0.5 size-4 accent-[var(--color-primary)]"
                />
                <span>
                  Work them out again
                  <span className="block text-xs text-muted-foreground">
                    Their own rate, then the project&rsquo;s — as if they were
                    being put on a new job today.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  name="rates"
                  value="keep"
                  checked={rates === "keep"}
                  onChange={() => setRates("keep")}
                  className="mt-0.5 size-4 accent-[var(--color-primary)]"
                />
                <span>
                  Keep what they were on
                  <span className="block text-xs text-muted-foreground">
                    Exactly what the original visit paid them, whatever has
                    changed since.
                  </span>
                </span>
              </label>
              <p className="text-xs text-muted-foreground">
                Anybody deliberately put on their own rate keeps it either way.
              </p>
            </div>
          ) : null}
        </fieldset>
      ) : null}

      {canAssign && crew.length === 0 ? (
        <p className="text-xs text-warning">
          The original job has no crew recorded, so the revisit will have none
          either. Add somebody to it once it exists.
        </p>
      ) : null}

      {/* Everything else the original is carrying. Offered ticked: the planner
          is here to say what is different about this trip, and that is a much
          shorter list than what is the same. */}
      <fieldset className="flex flex-col gap-1">
        <legend className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Start from the original
        </legend>

        {CARRIES.map((entry) => {
          const ticked = carry.includes(entry.key);
          const detail = entry.detail(source);
          return (
            <label
              key={entry.key}
              className="flex items-start gap-2 rounded-lg p-1.5 text-sm hover:bg-muted"
            >
              <input
                type="checkbox"
                name="carry"
                value={entry.key}
                checked={ticked}
                onChange={() =>
                  setCarry((was) =>
                    ticked
                      ? was.filter((key) => key !== entry.key)
                      : [...was, entry.key],
                  )
                }
                className="mt-0.5 size-4 accent-[var(--color-primary)]"
              />
              <span className="min-w-0">
                {entry.label}
                {detail ? (
                  <span className="block truncate text-xs text-muted-foreground">
                    {detail}
                  </span>
                ) : null}
              </span>
            </label>
          );
        })}

        <p className="pt-1 text-xs text-muted-foreground">
          The site, customer, representing company and project always come
          across — that is what makes this a revisit. The original&rsquo;s work
          order does not: a return trip is issued its own.
        </p>
      </fieldset>

      <div className="flex items-center gap-2">
        <FormStatus
          state={state as SaveState}
          pending={pending}
          label="Create revisit"
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setOpen(false)}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
