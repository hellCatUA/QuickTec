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
    hint: 'On the WM Form as "- (2) Cat6 Keystone $8.00" under Materials Used, and in the materials total.',
  },
  PARKING: {
    label: "Parking",
    needsLabel: false,
    needsPhoto: true,
    hint: 'Added to "Tech parking" on the WM Form.',
  },
  TOLL: {
    label: "Toll",
    needsLabel: false,
    needsPhoto: true,
    hint: 'Added to "Tech tolls" on the WM Form.',
  },
  HOTEL: {
    label: "Hotel",
    needsLabel: true,
    needsPhoto: true,
    hint: 'A "Tech hotel" line of its own on the WM Form, counted in the tech total. Never on the legacy form.',
  },
};

/** A whole number of at least one, or null. */
function whole(value: string): number | null {
  const count = Number(value);
  return Number.isInteger(count) && count >= 1 ? count : null;
}

/** Dollars times a count, to the cent, as a box shows it. */
function times(dollars: string, count: number): string {
  const cents = Math.round(Number(dollars) * 100);
  return Number.isFinite(cents) ? ((cents * count) / 100).toFixed(2) : "";
}

/** Dollars shared over a count, to the cent. */
function divided(dollars: string, count: number): string {
  const cents = Math.round(Number(dollars) * 100);
  return Number.isFinite(cents) ? (Math.round(cents / count) / 100).toFixed(2) : "";
}

export type ReimbursementView = {
  id: string;
  type: ReimbursementType;
  label: string | null;
  /** How many of a material; the amount is for all of them. */
  quantity: number;
  amount: string;
  note: string | null;
  isOwn: boolean;
  attachments: { id: string; mimeType: string }[];
};

export function Reimbursements({
  jobId,
  entries,
  canEdit,
  crew,
}: {
  jobId: string;
  entries: ReimbursementView[];
  canEdit: boolean;
  /**
   * Whose a claim can be, for somebody adding one who is not on the crew
   * themselves. Null for a tech, whose claims are their own.
   */
  crew: { assignmentId: string; name: string }[] | null;
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
            {entry.type === "MATERIAL" && entry.quantity > 1 ? `(${entry.quantity}) ` : ""}
            {entry.label || TYPE_META[entry.type].label}
          </span>
          <span className="tabular text-sm">{formatMoney(entry.amount)}</span>
          {entry.type === "MATERIAL" && entry.quantity > 1 ? (
            <span className="tabular text-xs text-muted-foreground">
              {formatMoney(Number(entry.amount) / entry.quantity)} each
            </span>
          ) : null}
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
            crew={crew}
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
  crew,
  onDone,
  onError,
}: {
  jobId: string;
  crew: { assignmentId: string; name: string }[] | null;
  onDone: () => void;
  onError: (message: string | null) => void;
}) {
  const [whose, setWhose] = React.useState(
    crew && crew.length === 1 ? crew[0].assignmentId : "",
  );
  const [type, setType] = React.useState<ReimbursementType>("MATERIAL");
  const [label, setLabel] = React.useState("");
  const [amount, setAmount] = React.useState("");
  // A material is so many at a price each, or so many for a total — whichever
  // the receipt shows. Both boxes are there and each fills the other; the
  // one typed into last is the one kept when the quantity changes.
  const [quantity, setQuantity] = React.useState("1");
  const [each, setEach] = React.useState("");
  const [anchor, setAnchor] = React.useState<"each" | "total">("each");
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
    if (type === "MATERIAL") formData.set("quantity", quantity);
    if (crew) formData.set("assignmentId", whose);
    formData.set("note", note);
    for (const file of files) formData.append("files", file);

    const result = await saveReimbursement(null, formData);
    setPending(false);

    if (!result.ok) onError(result.error);
    else onDone();
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-raised p-3">
      {crew ? (
        crew.length > 0 ? (
          <Field
            label="Whose claim"
            htmlFor="reimb-whose"
            hint="It goes on their WM Form and is paid to them."
          >
            <Select
              id="reimb-whose"
              value={whose}
              onChange={(event) => setWhose(event.target.value)}
            >
              <option value="">— choose the tech —</option>
              {crew.map((one) => (
                <option key={one.assignmentId} value={one.assignmentId}>
                  {one.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <p className="text-sm text-warning">
            Nobody is on this job yet. A claim is a tech&rsquo;s — add the crew
            first.
          </p>
        )
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Type" htmlFor="reimb-type">
          <Select
            id="reimb-type"
            value={type}
            onChange={(event) => {
              const next = event.target.value as ReimbursementType;
              // A material's three boxes and a parking ticket's one do not
              // carry over: what was typed for one is not the other's amount.
              if ((next === "MATERIAL") !== (type === "MATERIAL")) {
                setAmount("");
                setEach("");
                setQuantity("1");
                setAnchor("each");
              }
              setType(next);
            }}
          >
            {(Object.keys(TYPE_META) as ReimbursementType[]).map((option) => (
              <option key={option} value={option}>
                {TYPE_META[option].label}
              </option>
            ))}
          </Select>
        </Field>

        {type === "MATERIAL" ? (
          <Field label="Quantity" htmlFor="reimb-quantity">
            <Input
              id="reimb-quantity"
              type="number"
              step="1"
              min="1"
              inputMode="numeric"
              value={quantity}
              onChange={(event) => {
                const next = event.target.value;
                setQuantity(next);
                const count = whole(next);
                if (!count) return;
                if (anchor === "each" && each) setAmount(times(each, count));
                else if (anchor === "total" && amount) setEach(divided(amount, count));
              }}
            />
          </Field>
        ) : (
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
        )}
      </div>

      {type === "MATERIAL" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Price each ($)" htmlFor="reimb-each">
            <Input
              id="reimb-each"
              type="number"
              step="0.01"
              min="0.01"
              inputMode="decimal"
              value={each}
              onChange={(event) => {
                const next = event.target.value;
                setEach(next);
                setAnchor("each");
                const count = whole(quantity);
                setAmount(next && count ? times(next, count) : "");
              }}
            />
          </Field>
          <Field label="Total ($)" htmlFor="reimb-amount">
            <Input
              id="reimb-amount"
              type="number"
              step="0.01"
              min="0.01"
              inputMode="decimal"
              value={amount}
              onChange={(event) => {
                const next = event.target.value;
                setAmount(next);
                setAnchor("total");
                const count = whole(quantity);
                setEach(next && count ? divided(next, count) : "");
              }}
            />
          </Field>
        </div>
      ) : null}

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
            !(Number(amount) > 0) ||
            (crew !== null && !whose) ||
            (type === "MATERIAL" && !whole(quantity)) ||
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
