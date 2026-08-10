"use client";

import { Mail, Phone, Plus, X } from "lucide-react";
import { useActionState, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { formatPhone, telHref } from "@/lib/phone";
import { Field, Input } from "@/components/ui/field";
import { FormStatus, type SaveState } from "@/components/ui/form-status";
import {
  addDispatchContact,
  deleteDispatchContact,
  type ActionResult,
} from "../actions";

type Contact = {
  id: string;
  label: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  note: string | null;
};

export function DispatchContacts({
  projectId,
  contacts,
}: {
  projectId: string;
  contacts: Contact[];
}) {
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [state, formAction, submitting] = useActionState<
    ActionResult | null,
    FormData
  >(async (prev, formData) => {
    const result = await addDispatchContact(prev, formData);
    if (result.ok) setAdding(false);
    return result;
  }, null);

  return (
    <div className="flex flex-col gap-3">
      {error ? <p className="text-sm text-danger">{error}</p> : null}

      {contacts.length === 0 && !adding ? (
        <p className="text-sm text-muted-foreground">No contacts yet.</p>
      ) : null}

      {contacts.map((contact) => (
        <div
          key={contact.id}
          className="flex flex-wrap items-start gap-2 rounded-lg border border-border p-3"
        >
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">
              {contact.label}
              {contact.name ? (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {contact.name}
                </span>
              ) : null}
            </div>

            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {contact.phone ? (
                <a
                  href={telHref(contact.phone)}
                  className="flex items-center gap-1 text-primary underline-offset-4 hover:underline"
                >
                  <Phone className="size-3" />
                  {formatPhone(contact.phone)}
                </a>
              ) : null}
              {contact.email ? (
                <a
                  href={`mailto:${contact.email}`}
                  className="flex items-center gap-1 text-primary underline-offset-4 hover:underline"
                >
                  <Mail className="size-3" />
                  {contact.email}
                </a>
              ) : null}
            </div>

            {contact.note ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {contact.note}
              </p>
            ) : null}
          </div>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Remove ${contact.label}`}
            disabled={pending}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const formData = new FormData();
                formData.set("id", contact.id);
                formData.set("projectId", projectId);
                const result = await deleteDispatchContact(formData);
                if (!result.ok) setError(result.error);
              });
            }}
          >
            <X />
          </Button>
        </div>
      ))}

      {adding ? (
        <form
          action={formAction}
          className="flex flex-col gap-4 rounded-lg border border-border p-3"
        >
          <input type="hidden" name="projectId" value={projectId} />

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Label" htmlFor="dc-label">
              <Input
                id="dc-label"
                name="label"
                placeholder="Bridge line"
                required
                autoComplete="off"
              />
            </Field>
            <Field label="Name" htmlFor="dc-name">
              <Input id="dc-name" name="name" autoComplete="off" />
            </Field>
            <Field label="Phone" htmlFor="dc-phone">
              <Input id="dc-phone" name="phone" type="tel" autoComplete="off" />
            </Field>
            <Field label="Email" htmlFor="dc-email">
              <Input
                id="dc-email"
                name="email"
                type="email"
                autoComplete="off"
              />
            </Field>
          </div>

          <Field label="Note" htmlFor="dc-note">
            <Input
              id="dc-note"
              name="note"
              placeholder="Conference ID 4417#"
              autoComplete="off"
            />
          </Field>

          <div className="flex items-center gap-2">
            <FormStatus
              state={state as SaveState}
              pending={submitting}
              label="Add contact"
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setAdding(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="self-start"
          onClick={() => setAdding(true)}
        >
          <Plus /> Add contact
        </Button>
      )}
    </div>
  );
}
