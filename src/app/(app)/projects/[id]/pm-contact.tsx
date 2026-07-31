"use client";

import { Info, Mail, Phone } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Field, Input } from "@/components/ui/field";
import { createExternalContact } from "../actions";

export type ContactOption = {
  id: string;
  name: string;
  title: string | null;
  phone: string | null;
  email: string | null;
  clientId: string | null;
};

/**
 * The representing company's project manager or coordinator.
 *
 * Their side of the job, not ours — the person a tech rings when the door is
 * locked. You meet the same coordinators across projects, so they are records
 * rather than three text fields retyped every time: pick the name and their
 * number comes with it. Only the name reaches the client-facing report.
 *
 * The value is submitted through a hidden input, so this sits inside the
 * ordinary project form and saves with everything else.
 */
export function PmContactPicker({
  name,
  contacts,
  value,
  onChange,
  clientId,
}: {
  name: string;
  contacts: ContactOption[];
  value: string;
  onChange: (id: string) => void;
  /** Their own people are offered first; anyone else is still reachable. */
  clientId: string;
}) {
  const [adding, setAdding] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState({
    name: "",
    title: "",
    phone: "",
    email: "",
  });
  const [added, setAdded] = React.useState<ContactOption[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const all = React.useMemo(() => [...added, ...contacts], [added, contacts]);
  const selected = all.find((contact) => contact.id === value) ?? null;

  const ordered = React.useMemo(() => {
    const theirs = all.filter((contact) => contact.clientId === clientId);
    const rest = all.filter((contact) => contact.clientId !== clientId);
    return [...theirs, ...rest];
  }, [all, clientId]);

  function save() {
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("name", draft.name);
      formData.set("title", draft.title);
      formData.set("phone", draft.phone);
      formData.set("email", draft.email);
      if (clientId) formData.set("clientId", clientId);

      const result = await createExternalContact(null, formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }

      const contact: ContactOption = {
        id: result.id!,
        name: draft.name,
        title: draft.title || null,
        phone: draft.phone || null,
        email: draft.email || null,
        clientId: clientId || null,
      };
      setAdded((current) => [contact, ...current]);
      onChange(contact.id);
      setAdding(null);
      setDraft({ name: "", title: "", phone: "", email: "" });
    });
  }

  if (adding !== null) {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-primary/40 bg-primary/5 p-3">
        <input type="hidden" name={name} value={value} />

        <div className="flex items-start gap-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          Kept internally. The client report shows the name only — never the
          number.
        </div>

        <Field label="Name" htmlFor="pm-name">
          <Input
            id="pm-name"
            value={draft.name}
            onChange={(event) =>
              setDraft((current) => ({ ...current, name: event.target.value }))
            }
            autoFocus
          />
        </Field>
        <Field label="Title" htmlFor="pm-title">
          <Input
            id="pm-title"
            value={draft.title}
            onChange={(event) =>
              setDraft((current) => ({ ...current, title: event.target.value }))
            }
            placeholder="Project coordinator"
          />
        </Field>
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="Phone" htmlFor="pm-phone">
            <Input
              id="pm-phone"
              value={draft.phone}
              onChange={(event) =>
                setDraft((current) => ({ ...current, phone: event.target.value }))
              }
            />
          </Field>
          <Field label="Email" htmlFor="pm-email">
            <Input
              id="pm-email"
              value={draft.email}
              onChange={(event) =>
                setDraft((current) => ({ ...current, email: event.target.value }))
              }
            />
          </Field>
        </div>

        {error ? <p className="text-sm text-danger">{error}</p> : null}

        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            disabled={pending || !draft.name.trim()}
            onClick={save}
          >
            Save contact
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setAdding(null)}
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <input type="hidden" name={name} value={value} />

      <Combobox
        id="pmContactId"
        value={value}
        onChange={onChange}
        placeholder="Search people…"
        emptyText="Nobody by that name yet."
        options={ordered.map((contact) => ({
          value: contact.id,
          label: contact.name,
          hint: [contact.title, contact.phone].filter(Boolean).join(" · ") || undefined,
          keywords: `${contact.email ?? ""} ${contact.phone ?? ""}`,
        }))}
        onCreate={(query) => {
          setError(null);
          setDraft({ name: query, title: "", phone: "", email: "" });
          setAdding(query);
        }}
        createLabel={(query) => `Add ${query}`}
      />

      {selected ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-2 text-xs text-muted-foreground">
          {selected.title ? <span>{selected.title}</span> : null}
          {selected.phone ? (
            <a
              href={`tel:${selected.phone}`}
              className="flex items-center gap-1 text-primary underline-offset-4 hover:underline"
            >
              <Phone className="size-3.5" /> {selected.phone}
            </a>
          ) : null}
          {selected.email ? (
            <a
              href={`mailto:${selected.email}`}
              className="flex items-center gap-1 text-primary underline-offset-4 hover:underline"
            >
              <Mail className="size-3.5" /> {selected.email}
            </a>
          ) : null}
          {!selected.title && !selected.phone && !selected.email ? (
            <span>No contact details recorded for them yet.</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
