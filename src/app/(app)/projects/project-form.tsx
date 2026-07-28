"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { FormStatus, type SaveState } from "@/components/ui/form-status";
import { saveProject, type ActionResult } from "./actions";

export type Option = { id: string; label: string };

export type ProjectFormValues = {
  id: string;
  name: string;
  externalProjectId: string | null;
  clientId: string;
  customerId: string | null;
  managerId: string | null;
  generalScopeOfWork: string | null;
  travelReimbursement: string | null;
  breakPaid: boolean;
  status: string;
};

export function ProjectForm({
  project,
  clients,
  customers,
  managers,
  redirectOnCreate,
}: {
  project?: ProjectFormValues;
  clients: Option[];
  customers: Option[];
  managers: Option[];
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
          label="Client project ID"
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

        <Field label="Client" htmlFor={`pclient-${key}`}>
          <Select
            id={`pclient-${key}`}
            name="clientId"
            defaultValue={project?.clientId ?? ""}
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
          hint="Approves changes and statuses on this project's jobs. Not the same as the client-side PM/PC recorded on a job."
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
          label="Travel reimbursement ($)"
          htmlFor={`ptravel-${key}`}
          hint="Money the customer allocates for travel on jobs in this project. Separate from mileage, which is a write-off record."
        >
          <Input
            id={`ptravel-${key}`}
            name="travelReimbursement"
            type="number"
            step="0.01"
            min={0}
            defaultValue={project?.travelReimbursement ?? ""}
            placeholder="Leave blank for none"
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

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="breakPaid"
          defaultChecked={project?.breakPaid ?? true}
          className="size-5 accent-[var(--color-primary)]"
        />
        Breaks are paid on this project
      </label>

      <FormStatus
        state={state as SaveState}
        pending={pending}
        label={project ? "Save project" : "Create project"}
        size="md"
      />
    </form>
  );
}
