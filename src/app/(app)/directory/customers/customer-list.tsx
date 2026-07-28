"use client";

import { ChevronRight, Plus } from "lucide-react";
import Link from "next/link";
import { useActionState, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { FormStatus, type SaveState } from "@/components/ui/form-status";
import { EmptyState } from "@/components/ui/page-header";
import { saveCustomer, type ActionResult } from "../actions";

type CustomerRecord = {
  id: string;
  name: string;
  code: string;
  active: boolean;
  _count: { sites: number; jobs: number };
};

function CustomerForm({
  customer,
  onSaved,
}: {
  customer?: CustomerRecord;
  onSaved?: () => void;
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async (prev, formData) => {
      const result = await saveCustomer(prev, formData);
      if (result.ok) onSaved?.();
      return result;
    },
    null,
  );

  const key = customer?.id ?? "new";

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {customer ? <input type="hidden" name="id" value={customer.id} /> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor={`cname-${key}`}>
          <Input
            id={`cname-${key}`}
            name="name"
            defaultValue={customer?.name ?? ""}
            placeholder="Starbucks"
            required
            autoComplete="off"
          />
        </Field>
        <Field
          label="Code"
          htmlFor={`ccode-${key}`}
          hint="Appears in exports, e.g. SBUX #24541."
        >
          <Input
            id={`ccode-${key}`}
            name="code"
            defaultValue={customer?.code ?? ""}
            placeholder="SBUX"
            required
            autoComplete="off"
            className="uppercase"
          />
        </Field>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="active"
          defaultChecked={customer?.active ?? true}
          className="size-5 accent-[var(--color-primary)]"
        />
        Active
      </label>

      <FormStatus
        state={state as SaveState}
        pending={pending}
        label={customer ? "Save" : "Add customer"}
      />
    </form>
  );
}

export function CustomerList({ customers }: { customers: CustomerRecord[] }) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-3">
      {adding ? (
        <Card>
          <CardContent className="flex flex-col gap-4">
            <div className="text-sm font-semibold">New customer</div>
            <CustomerForm onSaved={() => setAdding(false)} />
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
          <Plus /> Add customer
        </Button>
      )}

      {customers.length === 0 && !adding ? (
        <EmptyState
          title="No customers yet"
          description="A customer is the end brand whose sites you visit — Starbucks, Chipotle, and so on."
        />
      ) : null}

      {customers.map((customer) => (
        <Card key={customer.id}>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">
                  {customer.name}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {customer.code}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {customer._count.sites} site
                  {customer._count.sites === 1 ? "" : "s"} ·{" "}
                  {customer._count.jobs} job
                  {customer._count.jobs === 1 ? "" : "s"}
                </div>
              </div>

              <div className="ml-auto flex items-center gap-2">
                {!customer.active ? (
                  <Badge variant="warning">Inactive</Badge>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setEditingId(editingId === customer.id ? null : customer.id)
                  }
                >
                  {editingId === customer.id ? "Close" : "Edit"}
                </Button>
                <Link href={`/directory/customers/${customer.id}`}>
                  <Button type="button" variant="secondary" size="sm">
                    Sites <ChevronRight />
                  </Button>
                </Link>
              </div>
            </div>

            {editingId === customer.id ? (
              <div className="border-t border-border pt-3">
                <CustomerForm customer={customer} />
              </div>
            ) : null}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
