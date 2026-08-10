"use client";

import { Loader2, Mail, Phone, Plus, X } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { formatPhone, formatPhoneAsTyped, telHref } from "@/lib/phone";
import { Field, Input } from "@/components/ui/field";
import {
  addJobDispatchContact,
  deleteJobDispatchContact,
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

/**
 * Numbers to reach mid-job. Tap to dial.
 *
 * The tech's own supervisor heads the list and the project's contacts follow;
 * neither is edited here, because neither belongs to this job. What can be
 * added is the number that turned up on the call — a bridge line for today, a
 * duty manager's mobile — which previously had nowhere to go at all.
 */
export function DispatchPanel({
  jobId,
  contacts,
  canEdit,
}: {
  jobId: string;
  contacts: DispatchEntry[];
  canEdit: boolean;
}) {
  const [adding, setAdding] = React.useState(false);
  const [draft, setDraft] = React.useState({
    label: "",
    name: "",
    phone: "",
    email: "",
    note: "",
  });
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function save() {
    if (!draft.label.trim()) return;
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("jobId", jobId);
      for (const [key, value] of Object.entries(draft)) {
        formData.set(key, value);
      }

      const result = await addJobDispatchContact(null, formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDraft({ label: "", name: "", phone: "", email: "", note: "" });
      setAdding(false);
    });
  }

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
      {contacts.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No numbers on this job yet.
        </p>
      ) : null}

      {contacts.map((contact) => (
        <div
          key={contact.id}
          className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border p-2"
        >
          <span className="text-sm font-medium">{contact.label}</span>
          {contact.name ? (
            <span className="text-xs text-muted-foreground">{contact.name}</span>
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
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="ml-auto"
              aria-label={`Remove ${contact.label}`}
              disabled={pending}
              onClick={() => remove(contact.id)}
            >
              <X />
            </Button>
          ) : null}

          {contact.note ? (
            <span className="w-full text-xs text-muted-foreground">
              {contact.note}
            </span>
          ) : null}
        </div>
      ))}

      {error ? <p className="text-sm text-danger">{error}</p> : null}

      {canEdit ? (
        adding ? (
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-raised p-3">
            <Field label="Who they are" htmlFor="dispatch-add-label">
              <Input
                id="dispatch-add-label"
                value={draft.label}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    label: event.target.value,
                  }))
                }
                placeholder="Bridge line"
                autoFocus
              />
            </Field>

            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="Name" htmlFor="dispatch-add-name">
                <Input
                  id="dispatch-add-name"
                  value={draft.name}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                />
              </Field>
              <Field label="Phone" htmlFor="dispatch-add-phone">
                <Input
                  id="dispatch-add-phone"
                  value={draft.phone}
                  inputMode="tel"
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      phone: formatPhoneAsTyped(event.target.value),
                    }))
                  }
                />
              </Field>
              <Field label="Email" htmlFor="dispatch-add-email">
                <Input
                  id="dispatch-add-email"
                  value={draft.email}
                  inputMode="email"
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      email: event.target.value,
                    }))
                  }
                />
              </Field>
              <Field label="Note" htmlFor="dispatch-add-note">
                <Input
                  id="dispatch-add-note"
                  value={draft.note}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      note: event.target.value,
                    }))
                  }
                  placeholder="Ask for the duty manager"
                />
              </Field>
            </div>

            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                disabled={pending || !draft.label.trim()}
                onClick={save}
              >
                {pending ? <Loader2 className="animate-spin" /> : null}
                Add contact
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setAdding(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="self-start"
            onClick={() => setAdding(true)}
          >
            <Plus /> Add a number
          </Button>
        )
      ) : null}
    </div>
  );
}
