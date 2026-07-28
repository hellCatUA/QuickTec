"use client";

import { Loader2, Plus, Upload, X } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { formatMoney } from "@/lib/money";
import type { ReimbursementType } from "@prisma-client";
import { deleteReimbursement, saveReimbursement } from "./upload-actions";

const TYPE_META: Record<
  ReimbursementType,
  { label: string; needsLabel: boolean; needsPhoto: boolean; hint: string }
> = {
  MATERIAL: {
    label: "Material",
    needsLabel: true,
    needsPhoto: false,
    hint: 'Exported as "Cat 6A 3Ft $3.00" under Materials used.',
  },
  PARKING: {
    label: "Parking",
    needsLabel: false,
    needsPhoto: true,
    hint: 'Exported as "Parking $12.00" under Parking/Tolls.',
  },
  TOLL: {
    label: "Toll",
    needsLabel: false,
    needsPhoto: true,
    hint: 'Exported as "Toll $6.50" under Parking/Tolls.',
  },
  HOTEL: {
    label: "Hotel",
    needsLabel: true,
    needsPhoto: true,
    hint: "Internal only — hotels never appear on the client report.",
  },
};

export type ReimbursementView = {
  id: string;
  type: ReimbursementType;
  label: string | null;
  amount: string;
  note: string | null;
  isOwn: boolean;
  attachments: { id: string; mimeType: string }[];
};

export function Reimbursements({
  jobId,
  entries,
  canEdit,
}: {
  jobId: string;
  entries: ReimbursementView[];
  canEdit: boolean;
}) {
  const [adding, setAdding] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const total = entries.reduce((sum, entry) => sum + Number(entry.amount), 0);

  return (
    <div className="flex flex-col gap-3">
      {error ? <p className="text-sm text-danger">{error}</p> : null}

      {entries.length === 0 && !adding ? (
        <p className="text-sm text-muted-foreground">
          Nothing claimed on this job.
        </p>
      ) : null}

      {entries.map((entry) => (
        <div
          key={entry.id}
          className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2"
        >
          <span className="text-sm font-medium">
            {entry.label || TYPE_META[entry.type].label}
          </span>
          <span className="tabular text-sm">{formatMoney(entry.amount)}</span>
          <span className="text-xs text-muted-foreground">
            {TYPE_META[entry.type].label}
          </span>

          {entry.attachments.map((attachment) => (
            <a
              key={attachment.id}
              href={`/api/files/${attachment.id}`}
              target="_blank"
              rel="noreferrer"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/files/${attachment.id}?w=200`}
                alt="Receipt"
                loading="lazy"
                className="size-12 rounded border border-border object-cover"
              />
            </a>
          ))}

          {entry.note ? (
            <span className="w-full text-xs text-muted-foreground">
              {entry.note}
            </span>
          ) : null}

          {canEdit && entry.isOwn ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="ml-auto"
              aria-label="Remove claim"
              disabled={pending}
              onClick={() => {
                setError(null);
                startTransition(async () => {
                  const formData = new FormData();
                  formData.set("id", entry.id);
                  const result = await deleteReimbursement(formData);
                  if (!result.ok) setError(result.error);
                });
              }}
            >
              <X />
            </Button>
          ) : null}
        </div>
      ))}

      {entries.length > 0 ? (
        <p className="text-sm">
          <span className="text-muted-foreground">Total claimed: </span>
          <span className="tabular font-medium">{formatMoney(total)}</span>
        </p>
      ) : null}

      {canEdit ? (
        adding ? (
          <ReimbursementForm
            jobId={jobId}
            onDone={() => setAdding(false)}
            onError={setError}
          />
        ) : (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="self-start"
            onClick={() => setAdding(true)}
          >
            <Plus /> Add claim
          </Button>
        )
      ) : null}
    </div>
  );
}

function ReimbursementForm({
  jobId,
  onDone,
  onError,
}: {
  jobId: string;
  onDone: () => void;
  onError: (message: string | null) => void;
}) {
  const [type, setType] = React.useState<ReimbursementType>("MATERIAL");
  const [label, setLabel] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [note, setNote] = React.useState("");
  const [files, setFiles] = React.useState<File[]>([]);
  const [pending, setPending] = React.useState(false);

  const meta = TYPE_META[type];

  async function submit() {
    onError(null);
    setPending(true);

    const formData = new FormData();
    formData.set("jobId", jobId);
    formData.set("type", type);
    formData.set("label", label);
    formData.set("amount", amount);
    formData.set("note", note);
    for (const file of files) formData.append("files", file);

    const result = await saveReimbursement(null, formData);
    setPending(false);

    if (!result.ok) onError(result.error);
    else onDone();
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-raised p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Type" htmlFor="reimb-type">
          <Select
            id="reimb-type"
            value={type}
            onChange={(event) =>
              setType(event.target.value as ReimbursementType)
            }
          >
            {(Object.keys(TYPE_META) as ReimbursementType[]).map((option) => (
              <option key={option} value={option}>
                {TYPE_META[option].label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Amount ($)" htmlFor="reimb-amount">
          <Input
            id="reimb-amount"
            type="number"
            step="0.01"
            min="0.01"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </Field>
      </div>

      {meta.needsLabel ? (
        <Field
          label={type === "HOTEL" ? "Hotel name" : "Material name"}
          htmlFor="reimb-label"
        >
          <Input
            id="reimb-label"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder={type === "HOTEL" ? "Holiday Inn" : "Cat 6A 3Ft"}
            autoComplete="off"
          />
        </Field>
      ) : null}

      <p className="text-xs text-muted-foreground">{meta.hint}</p>

      <label className="flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border px-3 text-sm">
        <Upload className="size-4" />
        {files.length > 0
          ? `${files.length} receipt${files.length === 1 ? "" : "s"}`
          : meta.needsPhoto
            ? "Receipt photo (required)"
            : "Receipt photo (optional)"}
        <input
          type="file"
          accept="image/*,application/pdf"
          multiple
          className="sr-only"
          onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
        />
      </label>

      <Field label="Note" htmlFor="reimb-note">
        <Input
          id="reimb-note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          autoComplete="off"
        />
      </Field>

      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          disabled={
            pending ||
            !amount ||
            (meta.needsLabel && !label) ||
            (meta.needsPhoto && files.length === 0)
          }
          onClick={submit}
        >
          {pending ? <Loader2 className="animate-spin" /> : null}
          Save claim
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={onDone}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
