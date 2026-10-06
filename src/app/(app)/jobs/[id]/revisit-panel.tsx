"use client";

import { Check, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { FormStatus, type SaveState } from "@/components/ui/form-status";
import { createRevisit, type ActionResult } from "../actions";

/** Somebody who worked the original job. */
export type RevisitCrew = { id: string; name: string; isLead: boolean };

/** What the original has to offer, so nothing is proposed that is not there. */
export type RevisitSource = {
  scope: boolean;
  /** Sections switched on, when the original changed its sheet for itself; 0 when it follows the project. */
  deliverables: number;
  /** Its locations, which go with the deliverables. */
  locations: number;
  tickets: string[];
  estimate: string | null;
  /** Its pay and break rule, and travel, as one line. */
  pay: string;
  dispatch: number;
  /** MOD, POC and the rest of who is at the site. */
  contacts: number;
  /** Paid from a budget, which is re-split between whoever goes back. */
  budgeted: boolean;
  /** The paying company's coordinator is recorded on it. */
  coordinator: boolean;
  signOff: boolean;
};

/**
 * What comes across, in the order somebody thinks about a job.
 *
 * All of it. A revisit is the same work at the same site for the same people,
 * and it used to be put together from ticked boxes — so one left unticked
 * quietly became a different job: breaks paid, no travel, nobody to ring.
 * Now it starts as the original stands, and what is different about this trip
 * is changed on the revisit, where it can be seen.
 */
const COMES_ACROSS: {
  label: string;
  detail: (source: RevisitSource) => string | null;
}[] = [
  {
    label: "Scope of work",
    detail: (source) => (source.scope ? null : "The original has none."),
  },
  {
    label: "Deliverables",
    detail: (source) => {
      const places =
        source.locations > 0
          ? ` Its ${source.locations} location${source.locations === 1 ? "" : "s"} go with it.`
          : "";
      return source.deliverables > 0
        ? `${source.deliverables} section${source.deliverables === 1 ? "" : "s"} on, as this job changed them.${places}`
        : `It follows the project's sections, and so will the revisit.${places}`;
    },
  },
  {
    label: "Ticket and INC numbers",
    detail: (source) =>
      source.tickets.length > 0
        ? source.tickets.join(", ")
        : "The original has none.",
  },
  {
    label: "Estimate and crew size",
    detail: (source) => source.estimate,
  },
  {
    label: "Pay, breaks and travel",
    detail: (source) => source.pay,
  },
  {
    label: "Dispatch numbers and the coordinator",
    detail: (source) =>
      [
        source.dispatch > 0
          ? `${source.dispatch} number${source.dispatch === 1 ? "" : "s"} of its own`
          : "No numbers of its own",
        source.coordinator ? "and the coordinator." : "and no coordinator recorded.",
      ].join(", "),
  },
  {
    label: "Who is at the site",
    detail: (source) =>
      source.contacts > 0
        ? `${source.contacts} contact${source.contacts === 1 ? "" : "s"} — MOD, POC and the rest.`
        : "The original has none recorded.",
  },
  {
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

          {going.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              {source.budgeted
                ? "The budget comes across and is shared between whoever goes back."
                : "Each goes back on the rate they were on, and the job's travel."}{" "}
              Change anybody&rsquo;s on the revisit if this trip pays differently.
            </p>
          ) : null}
        </fieldset>
      ) : null}

      {canAssign && crew.length === 0 ? (
        <p className="text-xs text-warning">
          The original job has no crew recorded, so the revisit will have none
          either. Add somebody to it once it exists.
        </p>
      ) : null}

      <div className="flex flex-col gap-1">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Comes across from the original
        </div>
        <ul className="flex flex-col gap-1">
          {COMES_ACROSS.map((entry) => {
            const detail = entry.detail(source);
            return (
              <li key={entry.label} className="flex items-start gap-2 p-1.5 text-sm">
                <Check className="mt-0.5 size-4 shrink-0 text-success" />
                <span className="min-w-0">
                  {entry.label}
                  {detail ? (
                    <span className="block truncate text-xs text-muted-foreground">
                      {detail}
                    </span>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
        <p className="pt-1 text-xs text-muted-foreground">
          So do the site, customer, paying and rep company and the project —
          that is what makes this a revisit. Change whatever is different about
          this trip on the revisit once it exists. The original&rsquo;s work
          order does not come across: a return trip is issued its own.
        </p>
      </div>

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
