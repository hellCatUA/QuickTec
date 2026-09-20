"use client";

import { AlertTriangle, Mail, Phone, Plus } from "lucide-react";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatPhone, formatPhoneAsTyped, telHref } from "@/lib/phone";
import { capitaliseName } from "@/lib/names";
import { Field, Input, Select } from "@/components/ui/field";
import { PositionPicker } from "@/components/ui/position-picker";
import { RowMenu } from "@/components/ui/row-menu";
import type { ContactType } from "@prisma-client";
import {
  addPointOfContact,
  deletePointOfContact,
  updatePointOfContact,
} from "./actions";

/**
 * MOD reads MOD/POC and NOC reads NOC Rep.
 *
 * The words on screen only. The enum, the client text report and the form
 * catalogue keep saying MOD and NOC: those are what a client's PDF asks for
 * and what every job already recorded is stored as, and renaming a label is
 * not a reason to migrate data or to change what goes out to a customer.
 */
const TYPE_META: Record<
  ContactType,
  { label: string; description: string; required: boolean; multiple: boolean }
> = {
  MOD: {
    label: "MOD/POC",
    description:
      "Manager On Duty, or whoever is answering for the site. Required, and there can be several.",
    required: true,
    multiple: true,
  },
  NOC: {
    label: "NOC Rep",
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
  position: string | null;
  phone: string | null;
  email: string | null;
};

export function PointsOfContact({
  jobId,
  contacts,
  positions,
  canEdit,
}: {
  jobId: string;
  contacts: Contact[];
  /** The configured dictionary, for whoever is asked what they do. */
  positions: string[];
  canEdit: boolean;
}) {
  const [adding, setAdding] = React.useState<ContactType | null>(null);
  const [editing, setEditing] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const byType = (type: ContactType) =>
    contacts.filter((contact) => contact.type === type);

  function remove(contact: Contact) {
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("id", contact.id);
      const result = await deletePointOfContact(formData);
      if (!result.ok) setError(result.error);
    });
  }

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
                  // Three sections, three Add buttons: without the name a
                  // screen reader reads the same word three times.
                  aria-label={`Add ${meta.label}`}
                  onClick={() => setAdding(type)}
                >
                  <Plus /> Add
                </Button>
              ) : null}
            </div>

            {entries.length === 0 && adding !== type ? (
              <p className="text-xs text-muted-foreground">
                {meta.description}
              </p>
            ) : null}

            {entries.map((contact) =>
              editing === contact.id ? (
                <ContactForm
                  key={contact.id}
                  jobId={jobId}
                  type={type}
                  positions={positions}
                  existing={contact}
                  onDone={() => setEditing(null)}
                  onError={setError}
                />
              ) : (
                <div
                  key={contact.id}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2"
                >
                  <span className="text-sm font-medium">{contact.name}</span>

                  {contact.position ? (
                    <span className="text-xs text-muted-foreground">
                      {contact.position}
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

                  {canEdit ? (
                    <RowMenu
                      className="ml-auto"
                      label={`Options for ${contact.name}`}
                      disabled={pending}
                      items={[
                        {
                          label: "Edit",
                          onSelect: () => {
                            setError(null);
                            setEditing(contact.id);
                          },
                        },
                        {
                          label: "Delete",
                          tone: "danger",
                          confirm: `Remove ${contact.name} from this job?`,
                          onSelect: () => remove(contact),
                        },
                      ]}
                    />
                  ) : null}
                </div>
              ),
            )}

            {adding === type ? (
              <ContactForm
                jobId={jobId}
                type={type}
                positions={positions}
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
  positions,
  existing,
  onDone,
  onError,
}: {
  jobId: string;
  type: ContactType;
  positions: string[];
  /** Present when correcting one already on the job. */
  existing?: Contact;
  onDone: () => void;
  onError: (message: string | null) => void;
}) {
  const [pending, startTransition] = React.useTransition();
  const [name, setName] = React.useState(existing?.name ?? "");
  const [position, setPosition] = React.useState(existing?.position ?? "");
  const [phone, setPhone] = React.useState(
    existing?.phone ? formatPhone(existing.phone) : "",
  );
  const [email, setEmail] = React.useState(existing?.email ?? "");

  // Ids have to differ between the add form and an edit form open at the same
  // time, or a label points at the wrong box.
  const key = existing ? existing.id : `new-${type}`;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-raised p-3">
      <Field label="Name" htmlFor={`poc-name-${key}`}>
        <Input
          id={`poc-name-${key}`}
          value={name}
          onChange={(event) => setName(capitaliseName(event.target.value))}
          autoFocus
          autoComplete="off"
          autoCapitalize="words"
        />
      </Field>

      {/* Only the MOD/POC is asked. The other two are a role already — an
          engineer on a call and a coordinator at a desk — and a second box
          saying so is a box somebody has to skip past. */}
      {type === "MOD" ? (
        <Field
          label="Position"
          htmlFor={`poc-position-${key}`}
          hint="Pick one or type your own."
        >
          <PositionPicker
            id={`poc-position-${key}`}
            value={position}
            onChange={setPosition}
            dictionary={positions}
          />
        </Field>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Phone" htmlFor={`poc-phone-${key}`}>
          <Input
            id={`poc-phone-${key}`}
            type="tel"
            value={phone}
            onChange={(event) =>
              setPhone(formatPhoneAsTyped(event.target.value))
            }
            autoComplete="off"
          />
        </Field>
        <Field label="Email" htmlFor={`poc-email-${key}`}>
          <Input
            id={`poc-email-${key}`}
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
              formData.set("name", name);
              formData.set("position", position);
              formData.set("phone", phone);
              formData.set("email", email);

              if (existing) {
                formData.set("id", existing.id);
                const result = await updatePointOfContact(null, formData);
                if (!result.ok) return onError(result.error);
                return onDone();
              }

              formData.set("jobId", jobId);
              formData.set("type", type);
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

/** What a type is called on screen, for anything outside this file. */
export function contactTypeLabel(type: ContactType): string {
  return TYPE_META[type].label;
}
