"use client";

import { RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { FormStatus, type SaveState } from "@/components/ui/form-status";
import { createRevisit, type ActionResult } from "../actions";

export function RevisitPanel({
  jobId,
  jobTitle,
  externalAssignmentId,
}: {
  jobId: string;
  jobTitle: string;
  externalAssignmentId: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"same" | "new">(
    externalAssignmentId ? "same" : "new",
  );

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
