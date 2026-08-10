"use client";

import { Loader2, Phone, Plus, X } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { formatPhone, telHref } from "@/lib/phone";
import { Field, Input } from "@/components/ui/field";
import { deleteClientDispatch, saveClientDispatch } from "../actions";

export type ClientDispatchRecord = {
  id: string;
  label: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  note: string | null;
};

/**
 * Numbers to reach on any job for this company.
 *
 * Their NOC line, their after-hours desk, the coordinator who answers when
 * nobody else does — the same on every job they send. Kept here once and
 * offered when a job is raised, instead of being typed again each time, which
 * is how the fortieth one ends up with a digit wrong.
 */
export function ClientDispatch({
  clientId,
  contacts,
}: {
  clientId: string;
  contacts: ClientDispatchRecord[];
}) {
  const [adding, setAdding] = React.useState(false);
  const [label, setLabel] = React.useState("");
  const [name, setName] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function save() {
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("clientId", clientId);
      formData.set("label", label);
      formData.set("name", name);
      formData.set("phone", phone);
      formData.set("email", email);

      const result = await saveClientDispatch(null, formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setLabel("");
      setName("");
      setPhone("");
      setEmail("");
      setAdding(false);
    });
  }

  function remove(id: string) {
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("id", id);
      const result = await deleteClientDispatch(formData);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Dispatch contacts
      </div>

      {contacts.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          None yet. Add their NOC line here and it is one press away on every
          job raised for them.
        </p>
      ) : (
        contacts.map((contact) => (
          <div
            key={contact.id}
            className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-sm"
          >
            <Phone className="size-4 shrink-0 text-muted-foreground" />
            <span className="font-medium">{contact.label}</span>
            {contact.name ? (
              <span className="text-muted-foreground">{contact.name}</span>
            ) : null}
            {contact.phone ? (
              <a
                href={telHref(contact.phone)}
                className="underline-offset-2 hover:underline"
              >
                {formatPhone(contact.phone)}
              </a>
            ) : null}
            {contact.email ? (
              <span className="min-w-0 truncate text-xs text-muted-foreground">
                {contact.email}
              </span>
            ) : null}
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
          </div>
        ))
      )}

      {error ? <p className="text-sm text-danger">{error}</p> : null}

      {adding ? (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-raised p-3">
          <Field
            label="Who they are"
            htmlFor={`disp-label-${clientId}`}
            hint="What the tech reads at two in the morning — NOC, After-hours desk."
          >
            <Input
              id={`disp-label-${clientId}`}
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="NOC"
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" htmlFor={`disp-name-${clientId}`}>
              <Input
                id={`disp-name-${clientId}`}
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoComplete="off"
              />
            </Field>
            <Field label="Phone" htmlFor={`disp-phone-${clientId}`}>
              <Input
                id={`disp-phone-${clientId}`}
                type="tel"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                autoComplete="off"
              />
            </Field>
          </div>

          <Field label="Email" htmlFor={`disp-email-${clientId}`}>
            <Input
              id={`disp-email-${clientId}`}
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="off"
            />
          </Field>

          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={pending || label.trim() === ""}
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
          <Plus /> Add a dispatch contact
        </Button>
      )}
    </div>
  );
}
