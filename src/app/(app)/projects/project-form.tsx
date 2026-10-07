"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Field, Input, Select } from "@/components/ui/field";
import { MarkdownEditor } from "@/components/ui/markdown-editor";
import { FormStatus, type SaveState } from "@/components/ui/form-status";
import {
  PmContactPicker,
  type ContactOption,
} from "./[id]/pm-contact";
import { saveProject, type ActionResult } from "./actions";

export type Option = { id: string; label: string };

export type ProjectFormValues = {
  id: string;
  name: string;
  code: string;
  /** Its jobs' numbers carry the ID, so it can no longer change. */
  codeLocked: boolean;
  clientProjectName: string | null;
  externalProjectId: string | null;
  repProjectName: string | null;
  repProjectId: string | null;
  clientId: string;
  repCompanyId: string | null;
  customerId: string | null;
  /** Jobs not yet signed off, which a company change can be applied to. */
  openJobs: number;
  managerId: string | null;
  pmContactId: string | null;
  generalScopeOfWork: string | null;
  status: string;
};

/**
 * What the project is: who it belongs to, who runs it, what it covers.
 *
 * Everything about how its jobs are filled in lives in Job Settings instead —
 * this form is the identity of the project, and it is edited once and then
 * rarely.
 */
export function ProjectForm({
  project,
  clients,
  repCompanies,
  customers,
  managers,
  contacts,
  redirectOnCreate,
  suggestedCode,
}: {
  project?: ProjectFormValues;
  /** The next free ID, offered on a new project. */
  suggestedCode?: string;
  clients: Option[];
  repCompanies: Option[];
  customers: Option[];
  managers: Option[];
  contacts: ContactOption[];
  redirectOnCreate?: boolean;
}) {
  const router = useRouter();

  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async (prev, formData) => {
      const result = await saveProject(prev, formData);
      // A freshly created project has nowhere to show its members and
      // deliverable rules, so send the planner straight to its page.
      if (result.ok && redirectOnCreate && result.id) {
        router.push(`/projects/${result.id}`);
      }
      return result;
    },
    null,
  );

  const key = project?.id ?? "new";
  const [, startTransition] = useTransition();
  const [clientId, setClientId] = useState(project?.clientId ?? "");
  const [repCompanyId, setRepCompanyId] = useState(project?.repCompanyId ?? "");
  // Asked only once a company actually changed, and only when there are jobs
  // still open for it to reach.
  const companyChanged =
    Boolean(project) &&
    (clientId !== project?.clientId ||
      repCompanyId !== (project?.repCompanyId ?? ""));
  const offerMove = companyChanged && (project?.openJobs ?? 0) > 0;
  const [pmContactId, setPmContactId] = useState(project?.pmContactId ?? "");

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        startTransition(() => formAction(formData));
      }}
      className="flex flex-col gap-4"
    >
      {/* Submitted by hand rather than through the form's action prop: React
          resets a form once its action has run, which puts every select back
          on its first option while the component still holds the choice — so
          the next save sent "none" for whatever was picked. */}
      {project ? <input type="hidden" name="id" value={project.id} /> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Project name"
          htmlFor={`pname-${key}`}
          hint="Ours — what the app calls it everywhere."
        >
          <Input
            id={`pname-${key}`}
            name="name"
            defaultValue={project?.name ?? ""}
            required
            autoComplete="off"
          />
        </Field>

        <Field
          label="Project ID"
          htmlFor={`pcode-${key}`}
          hint={
            project?.codeLocked
              ? "Ours, and in the work order number of every job here, so it is fixed now."
              : "Ours, unique. Goes into the work order number of every job raised here from now on: YYMM-ID-0001. Fixed once a job carries it."
          }
        >
          <Input
            id={`pcode-${key}`}
            name="code"
            defaultValue={project?.code ?? suggestedCode ?? ""}
            readOnly={project?.codeLocked}
            required
            maxLength={20}
            autoComplete="off"
            className="uppercase"
          />
        </Field>

        <Field
          label="Paying company"
          htmlFor={`pclient-${key}`}
          hint="Who dispatches this work and pays for it. Goes onto every job raised under the project; jobs already raised keep theirs."
        >
          <Select
            id={`pclient-${key}`}
            name="clientId"
            value={clientId}
            onChange={(event) => setClientId(event.target.value)}
            required
          >
            <option value="" disabled>
              Select a paying company…
            </option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.label}
              </option>
            ))}
          </Select>
        </Field>

        {/* The link above the one that pays us. Optional: plenty of work
            arrives without anybody knowing who represented the customer. */}
        <Field
          label="Rep company"
          htmlFor={`prep-${key}`}
          hint="Who represents the customer above the paying company. Goes onto every job raised under the project."
        >
          <Select
            id={`prep-${key}`}
            name="repCompanyId"
            value={repCompanyId}
            onChange={(event) => setRepCompanyId(event.target.value)}
          >
            <option value="">— none —</option>
            {repCompanies.map((repCompany) => (
              <option key={repCompany.id} value={repCompany.id}>
                {repCompany.label}
              </option>
            ))}
          </Select>
        </Field>

        {/* Their names for the same work. Shown nowhere but here and the
            overview; ours is what the app goes by. Open when any is filled,
            so a value somebody entered is never hidden behind a fold. */}
        <details
          className="group sm:col-span-2"
          open={Boolean(
            project?.clientProjectName ||
              project?.externalProjectId ||
              project?.repProjectName ||
              project?.repProjectId,
          )}
        >
          <summary className="cursor-pointer text-sm font-medium text-muted-foreground">
            Their name and ID for it (optional)
          </summary>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <Field label="Paying company project name" htmlFor={`pcname-${key}`}>
              <Input
                id={`pcname-${key}`}
                name="clientProjectName"
                defaultValue={project?.clientProjectName ?? ""}
                autoComplete="off"
              />
            </Field>
            <Field label="Paying company project ID" htmlFor={`pext-${key}`}>
              <Input
                id={`pext-${key}`}
                name="externalProjectId"
                defaultValue={project?.externalProjectId ?? ""}
                autoComplete="off"
              />
            </Field>
            <Field label="Rep company project name" htmlFor={`prname-${key}`}>
              <Input
                id={`prname-${key}`}
                name="repProjectName"
                defaultValue={project?.repProjectName ?? ""}
                autoComplete="off"
              />
            </Field>
            <Field label="Rep company project ID" htmlFor={`prid-${key}`}>
              <Input
                id={`prid-${key}`}
                name="repProjectId"
                defaultValue={project?.repProjectId ?? ""}
                autoComplete="off"
              />
            </Field>
          </div>
        </details>

        <Field
          label="Customer"
          htmlFor={`pcust-${key}`}
          hint="Optional. Only when a project covers one brand."
        >
          <Select
            id={`pcust-${key}`}
            name="customerId"
            defaultValue={project?.customerId ?? ""}
          >
            <option value="">— any —</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Project manager"
          htmlFor={`pmgr-${key}`}
          hint="Ours. Approves changes and statuses on this project's jobs."
        >
          <Select
            id={`pmgr-${key}`}
            name="managerId"
            defaultValue={project?.managerId ?? ""}
          >
            <option value="">— none —</option>
            {managers.map((manager) => (
              <option key={manager.id} value={manager.id}>
                {manager.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Status" htmlFor={`pstatus-${key}`}>
          <Select
            id={`pstatus-${key}`}
            name="status"
            defaultValue={project?.status ?? "ACTIVE"}
          >
            <option value="ACTIVE">Active</option>
            <option value="ON_HOLD">On hold</option>
            <option value="CLOSED">Closed</option>
          </Select>
        </Field>

        <Field
          label="Paying company PM/PC"
          htmlFor="pmContactId"
          hint="Theirs. The coordinator a tech rings when the door is locked. Copied onto each job as it is raised, so replacing them mid-project leaves the jobs already planned under whoever actually ran them."
          className="sm:col-span-2"
        >
          <PmContactPicker
            name="pmContactId"
            contacts={contacts}
            value={pmContactId}
            onChange={setPmContactId}
            clientId={clientId}
          />
        </Field>
      </div>

      <Field
        label="General scope of work"
        htmlFor={`pscope-${key}`}
        hint="Prepended to each job's own scope."
      >
        <MarkdownEditor
          id={`pscope-${key}`}
          name="generalScopeOfWork"
          defaultValue={project?.generalScopeOfWork ?? ""}
          rows={7}
          hint="Lines you start with the tick become a checklist the crew can tick off on every job under this project."
        />
      </Field>

      {offerMove ? (
        <label className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
          <input
            type="checkbox"
            name="applyToOpenJobs"
            value="true"
            className="mt-0.5 size-4 accent-[var(--color-primary)]"
          />
          <span>
            Also move its {project!.openJobs} open job
            {project!.openJobs === 1 ? "" : "s"} to the new company
            <span className="block text-xs text-muted-foreground">
              Left unticked, jobs already raised keep the company they were
              raised for. A job that already has the paying company&rsquo;s
              work order attached, or a week on it already paid, keeps the old
              paying company either way.
            </span>
          </span>
        </label>
      ) : null}

      {state?.ok && state.note ? (
        <p className="text-sm text-muted-foreground">{state.note}</p>
      ) : null}

      <FormStatus
        state={state as SaveState}
        pending={pending}
        label={project ? "Save project" : "Create project"}
        size="md"
      />
    </form>
  );
}
