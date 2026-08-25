"use client";

import { Check, Loader2, Pencil } from "lucide-react";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { PhoneInput } from "@/components/ui/phone-input";
import { StatePicker } from "@/components/ui/state-picker";
import { formatPhone } from "@/lib/phone";
import { updateOwnContact, type ContactResult } from "./actions";

export type OwnContact = {
  phone: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
};

/**
 * The part of a person's record that is theirs to keep current.
 *
 * Closed until somebody wants it, because most of the time this page is opened
 * to change the theme or to sign out. Everything that decides money — the
 * rate, the supervisor, the legal name payroll pays — stays a manager's, and
 * is not in this form.
 */
export function ContactForm({ contact }: { contact: OwnContact }) {
  const [open, setOpen] = useState(false);
  const [region, setRegion] = useState((contact.state ?? "").toUpperCase());

  const [state, formAction, pending] = useActionState<
    ContactResult | null,
    FormData
  >(async (prev, formData) => {
    const result = await updateOwnContact(prev, formData);
    if (result.ok) setOpen(false);
    return result;
  }, null);

  const address = [
    contact.addressLine1,
    contact.addressLine2,
    [contact.city, contact.state].filter(Boolean).join(", "),
    contact.postalCode,
    contact.country,
  ]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" · ");

  if (!open) {
    return (
      <div className="flex flex-col gap-2 text-sm">
        <Row label="Phone" value={formatPhone(contact.phone) || "not on file"} />
        <Row label="Address" value={address || "not on file"} />

        <div className="flex items-center gap-2 pt-1">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setOpen(true)}
          >
            <Pencil /> Update
          </Button>
          {state?.ok ? (
            <span className="flex items-center gap-1 text-xs text-success">
              <Check className="size-3.5" /> Saved
            </span>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Field label="Phone" htmlFor="own-phone">
        <PhoneInput id="own-phone" name="phone" defaultValue={contact.phone} />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Address line 1" htmlFor="own-addr1">
          <Input
            id="own-addr1"
            name="addressLine1"
            defaultValue={contact.addressLine1 ?? ""}
            autoComplete="address-line1"
          />
        </Field>
        <Field label="Address line 2" htmlFor="own-addr2">
          <Input
            id="own-addr2"
            name="addressLine2"
            defaultValue={contact.addressLine2 ?? ""}
            autoComplete="address-line2"
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <Field label="City" htmlFor="own-city" className="sm:col-span-2">
          <Input
            id="own-city"
            name="city"
            defaultValue={contact.city ?? ""}
            autoComplete="address-level2"
          />
        </Field>
        <Field label="State" htmlFor="own-state">
          <StatePicker
            id="own-state"
            name="state"
            value={region}
            onChange={setRegion}
          />
        </Field>
        <Field label="ZIP" htmlFor="own-zip">
          <Input
            id="own-zip"
            name="postalCode"
            defaultValue={contact.postalCode ?? ""}
            inputMode="numeric"
            autoComplete="postal-code"
          />
        </Field>
      </div>

      <Field label="Country" htmlFor="own-country">
        <Input
          id="own-country"
          name="country"
          defaultValue={contact.country ?? "USA"}
          autoComplete="country-name"
        />
      </Field>

      {state && !state.ok ? (
        <p className="text-sm text-danger">{state.error}</p>
      ) : null}

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : null}
          Save
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => setOpen(false)}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}
