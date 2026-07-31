"use client";

import { useActionState } from "react";
import { Field, Input, Select } from "@/components/ui/field";
import { FormStatus, type SaveState } from "@/components/ui/form-status";
import { PAY_TYPE_LABEL } from "@/lib/money";
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
}: {
  project: JobSettingsValues;
  /** Shown, not edited: the company is the project's, set in its details. */
  clientName: string;
}) {
  const [state, formAction, pending] = useActionState<
    ActionResult | null,
    FormData
  >(async (prev, formData) => saveProjectJobSettings(prev, formData), null);

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

          <Field
            label="Representing company"
            htmlFor="prefill-client"
            hint="The project's own — change it in Details if it is wrong."
          >
            <Input id="prefill-client" value={clientName} readOnly disabled />
          </Field>

          <Field
            label="Travel reimbursement ($)"
            htmlFor="travelReimbursement"
            hint="Money the customer allocates for travel. Separate from mileage, which is a write-off record."
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

          <Field
            label="Pay type"
            htmlFor="defaultPayType"
            hint="For anybody on this project with no rate of their own. Their own project or company rate still wins."
          >
            <Select
              id="defaultPayType"
              name="defaultPayType"
              defaultValue={project.defaultPayType ?? ""}
            >
              <option value="">— none —</option>
              {Object.entries(PAY_TYPE_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Pay rate ($)" htmlFor="defaultPayRate">
            <Input
              id="defaultPayRate"
              name="defaultPayRate"
              type="number"
              step="0.01"
              min={0}
              defaultValue={project.defaultPayRate ?? ""}
              placeholder="Leave blank for none"
            />
          </Field>
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
