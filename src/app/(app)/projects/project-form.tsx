"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
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
  externalProjectId: string | null;
  clientId: string;
  customerId: string | null;
  managerId: string | null;
  pmContactId: string | null;
  generalScopeOfWork: string | null;
  travelReimbursement: string | null;
  breakPaid: boolean;
  status: string;
};

/**
 * What the project is: who it belongs to, who runs it, what it covers.
 *
 * Everything about how its jobs are filled in lives in Job settings instead —
 * this form is the identity of the project, and it is edited once and then
 * rarely.
 */
export function ProjectForm({
  project,
  clients,
  customers,
  managers,
  contacts,
  redirectOnCreate,
}: {
  project?: ProjectFormValues;
  clients: Option[];
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
  const [clientId, setClientId] = useState(project?.clientId ?? "");
  const [pmContactId, setPmContactId] = useState(project?.pmContactId ?? "");

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {project ? <input type="hidden" name="id" value={project.id} /> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Project name" htmlFor={`pname-${key}`}>
          <Input
            id={`pname-${key}`}
            name="name"
            defaultValue={project?.name ?? ""}
            required
            autoComplete="off"
          />
        </Field>

        <Field
          label="Their project ID"
          htmlFor={`pext-${key}`}
          hint="The client's own ID. Goes into the internal WO number; blank becomes 0000."
        >
          <Input
            id={`pext-${key}`}
            name="externalProjectId"
            defaultValue={project?.externalProjectId ?? ""}
            placeholder="PRJ12"
            autoComplete="off"
          />
        </Field>

        <Field
          label="Representing company"
          htmlFor={`pclient-${key}`}
          hint="Who dispatches this work and pays for it. Goes onto every job raised under the project."
        >
          <Select
            id={`pclient-${key}`}
            name="clientId"
            value={clientId}
            onChange={(event) => setClientId(event.target.value)}
            required
          >
            <option value="" disabled>
              Select a client…
            </option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.label}
              </option>
            ))}
          </Select>
        </Field>

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
          label="Rep Company PM/PC"
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
        hint="Markdown. Prepended to each job's own scope. Checklist lines (- [ ]) become tickable on the job page."
      >
        <Textarea
          id={`pscope-${key}`}
          name="generalScopeOfWork"
          defaultValue={project?.generalScopeOfWork ?? ""}
          rows={6}
        />
      </Field>

      <FormStatus
        state={state as SaveState}
        pending={pending}
        label={project ? "Save project" : "Create project"}
        size="md"
      />
    </form>
  );
}
