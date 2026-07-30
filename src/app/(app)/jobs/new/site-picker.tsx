"use client";

import { Info } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboOption } from "@/components/ui/combobox";
import { Field, Input } from "@/components/ui/field";
import { quickCreateSite } from "../actions";

export type SiteOption = {
  id: string;
  siteNumber: string;
  city: string;
  state: string;
  customer: { id: string; code: string; name: string };
};

export type CustomerOption = { id: string; code: string; name: string };

/**
 * Finds a site, or adds the one that has just been named on the phone.
 *
 * A site number is very often not known when the job is planned — it turns up
 * mid-call, or the tech reads it off the door. Making somebody leave the form,
 * go to the directory and come back is how jobs end up filed against the wrong
 * site, so the search offers to create what was typed.
 */
export function SitePicker({
  sites,
  customers,
  value,
  onChange,
}: {
  sites: SiteOption[];
  customers: CustomerOption[];
  value: string;
  onChange: (siteId: string) => void;
}) {
  const [creating, setCreating] = React.useState<string | null>(null);
  const [customerId, setCustomerId] = React.useState("");
  const [customerName, setCustomerName] = React.useState("");
  const [siteNumber, setSiteNumber] = React.useState("");
  const [address, setAddress] = React.useState("");
  const [city, setCity] = React.useState("");
  const [state, setState] = React.useState("");
  const [postalCode, setPostalCode] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const [added, setAdded] = React.useState<SiteOption[]>([]);
  const all = React.useMemo(() => [...added, ...sites], [added, sites]);

  const options: ComboOption[] = all.map((site) => ({
    value: site.id,
    label: `${site.customer.code} #${site.siteNumber}`,
    hint: [site.city, site.state].filter(Boolean).join(", ") || site.customer.name,
    keywords: site.customer.name,
  }));

  function beginCreate(query: string) {
    setError(null);
    setCreating(query);
    setSiteNumber(query.replace(/^#/, ""));
    setCustomerId(customers[0]?.id ?? "");
    setCustomerName("");
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("customerId", customerId);
      formData.set("customerName", customerName);
      formData.set("siteNumber", siteNumber);
      formData.set("addressLine1", address);
      formData.set("city", city);
      formData.set("state", state);
      formData.set("postalCode", postalCode);

      const result = await quickCreateSite(null, formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }

      const customer =
        customers.find((entry) => entry.id === customerId) ??
        ({
          id: "new",
          code: customerName.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8),
          name: customerName,
        } as CustomerOption);

      setAdded((current) => [
        {
          id: result.id!,
          siteNumber,
          city,
          state,
          customer,
        },
        ...current,
      ]);
      onChange(result.id!);
      setCreating(null);
    });
  }

  if (creating !== null) {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-primary/40 bg-primary/5 p-3">
        <div className="flex items-start gap-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          New site. Only the number is needed now — the address can be filled in
          on arrival, and the directory is where it gets tidied up.
        </div>

        <Field label="Customer" htmlFor="qs-customer">
          <Combobox
            id="qs-customer"
            value={customerId}
            onChange={(next) => {
              setCustomerId(next);
              if (next) setCustomerName("");
            }}
            placeholder="Search customers…"
            options={customers.map((customer) => ({
              value: customer.id,
              label: customer.name,
              hint: customer.code,
            }))}
          />
        </Field>

        {!customerId ? (
          <Field
            label="Or a new customer"
            htmlFor="qs-customer-name"
            hint="The code is taken from the name — SBUX #24541 is how it reads afterwards."
          >
            <Input
              id="qs-customer-name"
              value={customerName}
              onChange={(event) => setCustomerName(event.target.value)}
              placeholder="Starbucks"
            />
          </Field>
        ) : null}

        <Field label="Site number" htmlFor="qs-number">
          <Input
            id="qs-number"
            value={siteNumber}
            onChange={(event) => setSiteNumber(event.target.value)}
            placeholder="24541"
          />
        </Field>

        <Field label="Address" htmlFor="qs-address">
          <Input
            id="qs-address"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder="1912 Pike Pl"
          />
        </Field>

        <div className="grid grid-cols-3 gap-2">
          <Field label="City" htmlFor="qs-city">
            <Input
              id="qs-city"
              value={city}
              onChange={(event) => setCity(event.target.value)}
            />
          </Field>
          <Field label="State" htmlFor="qs-state">
            <Input
              id="qs-state"
              value={state}
              onChange={(event) => setState(event.target.value)}
            />
          </Field>
          <Field label="ZIP" htmlFor="qs-zip">
            <Input
              id="qs-zip"
              value={postalCode}
              onChange={(event) => setPostalCode(event.target.value)}
            />
          </Field>
        </div>

        {error ? <p className="text-sm text-danger">{error}</p> : null}

        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            disabled={pending || !siteNumber.trim()}
            onClick={save}
          >
            Add site
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setCreating(null)}
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Combobox
      id="siteId"
      name="siteId"
      value={value}
      onChange={onChange}
      options={options}
      placeholder="Search by site number, customer or city…"
      emptyText="No site matches."
      onCreate={beginCreate}
      createLabel={(query) => `Add site #${query.replace(/^#/, "")}`}
    />
  );
}
