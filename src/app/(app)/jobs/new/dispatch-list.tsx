"use client";

import { Plus, X } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";

export type DraftContact = {
  label: string;
  name: string;
  phone: string;
  email: string;
  note: string;
};

const EMPTY: DraftContact = {
  label: "",
  name: "",
  phone: "",
  email: "",
  note: "",
};

/**
 * Numbers to reach mid-job, added while the job is being raised.
 *
 * The project's own contacts already travel with every job under it; these are
 * the ones for this job alone — the bridge line that only exists today, the
 * site manager's mobile that dispatch read out on the call. They had to be
 * added after the fact from the job page, which meant in practice they were
 * not added at all.
 *
 * Submitted as parallel arrays rather than JSON so the values arrive as
 * ordinary form fields, the way everything else on this form does.
 */
export function DispatchList({
  inherited,
  companyDefaults,
}: {
  /** From the project, shown so nobody re-types what is already there. */
  inherited: { id: string; label: string; name: string | null }[];
  /** Held against the representing company — added with one press, or all. */
  companyDefaults: {
    id: string;
    label: string;
    name: string | null;
    phone: string | null;
    email: string | null;
    note: string | null;
  }[];
}) {
  const [contacts, setContacts] = React.useState<DraftContact[]>([]);

  /**
   * Offered rather than added on their own.
   *
   * A number that appeared without being asked for is one nobody reads before
   * it goes onto a job, and a stale NOC line is worse than an absent one — the
   * tech rings it at two in the morning and nobody picks up. One press puts
   * them all on, and they stay editable afterwards like any other row.
   */
  function addCompanyDefault(
    contact: (typeof companyDefaults)[number],
  ): void {
    setContacts((current) =>
      current.some(
        (row) => row.label === contact.label && row.phone === (contact.phone ?? ""),
      )
        ? current
        : [
            ...current,
            {
              label: contact.label,
              name: contact.name ?? "",
              phone: contact.phone ?? "",
              email: contact.email ?? "",
              note: contact.note ?? "",
            },
          ],
    );
  }

  function update(index: number, patch: Partial<DraftContact>) {
    setContacts((current) =>
      current.map((contact, position) =>
        position === index ? { ...contact, ...patch } : contact,
      ),
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {inherited.length > 0 ? (
        <div className="flex flex-col gap-1 rounded-lg border border-border bg-muted/40 p-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            From the project
          </span>
          {inherited.map((contact) => (
            <span key={contact.id} className="text-xs text-muted-foreground">
              {contact.label}
              {contact.name ? ` · ${contact.name}` : ""}
            </span>
          ))}
          <span className="text-xs text-muted-foreground">
            These come across on their own. Anything below is for this job only.
          </span>
        </div>
      ) : null}

      {companyDefaults.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-lg border border-dashed border-border p-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Their usual numbers
            </span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="ml-auto"
              onClick={() => companyDefaults.forEach(addCompanyDefault)}
            >
              <Plus /> Add them all
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {companyDefaults.map((contact) => (
              <Button
                key={contact.id}
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => addCompanyDefault(contact)}
              >
                <Plus />
                {contact.label}
                {contact.name ? ` · ${contact.name}` : ""}
              </Button>
            ))}
          </div>
        </div>
      ) : null}

      {contacts.map((contact, index) => (
        <div
          key={index}
          className="flex flex-col gap-2 rounded-lg border border-border p-2"
        >
          {/* Empty strings still submit, so every row lines up with its
              siblings and the server can zip them back together. */}
          <input type="hidden" name="dispatchName" value={contact.name} />
          <input type="hidden" name="dispatchEmail" value={contact.email} />
          <input type="hidden" name="dispatchNote" value={contact.note} />

          <div className="flex items-start gap-2">
            <Field
              label="Who they are"
              htmlFor={`dispatch-label-${index}`}
              className="flex-1"
            >
              <Input
                id={`dispatch-label-${index}`}
                name="dispatchLabel"
                value={contact.label}
                onChange={(event) => update(index, { label: event.target.value })}
                placeholder="Bridge line"
                autoComplete="off"
              />
            </Field>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="mt-6"
              aria-label={`Remove contact ${index + 1}`}
              onClick={() =>
                setContacts((current) =>
                  current.filter((_, position) => position !== index),
                )
              }
            >
              <X />
            </Button>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Name" htmlFor={`dispatch-name-${index}`}>
              <Input
                id={`dispatch-name-${index}`}
                value={contact.name}
                onChange={(event) => update(index, { name: event.target.value })}
                autoComplete="off"
              />
            </Field>
            <Field label="Phone" htmlFor={`dispatch-phone-${index}`}>
              <Input
                id={`dispatch-phone-${index}`}
                name="dispatchPhone"
                value={contact.phone}
                onChange={(event) => update(index, { phone: event.target.value })}
                inputMode="tel"
                autoComplete="off"
              />
            </Field>
            <Field label="Email" htmlFor={`dispatch-email-${index}`}>
              <Input
                id={`dispatch-email-${index}`}
                value={contact.email}
                onChange={(event) => update(index, { email: event.target.value })}
                inputMode="email"
                autoComplete="off"
              />
            </Field>
            <Field label="Note" htmlFor={`dispatch-note-${index}`}>
              <Input
                id={`dispatch-note-${index}`}
                value={contact.note}
                onChange={(event) => update(index, { note: event.target.value })}
                placeholder="Ask for the duty manager"
                autoComplete="off"
              />
            </Field>
          </div>
        </div>
      ))}

      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="self-start"
        onClick={() => setContacts((current) => [...current, { ...EMPTY }])}
      >
        <Plus /> Add a dispatch contact
      </Button>
    </div>
  );
}
