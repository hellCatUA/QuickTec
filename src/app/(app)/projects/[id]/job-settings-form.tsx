"use client";

import { useActionState, useState } from "react";
import { Field, Input, Select } from "@/components/ui/field";
import { FormStatus, type SaveState } from "@/components/ui/form-status";
import { saveProjectJobSettings, type ActionResult } from "../actions";

export type JobSettingsValues = {
  id: string;
  breakPaid: boolean;
  defaultJobTitle: string | null;
  travelReimbursement: string | null;
  defaultPayType: string | null;
  defaultPayRate: string | null;
};

/**
 * What every job under this project starts as.
 *
 * Work inside one project is the same sentence forty times over with the site
 * changed, so the parts that repeat are set once here. Everything remains
 * editable per job — these are starting points, not rules.
 */
export function JobSettingsForm({
  project,
  clientName,
  repCompanyName,
  canSetPay,
}: {
  project: JobSettingsValues;
  /** Shown, not edited: the companies are the project's, set in its details. */
  clientName: string;
  repCompanyName: string | null;
  /** Pay and travel are money, set only by whoever may set pay. */
  canSetPay: boolean;
}) {
  const [state, formAction, pending] = useActionState<
    ActionResult | null,
    FormData
  >(async (prev, formData) => saveProjectJobSettings(prev, formData), null);
  const [payType, setPayType] = useState(project.defaultPayType ?? "");

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={project.id} />

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="breakPaid"
          defaultChecked={project.breakPaid}
          className="size-5 accent-[var(--color-primary)]"
        />
        Paid Breaks
      </label>
      <span className="-mt-2 text-xs text-muted-foreground">
        A job can still be switched either way while it runs, and changing it
        there moves the breaks already logged with it.
      </span>

      <div className="border-t border-border pt-4">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Job prefill
        </div>
        <p className="mb-3 text-xs text-muted-foreground">
          Filled in when a job is raised under this project. Every one of these
          can be changed on the job itself.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Job title"
            htmlFor="defaultJobTitle"
            className="sm:col-span-2"
          >
            <Input
              id="defaultJobTitle"
              name="defaultJobTitle"
              defaultValue={project.defaultJobTitle ?? ""}
              placeholder="Switch replacement"
              autoComplete="off"
            />
          </Field>

          {/* Said here because they are what a new job is filed under, and
              set in Details because they are what the project is. */}
          <div className="flex flex-col gap-1 text-sm sm:col-span-2">
            <div>
              <span className="text-muted-foreground">Paying company: </span>
              <span className="font-medium">{clientName}</span>
              <span className="text-muted-foreground"> · Rep company: </span>
              <span className="font-medium">{repCompanyName ?? "none"}</span>
            </div>
            <span className="text-xs text-muted-foreground">
              Both go onto every job raised here. Change them under Details
              above.
            </span>
          </div>

          {canSetPay ? (
            <>
              <Field
                label="Pay type"
                htmlFor="defaultPayType"
                hint="Every job raised here starts on this, for its whole crew — over each tech's own rate. It can still be changed on the job before it is created."
              >
                <Select
                  id="defaultPayType"
                  name="defaultPayType"
                  value={payType}
                  onChange={(event) => setPayType(event.target.value)}
                >
                  <option value="">— each tech&rsquo;s own rate —</option>
                  <option value="HOURLY">Hourly</option>
                  <option value="FLAT">Flat rate</option>
                  <option value="NON_BILLABLE">Non-billable</option>
                </Select>
              </Field>

              {payType === "NON_BILLABLE" ? null : (
                <Field label="Pay rate ($)" htmlFor="defaultPayRate">
                  <Input
                    id="defaultPayRate"
                    name="defaultPayRate"
                    type="number"
                    step="0.01"
                    min={0}
                    defaultValue={project.defaultPayRate ?? ""}
                    placeholder={payType ? "Required with a pay type" : "Leave blank"}
                  />
                </Field>
              )}

              <Field
                label="Travel reimbursement ($)"
                htmlFor="travelReimbursement"
                hint="Money the customer allocates for travel. Separate from mileage, which is a write-off record."
                className="sm:col-span-2"
              >
                <Input
                  id="travelReimbursement"
                  name="travelReimbursement"
                  type="number"
                  step="0.01"
                  min={0}
                  defaultValue={project.travelReimbursement ?? ""}
                  placeholder="Leave blank for none"
                />
              </Field>
            </>
          ) : null}
        </div>
      </div>

      <FormStatus
        state={state as SaveState}
        pending={pending}
        label="Save job settings"
        size="md"
      />
    </form>
  );
}
