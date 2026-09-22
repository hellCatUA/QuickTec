"use client";

import { Loader2 } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { setJobTravel } from "../../actions";

/**
 * Travel money, on its own.
 *
 * It used to be the third field on the job's rate form, which meant it
 * disappeared the day the job went onto a total tech budget and the rate form
 * went away. Travel is not part of what the work pays — it is what the customer
 * allocates for getting there — so it keeps its own block and its own save.
 */
export function TravelForm({
  jobId,
  travelReimbursement,
  note,
}: {
  jobId: string;
  travelReimbursement: string | null;
  /** Where the current figure came from, when it was not set here. */
  note: string | null;
}) {
  const [travel, setTravel] = React.useState(travelReimbursement ?? "");
  const [saved, setSaved] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function save() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("jobId", jobId);
      formData.set("travelReimbursement", travel);

      const result = await setJobTravel(formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSaved(true);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <Field
        label="Travel reimbursement ($)"
        htmlFor="job-travel"
        hint="Separate from mileage, which is a write-off record."
      >
        <Input
          id="job-travel"
          type="number"
          step="0.01"
          min={0}
          value={travel}
          onChange={(event) => setTravel(event.target.value)}
          placeholder="None"
        />
      </Field>

      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
      {error ? <p className="text-sm text-danger">{error}</p> : null}

      <div className="flex items-center gap-2">
        <Button type="button" size="sm" disabled={pending} onClick={save}>
          {pending ? <Loader2 className="animate-spin" /> : null}
          Save travel
        </Button>
        {saved ? <span className="text-xs text-success">Saved</span> : null}
      </div>
    </div>
  );
}
