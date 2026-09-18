"use client";

import { Plus } from "lucide-react";
import { useActionState, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/field";
import { FormStatus, type SaveState } from "@/components/ui/form-status";
import { EmptyState } from "@/components/ui/page-header";
import { saveRepCompany, type ActionResult } from "../actions";

type RepCompanyRecord = {
  id: string;
  name: string;
  code: string | null;
  notes: string | null;
  active: boolean;
  _count: { jobs: number; projects: number };
};

function RepCompanyForm({
  repCompany,
  onSaved,
}: {
  repCompany?: RepCompanyRecord;
  onSaved?: () => void;
}) {
  const [state, formAction, pending] = useActionState<
    ActionResult | null,
    FormData
  >(async (prev, formData) => {
    const result = await saveRepCompany(prev, formData);
    if (result.ok) onSaved?.();
    return result;
  }, null);

  const key = repCompany?.id ?? "new";

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {repCompany ? (
        <input type="hidden" name="id" value={repCompany.id} />
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor={`rname-${key}`}>
          <Input
            id={`rname-${key}`}
            name="name"
            defaultValue={repCompany?.name ?? ""}
            placeholder="Federated Service Systems"
            required
            autoComplete="off"
          />
        </Field>
        <Field
          label="Code"
          htmlFor={`rcode-${key}`}
          hint="Optional. Yours, for recognising them in a list."
        >
          <Input
            id={`rcode-${key}`}
            name="code"
            defaultValue={repCompany?.code ?? ""}
            placeholder="FSS"
            autoComplete="off"
          />
        </Field>
      </div>

      <Field label="Notes" htmlFor={`rnotes-${key}`}>
        <Textarea
          id={`rnotes-${key}`}
          name="notes"
          defaultValue={repCompany?.notes ?? ""}
        />
      </Field>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="active"
          defaultChecked={repCompany?.active ?? true}
          className="size-5 accent-[var(--color-primary)]"
        />
        Active
      </label>

      <FormStatus
        state={state as SaveState}
        pending={pending}
        label={repCompany ? "Save" : "Add rep company"}
      />
    </form>
  );
}

export function RepCompanyList({
  repCompanies,
}: {
  repCompanies: RepCompanyRecord[];
}) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-3">
      {adding ? (
        <Card>
          <CardContent className="flex flex-col gap-4">
            <div className="text-sm font-semibold">New rep company</div>
            <RepCompanyForm onSaved={() => setAdding(false)} />
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
          <Plus /> Add a rep company
        </Button>
      )}

      {repCompanies.length === 0 && !adding ? (
        <EmptyState
          title="No rep companies yet"
          description="A rep company represents the customer and hands the work down to whoever pays us. Leave a job without one if you do not know who it was."
        />
      ) : null}

      {repCompanies.map((repCompany) => (
        <Card key={repCompany.id}>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">
                  {repCompany.name}
                  {repCompany.code ? (
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      {repCompany.code}
                    </span>
                  ) : null}
                </div>
                <div className="text-xs text-muted-foreground">
                  {repCompany._count.jobs} job
                  {repCompany._count.jobs === 1 ? "" : "s"} ·{" "}
                  {repCompany._count.projects} project
                  {repCompany._count.projects === 1 ? "" : "s"}
                </div>
              </div>

              <div className="ml-auto flex items-center gap-2">
                {!repCompany.active ? (
                  <Badge variant="warning">Inactive</Badge>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Edit ${repCompany.name}`}
                  onClick={() =>
                    setEditingId(
                      editingId === repCompany.id ? null : repCompany.id,
                    )
                  }
                >
                  {editingId === repCompany.id ? "Close" : "Edit"}
                </Button>
              </div>
            </div>

            {repCompany.notes ? (
              <p className="text-xs text-muted-foreground">{repCompany.notes}</p>
            ) : null}

            {editingId === repCompany.id ? (
              <div className="border-t border-border pt-3">
                <RepCompanyForm repCompany={repCompany} />
              </div>
            ) : null}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
