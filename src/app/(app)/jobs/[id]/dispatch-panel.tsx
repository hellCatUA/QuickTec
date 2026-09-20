"use client";

import { Loader2, Mail, Phone, Plus } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { formatPhone, formatPhoneAsTyped, telHref } from "@/lib/phone";
import { capitaliseName } from "@/lib/names";
import { Field, Input } from "@/components/ui/field";
import { RowMenu } from "@/components/ui/row-menu";
import {
  addJobDispatchContact,
  deleteJobDispatchContact,
  updateJobDispatchContact,
} from "./actions";

export type DispatchEntry = {
  id: string;
  label: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  note: string | null;
  /** False for the tech's supervisor and for the project's own contacts. */
  removable: boolean;
};

type Draft = {
  label: string;
  name: string;
  phone: string;
  email: string;
  note: string;
};

const BLANK: Draft = { label: "", name: "", phone: "", email: "", note: "" };

/**
 * Numbers to reach mid-job. Tap to dial.
 *
 * The tech's own supervisor heads the list and the project's contacts follow;
 * neither is edited here, because neither belongs to this job. What can be
 * added is the number that turned up on the call — a bridge line for today, a
 * duty manager's mobile — which previously had nowhere to go at all.
 *
 * One that belongs to the job can now be corrected as well as removed. These
 * are taken down from somebody speaking, often over a bad line, and a wrong
 * digit in the number the rest of the crew is dialling was previously fixed by
 * deleting the row and typing all of it again.
 */
export function DispatchPanel({
  jobId,
  contacts,
  canEdit,
  canAdd = canEdit,
}: {
  jobId: string;
  contacts: DispatchEntry[];
  /** Change or remove a number somebody else is already dialling. */
  canEdit: boolean;
  /** Add one. A number picked up mid-job is worth having from whoever finds it. */
  canAdd?: boolean;
}) {
  // "new", an id, or nothing open.
  const [open, setOpen] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function remove(id: string) {
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("id", id);
      const result = await deleteJobDispatchContact(formData);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {contacts.length === 0 && open !== "new" ? (
        <p className="text-sm text-muted-foreground">
          No numbers on this job yet.
        </p>
      ) : null}

      {contacts.map((contact) =>
        open === contact.id ? (
          <ContactForm
            key={contact.id}
            jobId={jobId}
            existing={contact}
            pending={pending}
            onError={setError}
            onDone={() => setOpen(null)}
          />
        ) : (
          <div
            key={contact.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border p-2"
          >
            <span className="text-sm font-medium">{contact.label}</span>
            {contact.name ? (
              <span className="text-xs text-muted-foreground">
                {contact.name}
              </span>
            ) : null}
            {contact.phone ? (
              <a
                href={telHref(contact.phone)}
                className="flex items-center gap-1 text-xs text-primary underline-offset-4 hover:underline"
              >
                <Phone className="size-3" />
                {formatPhone(contact.phone)}
              </a>
            ) : null}
            {contact.email ? (
              <a
                href={`mailto:${contact.email}`}
                className="flex items-center gap-1 text-xs text-primary underline-offset-4 hover:underline"
              >
                <Mail className="size-3" />
                {contact.email}
              </a>
            ) : null}

            {canEdit && contact.removable ? (
              <RowMenu
                className="ml-auto"
                label={`Options for ${contact.label}`}
                disabled={pending}
                items={[
                  {
                    label: "Edit",
                    onSelect: () => {
                      setError(null);
                      setOpen(contact.id);
                    },
                  },
                  {
                    label: "Delete",
                    tone: "danger",
                    confirm: `Remove ${contact.label} from this job?`,
                    onSelect: () => remove(contact.id),
                  },
                ]}
              />
            ) : null}

            {contact.note ? (
              <span className="w-full text-xs text-muted-foreground">
                {contact.note}
              </span>
            ) : null}
          </div>
        ),
      )}

      {error ? <p className="text-sm text-danger">{error}</p> : null}

      {canAdd ? (
        open === "new" ? (
          <ContactForm
            jobId={jobId}
            pending={pending}
            onError={setError}
            onDone={() => setOpen(null)}
          />
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="self-start"
            onClick={() => setOpen("new")}
          >
            <Plus /> Add a number
          </Button>
        )
      ) : null}
    </div>
  );
}

function ContactForm({
  jobId,
  existing,
  pending,
  onDone,
  onError,
}: {
  jobId: string;
  existing?: DispatchEntry;
  pending: boolean;
  onDone: () => void;
  onError: (message: string | null) => void;
}) {
  const [saving, startTransition] = React.useTransition();
  const [draft, setDraft] = React.useState<Draft>(() =>
    existing
      ? {
          label: existing.label,
          name: existing.name ?? "",
          phone: existing.phone ? formatPhone(existing.phone) : "",
          email: existing.email ?? "",
          note: existing.note ?? "",
        }
      : BLANK,
  );

  // Distinct per open form, so a label never points at another row's box.
  const key = existing ? existing.id : "add";

  function set(part: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...part }));
  }

  function save() {
    if (!draft.label.trim()) return;
    onError(null);
    startTransition(async () => {
      const formData = new FormData();
      for (const [field, value] of Object.entries(draft)) {
        formData.set(field, value);
      }

      if (existing) {
        formData.set("id", existing.id);
        const result = await updateJobDispatchContact(null, formData);
        if (!result.ok) return onError(result.error);
        return onDone();
      }

      formData.set("jobId", jobId);
      const result = await addJobDispatchContact(null, formData);
      if (!result.ok) return onError(result.error);
      onDone();
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-raised p-3">
      <Field label="Who they are" htmlFor={`dispatch-${key}-label`}>
        <Input
          id={`dispatch-${key}-label`}
          value={draft.label}
          onChange={(event) => set({ label: event.target.value })}
          placeholder="Bridge line"
          autoFocus
        />
      </Field>

      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Name" htmlFor={`dispatch-${key}-name`}>
          <Input
            id={`dispatch-${key}-name`}
            value={draft.name}
            autoCapitalize="words"
            onChange={(event) =>
              set({ name: capitaliseName(event.target.value) })
            }
          />
        </Field>
        <Field label="Phone" htmlFor={`dispatch-${key}-phone`}>
          <Input
            id={`dispatch-${key}-phone`}
            value={draft.phone}
            inputMode="tel"
            onChange={(event) =>
              set({ phone: formatPhoneAsTyped(event.target.value) })
            }
          />
        </Field>
        <Field label="Email" htmlFor={`dispatch-${key}-email`}>
          <Input
            id={`dispatch-${key}-email`}
            value={draft.email}
            inputMode="email"
            onChange={(event) => set({ email: event.target.value })}
          />
        </Field>
        <Field label="Note" htmlFor={`dispatch-${key}-note`}>
          <Input
            id={`dispatch-${key}-note`}
            value={draft.note}
            onChange={(event) => set({ note: event.target.value })}
            placeholder="Ask for the duty manager"
          />
        </Field>
      </div>

      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          disabled={pending || saving || !draft.label.trim()}
          onClick={save}
        >
          {saving ? <Loader2 className="animate-spin" /> : null}
          {existing ? "Save changes" : "Add contact"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
