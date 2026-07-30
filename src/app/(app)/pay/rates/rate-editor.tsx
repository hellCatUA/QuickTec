"use client";

import { Plus, X } from "lucide-react";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { formatRate, PAY_TYPE_LABEL } from "@/lib/money";
import type { PayType } from "@prisma-client";
import { deletePayRate, savePayRate } from "../actions";

type Rate = {
  id: string;
  payType: PayType;
  rate: string;
  travelReimbursement: string | null;
  note: string | null;
  scopeLabel: string;
};

export function RateEditor({
  user,
  rates,
  projects,
  clients,
}: {
  user: {
    id: string;
    name: string;
    baseRole: string;
    defaultPayType: PayType | null;
    defaultPayRate: string;
  };
  rates: Rate[];
  projects: { id: string; name: string }[];
  clients: { id: string; name: string }[];
}) {
  const [adding, setAdding] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const [defaultType, setDefaultType] = React.useState<PayType>(
    user.defaultPayType ?? "HOURLY",
  );
  const [defaultRate, setDefaultRate] = React.useState(user.defaultPayRate);

  function save(formData: FormData, done?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await savePayRate(null, formData);
      if (!result.ok) setError(result.error);
      else done?.();
    });
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">{user.name}</span>
          <Badge variant="neutral">{user.baseRole}</Badge>
          {!user.defaultPayType ? (
            <Badge variant="warning">No default rate</Badge>
          ) : null}
        </div>

        {error ? <p className="text-sm text-danger">{error}</p> : null}

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Default pay type" htmlFor={`type-${user.id}`}>
            <Select
              id={`type-${user.id}`}
              value={defaultType}
              onChange={(event) => setDefaultType(event.target.value as PayType)}
            >
              {(Object.keys(PAY_TYPE_LABEL) as PayType[]).map((option) => (
                <option key={option} value={option}>
                  {PAY_TYPE_LABEL[option]}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Default rate ($)" htmlFor={`rate-${user.id}`}>
            <Input
              id={`rate-${user.id}`}
              type="number"
              step="0.01"
              min="0"
              value={defaultRate}
              disabled={defaultType === "NON_BILLABLE"}
              onChange={(event) => setDefaultRate(event.target.value)}
            />
          </Field>

          <div className="flex items-end">
            <Button
              type="button"
              size="sm"
              disabled={pending}
              onClick={() => {
                const formData = new FormData();
                formData.set("userId", user.id);
                formData.set("payType", defaultType);
                formData.set(
                  "rate",
                  defaultType === "NON_BILLABLE" ? "0" : defaultRate || "0",
                );
                save(formData);
              }}
            >
              Save default
            </Button>
          </div>
        </div>

        {rates.length > 0 ? (
          <div className="flex flex-col gap-2">
            {rates.map((rate) => (
              <div
                key={rate.id}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-sm"
              >
                <span className="text-xs text-muted-foreground">
                  {rate.scopeLabel}
                </span>
                <span className="tabular">
                  {formatRate(rate.payType, rate.rate)}
                </span>
                {rate.travelReimbursement ? (
                  <span className="text-xs text-muted-foreground">
                    travel ${Number(rate.travelReimbursement).toFixed(2)}
                  </span>
                ) : null}
                {rate.note ? (
                  <span className="text-xs text-muted-foreground">
                    {rate.note}
                  </span>
                ) : null}

                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="ml-auto"
                  aria-label={`Remove ${rate.scopeLabel} rate`}
                  disabled={pending}
                  onClick={() => {
                    setError(null);
                    startTransition(async () => {
                      const formData = new FormData();
                      formData.set("id", rate.id);
                      const result = await deletePayRate(formData);
                      if (!result.ok) setError(result.error);
                    });
                  }}
                >
                  <X />
                </Button>
              </div>
            ))}
          </div>
        ) : null}

        {adding ? (
          <OverrideForm
            userId={user.id}
            projects={projects}
            clients={clients}
            pending={pending}
            onSave={(formData) => save(formData, () => setAdding(false))}
            onCancel={() => setAdding(false)}
          />
        ) : (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="self-start"
            onClick={() => setAdding(true)}
          >
            <Plus /> Add a project or client rate
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function OverrideForm({
  userId,
  projects,
  clients,
  pending,
  onSave,
  onCancel,
}: {
  userId: string;
  projects: { id: string; name: string }[];
  clients: { id: string; name: string }[];
  pending: boolean;
  onSave: (formData: FormData) => void;
  onCancel: () => void;
}) {
  const [target, setTarget] = React.useState<"project" | "client">("project");
  const [targetId, setTargetId] = React.useState("");
  const [payType, setPayType] = React.useState<PayType>("HOURLY");
  const [rate, setRate] = React.useState("");
  const [travel, setTravel] = React.useState("");
  const [note, setNote] = React.useState("");

  const options = target === "project" ? projects : clients;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-raised p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Applies to" htmlFor={`target-${userId}`}>
          <Select
            id={`target-${userId}`}
            value={target}
            onChange={(event) => {
              setTarget(event.target.value as "project" | "client");
              setTargetId("");
            }}
          >
            <option value="project">A project</option>
            <option value="client">A client</option>
          </Select>
        </Field>

        <Field label={target === "project" ? "Project" : "Representing company"} htmlFor={`which-${userId}`}>
          <Select
            id={`which-${userId}`}
            value={targetId}
            onChange={(event) => setTargetId(event.target.value)}
          >
            <option value="">Select…</option>
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Pay type" htmlFor={`otype-${userId}`}>
          <Select
            id={`otype-${userId}`}
            value={payType}
            onChange={(event) => setPayType(event.target.value as PayType)}
          >
            {(Object.keys(PAY_TYPE_LABEL) as PayType[]).map((option) => (
              <option key={option} value={option}>
                {PAY_TYPE_LABEL[option]}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Rate ($)" htmlFor={`orate-${userId}`}>
          <Input
            id={`orate-${userId}`}
            type="number"
            step="0.01"
            min="0"
            value={rate}
            disabled={payType === "NON_BILLABLE"}
            onChange={(event) => setRate(event.target.value)}
          />
        </Field>

        {target === "project" ? (
          <Field
            label="Travel reimbursement ($)"
            htmlFor={`otravel-${userId}`}
            hint="Only on a project rate — travel money belongs to the work, not the person."
          >
            <Input
              id={`otravel-${userId}`}
              type="number"
              step="0.01"
              min="0"
              value={travel}
              onChange={(event) => setTravel(event.target.value)}
            />
          </Field>
        ) : null}

        <Field label="Note" htmlFor={`onote-${userId}`}>
          <Input
            id={`onote-${userId}`}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>
      </div>

      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          disabled={pending || !targetId}
          onClick={() => {
            const formData = new FormData();
            formData.set("userId", userId);
            formData.set(target === "project" ? "projectId" : "clientId", targetId);
            formData.set("payType", payType);
            formData.set("rate", payType === "NON_BILLABLE" ? "0" : rate || "0");
            if (travel) formData.set("travelReimbursement", travel);
            if (note) formData.set("note", note);
            onSave(formData);
          }}
        >
          Save rate
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
