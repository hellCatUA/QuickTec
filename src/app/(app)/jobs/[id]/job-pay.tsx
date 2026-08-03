"use client";

import { Loader2 } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { setJobPay } from "./actions";

/**
 * What this job pays, for everybody on it.
 *
 * A rate normally arrives from the tech, the project or the company. Every so
 * often a single job is none of those — a weekend cutover at overtime, a flat
 * fee somebody negotiated on the phone — and until now the only way to record
 * that was to change the tech's standing rate, which then leaked into every
 * other job they touched.
 *
 * One rate for the job rather than one per person on it: the negotiation was
 * about the work, and two people doing the same night at different rates is a
 * mistake far more often than an intent.
 */
export function JobPay({
  jobId,
  payType,
  payRate,
  travelReimbursement,
  note,
  canEdit,
}: {
  jobId: string;
  payType: string;
  payRate: string;
  travelReimbursement: string | null;
  /** Where the current rate came from, when it was not set here. */
  note: string | null;
  canEdit: boolean;
}) {
  const [type, setType] = React.useState(payType);
  const [rate, setRate] = React.useState(payRate);
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
      formData.set("payType", type);
      formData.set("payRate", rate);
      formData.set("travelReimbursement", travel);

      const result = await setJobPay(formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSaved(true);
    });
  }

  if (!canEdit) return null;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Pay type" htmlFor="job-pay-type">
          <Select
            id="job-pay-type"
            value={type}
            onChange={(event) => setType(event.target.value)}
          >
            <option value="HOURLY">Hourly</option>
            <option value="FLAT">Flat rate</option>
            <option value="NON_BILLABLE">Non-billable</option>
          </Select>
        </Field>

        <Field label="Pay rate ($)" htmlFor="job-pay-rate">
          <Input
            id="job-pay-rate"
            type="number"
            step="0.01"
            min={0}
            value={rate}
            onChange={(event) => setRate(event.target.value)}
          />
        </Field>

        <Field
          label="Travel reimbursement ($)"
          htmlFor="job-pay-travel"
          hint="Money the customer allocates for travel on this job. Separate from mileage, which is a write-off record."
          className="sm:col-span-2"
        >
          <Input
            id="job-pay-travel"
            type="number"
            step="0.01"
            min={0}
            value={travel}
            onChange={(event) => setTravel(event.target.value)}
            placeholder="None"
          />
        </Field>
      </div>

      {note ? (
        <p className="text-xs text-muted-foreground">{note}</p>
      ) : null}
      {error ? <p className="text-sm text-danger">{error}</p> : null}

      <div className="flex items-center gap-2">
        <Button type="button" size="sm" disabled={pending} onClick={save}>
          {pending ? <Loader2 className="animate-spin" /> : null}
          Apply to everybody on this job
        </Button>
        {saved ? (
          <span className="text-xs text-success">Saved</span>
        ) : null}
      </div>
    </div>
  );
}
