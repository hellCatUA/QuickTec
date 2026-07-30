"use client";

import { Plus } from "lucide-react";
import { useActionState, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/field";
import { FormStatus, type SaveState } from "@/components/ui/form-status";
import { EmptyState } from "@/components/ui/page-header";
import { saveClient, type ActionResult } from "../actions";

type ClientRecord = {
  id: string;
  name: string;
  code: string | null;
  notes: string | null;
  active: boolean;
  _count: { jobs: number; projects: number };
};

function ClientForm({
  client,
  onSaved,
}: {
  client?: ClientRecord;
  onSaved?: () => void;
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async (prev, formData) => {
      const result = await saveClient(prev, formData);
      if (result.ok) onSaved?.();
      return result;
    },
    null,
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {client ? <input type="hidden" name="id" value={client.id} /> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor={`name-${client?.id ?? "new"}`}>
          <Input
            id={`name-${client?.id ?? "new"}`}
            name="name"
            defaultValue={client?.name ?? ""}
            required
            autoComplete="off"
          />
        </Field>
        <Field
          label="Short code"
          htmlFor={`code-${client?.id ?? "new"}`}
          hint="Optional. Internal shorthand only."
        >
          <Input
            id={`code-${client?.id ?? "new"}`}
            name="code"
            defaultValue={client?.code ?? ""}
            autoComplete="off"
          />
        </Field>
      </div>

      <Field label="Notes" htmlFor={`notes-${client?.id ?? "new"}`}>
        <Textarea
          id={`notes-${client?.id ?? "new"}`}
          name="notes"
          defaultValue={client?.notes ?? ""}
          rows={2}
        />
      </Field>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="active"
          defaultChecked={client?.active ?? true}
          className="size-5 accent-[var(--color-primary)]"
        />
        Active
      </label>

      <FormStatus
        state={state as SaveState}
        pending={pending}
        label={client ? "Save" : "Add company"}
      />
    </form>
  );
}

export function ClientList({ clients }: { clients: ClientRecord[] }) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-3">
      {adding ? (
        <Card>
          <CardContent className="flex flex-col gap-4">
            <div className="text-sm font-semibold">New representing company</div>
            <ClientForm onSaved={() => setAdding(false)} />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setAdding(false)}
            >
              Cancel
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Button
          type="button"
          variant="secondary"
          onClick={() => setAdding(true)}
          className="self-start"
        >
          <Plus /> Add a representing company
        </Button>
      )}

      {clients.length === 0 && !adding ? (
        <EmptyState
          title="No representing companies yet"
          description="The company that dispatches work to you and that you invoice — usually a subcontractor. Not the customer whose site you visit."
        />
      ) : null}

      {clients.map((client) => (
        <Card key={client.id}>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">
                  {client.name}
                  {client.code ? (
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      {client.code}
                    </span>
                  ) : null}
                </div>
                <div className="text-xs text-muted-foreground">
                  {client._count.jobs} job
                  {client._count.jobs === 1 ? "" : "s"} ·{" "}
                  {client._count.projects} project
                  {client._count.projects === 1 ? "" : "s"}
                </div>
              </div>

              <div className="ml-auto flex items-center gap-2">
                {!client.active ? <Badge variant="warning">Inactive</Badge> : null}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setEditingId(editingId === client.id ? null : client.id)
                  }
                >
                  {editingId === client.id ? "Close" : "Edit"}
                </Button>
              </div>
            </div>

            {editingId === client.id ? (
              <div className="border-t border-border pt-3">
                <ClientForm client={client} />
              </div>
            ) : null}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
