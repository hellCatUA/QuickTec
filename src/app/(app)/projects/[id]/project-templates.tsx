"use client";

import * as React from "react";
import { FormStatus, type SaveState } from "@/components/ui/form-status";
import { saveProjectTemplates, type ActionResult } from "../actions";

type Template = {
  id: string;
  label: string;
  kind: "CLIENT_WORK_ORDER" | "SIGN_OFF";
  isDefault: boolean;
};

/**
 * Which of the paying company's blanks a new job here starts with.
 *
 * Left alone, a job gets the company's usual ones — the blanks it has marked
 * as defaults. A project whose work goes out on a different sheet, or on none
 * at all, says so once here instead of on every job raised under it. Either
 * way the planner can still change it on the job before it is created.
 */
export function ProjectTemplates({
  projectId,
  clientName,
  templates,
  own,
  chosen,
}: {
  projectId: string;
  clientName: string;
  templates: Template[];
  own: boolean;
  chosen: string[];
}) {
  const [mode, setMode] = React.useState<"company" | "own">(own ? "own" : "company");
  const [picked, setPicked] = React.useState<string[]>(() =>
    own ? chosen : templates.filter((one) => one.isDefault).map((one) => one.id),
  );
  const [state, action, pending] = React.useActionState<
    ActionResult | null,
    FormData
  >(async (_previous, formData) => saveProjectTemplates(formData), null);

  if (templates.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {clientName} has no blanks on file. Add them to the company in the
        directory and they can be chosen here.
      </p>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="own" value={mode === "own" ? "true" : "false"} />

      <label className="flex items-start gap-2 text-sm">
        <input
          type="radio"
          checked={mode === "company"}
          onChange={() => setMode("company")}
          className="mt-0.5 size-4 accent-[var(--color-primary)]"
        />
        <span>
          {clientName}&rsquo;s usual blanks
          <span className="block text-xs text-muted-foreground">
            {templates.filter((one) => one.isDefault).length > 0
              ? templates
                  .filter((one) => one.isDefault)
                  .map((one) => one.label)
                  .join(", ")
              : "None marked as usual."}
          </span>
        </span>
      </label>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="radio"
          checked={mode === "own"}
          onChange={() => setMode("own")}
          className="mt-0.5 size-4 accent-[var(--color-primary)]"
        />
        <span>
          These, for this project
          <span className="block text-xs text-muted-foreground">
            Ticking none means its jobs start with no blank at all.
          </span>
        </span>
      </label>

      {mode === "own" ? (
        <div className="ml-6 flex flex-col gap-1">
          {templates.map((template) => (
            <label key={template.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="templateIds"
                value={template.id}
                checked={picked.includes(template.id)}
                onChange={(event) =>
                  setPicked((current) =>
                    event.target.checked
                      ? [...current, template.id]
                      : current.filter((id) => id !== template.id),
                  )
                }
                className="size-4 accent-[var(--color-primary)]"
              />
              {template.label}
              <span className="text-xs text-muted-foreground">
                {template.kind === "SIGN_OFF" ? "sign-off sheet" : "work order"}
              </span>
            </label>
          ))}
        </div>
      ) : null}

      <FormStatus state={state as SaveState} pending={pending} label="Save paperwork" />
    </form>
  );
}
