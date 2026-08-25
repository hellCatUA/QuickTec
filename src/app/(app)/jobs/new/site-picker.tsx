"use client";

import { Info } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboOption } from "@/components/ui/combobox";
import { Field, Input } from "@/components/ui/field";
import { StatePicker } from "@/components/ui/state-picker";
import { quickCreateSite } from "../actions";

export type SiteOption = {
  id: string;
  siteNumber: string;
  numberPending: boolean;
  city: string;
  state: string;
  customer: { id: string; code: string; name: string };
};

export type CustomerOption = { id: string; code: string; name: string };

type Mode = { kind: "number"; query: string } | { kind: "unknown" };

/**
 * Finds a site under the chosen customer, or adds the one just named on the
 * phone.
 *
 * A site number is very often not known when the job is planned — it turns up
 * mid-call, or the tech reads it off the door. Making somebody leave the form,
 * go to the directory and come back is how jobs end up filed against the wrong
 * site, so the search offers to create what was typed, and "No SiteID" raises
 * the job without one at all for the tech to fill in on arrival.
 */
export function SitePicker({
  sites,
  customerId,
  customerName,
  value,
  onChange,
  onCreated,
}: {
  /** Already narrowed to the chosen customer by the caller. */
  sites: SiteOption[];
  customerId: string;
  customerName: string;
  value: string;
  onChange: (siteId: string) => void;
  onCreated: (site: SiteOption) => void;
}) {
  const [mode, setMode] = React.useState<Mode | null>(null);
  const [siteNumber, setSiteNumber] = React.useState("");
  const [address, setAddress] = React.useState("");
  const [city, setCity] = React.useState("");
  const [state, setState] = React.useState("");
  const [postalCode, setPostalCode] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const options: ComboOption[] = sites.map((site) => ({
    value: site.id,
    label: site.numberPending
      ? `${site.customer.code} — number pending`
      : `${site.customer.code} #${site.siteNumber}`,
    hint:
      [site.city, site.state].filter(Boolean).join(", ") || site.customer.name,
    keywords: site.customer.name,
  }));

  function begin(next: Mode) {
    setError(null);
    setMode(next);
    setSiteNumber(next.kind === "number" ? next.query.replace(/^#/, "") : "");
    setAddress("");
    setCity("");
    setState("");
    setPostalCode("");
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("customerId", customerId);
      formData.set("addressLine1", address);
      formData.set("city", city);
      formData.set("state", state);
      formData.set("postalCode", postalCode);
      if (mode?.kind === "unknown") formData.set("numberPending", "on");
      else formData.set("siteNumber", siteNumber);

      const result = await quickCreateSite(null, formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }

      onCreated({
        id: result.id!,
        siteNumber: mode?.kind === "unknown" ? "" : siteNumber,
        numberPending: mode?.kind === "unknown",
        city,
        state,
        customer: {
          id: customerId,
          code: result.customerCode ?? "",
          name: customerName,
        },
      });
      onChange(result.id!);
      setMode(null);
    });
  }

  if (!customerId) {
    return (
      <p className="text-sm text-muted-foreground">
        Pick the customer first — sites belong to one.
      </p>
    );
  }

  if (mode !== null) {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-primary/40 bg-primary/5 p-3">
        <div className="flex items-start gap-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          {mode.kind === "unknown" ? (
            <>
              New site for {customerName} with no number yet. The tech reads it
              off the door and fills it in from the job page; the address can
              wait too.
            </>
          ) : (
            <>
              New site for {customerName}. Only the number is needed now — the
              address can be filled in on arrival, and the directory is where it
              gets tidied up.
            </>
          )}
        </div>

        {mode.kind === "number" ? (
          <Field label="Site number" htmlFor="qs-number">
            <Input
              id="qs-number"
              value={siteNumber}
              onChange={(event) => setSiteNumber(event.target.value)}
              placeholder="24541"
              autoFocus
            />
          </Field>
        ) : null}

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
            <StatePicker id="qs-state" value={state} onChange={setState} />
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
            disabled={
              pending || (mode.kind === "number" && !siteNumber.trim())
            }
            onClick={save}
          >
            {mode.kind === "unknown" ? "Add it without a number" : "Add site"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setMode(null)}
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Combobox
        id="siteId"
        name="siteId"
        value={value}
        onChange={onChange}
        options={options}
        placeholder={
          sites.length === 0
            ? `No sites on file for ${customerName} yet`
            : "Search by site number or city…"
        }
        emptyText="No site matches."
        onCreate={(query) => begin({ kind: "number", query })}
        createLabel={(query) => `Add site #${query.replace(/^#/, "")}`}
      />

      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="self-start"
        onClick={() => begin({ kind: "unknown" })}
      >
        No SiteID
      </Button>
    </div>
  );
}
