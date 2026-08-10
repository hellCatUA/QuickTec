"use client";

import { AlertTriangle, Mail, Phone, Plus, X } from "lucide-react";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatPhone, formatPhoneAsTyped, telHref } from "@/lib/phone";
import { Field, Input, Select } from "@/components/ui/field";
import type { ContactType } from "@prisma-client";
import { addPointOfContact, deletePointOfContact } from "./actions";

const TYPE_META: Record<
  ContactType,
  { label: string; description: string; required: boolean; multiple: boolean }
> = {
  MOD: {
    label: "MOD",
    description: "Manager On Duty. Required, and a site can have several.",
    required: true,
    multiple: true,
  },
  NOC: {
    label: "NOC",
    description: "The engineer on the call. Optional but worth having.",
    required: false,
    multiple: false,
  },
  PM_PC: {
    label: "PM/PC",
    description:
      "Project coordinator on the subcontractor's side — not our own project manager.",
    required: false,
    multiple: false,
  },
};

type Contact = {
  id: string;
  type: ContactType;
  name: string;
  phone: string | null;
  email: string | null;
};

export function PointsOfContact({
  jobId,
  contacts,
  canEdit,
}: {
  jobId: string;
  contacts: Contact[];
  canEdit: boolean;
}) {
  const [adding, setAdding] = React.useState<ContactType | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const byType = (type: ContactType) =>
    contacts.filter((contact) => contact.type === type);

  return (
    <div className="flex flex-col gap-4">
      {error ? <p className="text-sm text-danger">{error}</p> : null}

      {(Object.keys(TYPE_META) as ContactType[]).map((type) => {
        const meta = TYPE_META[type];
        const entries = byType(type);
        const canAdd = canEdit && (meta.multiple || entries.length === 0);

        return (
          <div key={type} className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {meta.label}
              </span>
              {meta.required && entries.length === 0 ? (
                <Badge variant="warning">
                  <AlertTriangle className="size-3" /> Required
                </Badge>
              ) : null}
              {canAdd && adding !== type ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setAdding(type)}
                >
                  <Plus /> Add
                </Button>
              ) : null}
            </div>

            {entries.length === 0 && adding !== type ? (
              <p className="text-xs text-muted-foreground">{meta.description}</p>
            ) : null}

            {entries.map((contact) => (
              <div
                key={contact.id}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2"
              >
                <span className="text-sm font-medium">{contact.name}</span>

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

                {canEdit ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="ml-auto"
                    aria-label={`Remove ${contact.name}`}
                    disabled={pending}
                    onClick={() => {
                      setError(null);
                      startTransition(async () => {
                        const formData = new FormData();
                        formData.set("id", contact.id);
                        const result = await deletePointOfContact(formData);
                        if (!result.ok) setError(result.error);
                      });
                    }}
                  >
                    <X />
                  </Button>
                ) : null}
              </div>
            ))}

            {adding === type ? (
              <ContactForm
                jobId={jobId}
                type={type}
                onDone={() => setAdding(null)}
                onError={setError}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function ContactForm({
  jobId,
  type,
  onDone,
  onError,
}: {
  jobId: string;
  type: ContactType;
  onDone: () => void;
  onError: (message: string | null) => void;
}) {
  const [pending, startTransition] = React.useTransition();
  const [name, setName] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [email, setEmail] = React.useState("");

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-raised p-3">
      <Field label="Name" htmlFor={`poc-name-${type}`}>
        <Input
          id={`poc-name-${type}`}
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoFocus
          autoComplete="off"
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Phone" htmlFor={`poc-phone-${type}`}>
          <Input
            id={`poc-phone-${type}`}
            type="tel"
            value={phone}
            onChange={(event) => setPhone(formatPhoneAsTyped(event.target.value))}
            autoComplete="off"
          />
        </Field>
        <Field label="Email" htmlFor={`poc-email-${type}`}>
          <Input
            id={`poc-email-${type}`}
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="off"
          />
        </Field>
      </div>

      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          disabled={pending || !name.trim()}
          onClick={() => {
            onError(null);
            startTransition(async () => {
              const formData = new FormData();
              formData.set("jobId", jobId);
              formData.set("type", type);
              formData.set("name", name);
              formData.set("phone", phone);
              formData.set("email", email);

              const result = await addPointOfContact(null, formData);
              if (!result.ok) onError(result.error);
              else onDone();
            });
          }}
        >
          Save
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** Kept beside the form so the picker and the section agree on wording. */
export function ContactTypeSelect(
  props: React.SelectHTMLAttributes<HTMLSelectElement>,
) {
  return (
    <Select {...props}>
      {(Object.keys(TYPE_META) as ContactType[]).map((type) => (
        <option key={type} value={type}>
          {TYPE_META[type].label}
        </option>
      ))}
    </Select>
  );
}
