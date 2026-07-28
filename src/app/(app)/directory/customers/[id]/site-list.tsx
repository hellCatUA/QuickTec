"use client";

import { MapPin, Plus } from "lucide-react";
import { useActionState, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { FormStatus, type SaveState } from "@/components/ui/form-status";
import { EmptyState } from "@/components/ui/page-header";
import { formatAddress, mapsUrl, siteLabel } from "@/lib/address";
import { saveSite, type ActionResult } from "../../actions";

const TIME_ZONES = [
  "America/Los_Angeles",
  "America/Phoenix",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
];

type SiteRecord = {
  id: string;
  siteNumber: string;
  name: string | null;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  timeZone: string | null;
  notes: string | null;
  active: boolean;
  _count: { jobs: number };
};

function SiteForm({
  customerId,
  site,
  defaultTimeZone,
  onSaved,
}: {
  customerId: string;
  site?: SiteRecord;
  defaultTimeZone: string;
  onSaved?: () => void;
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async (prev, formData) => {
      const result = await saveSite(prev, formData);
      if (result.ok) onSaved?.();
      return result;
    },
    null,
  );

  const key = site?.id ?? "new";

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="customerId" value={customerId} />
      {site ? <input type="hidden" name="id" value={site.id} /> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Site number" htmlFor={`num-${key}`}>
          <Input
            id={`num-${key}`}
            name="siteNumber"
            defaultValue={site?.siteNumber ?? ""}
            placeholder="24541"
            required
            autoComplete="off"
          />
        </Field>
        <Field
          label="Site name"
          htmlFor={`sname-${key}`}
          hint="Optional. Internal reference only."
        >
          <Input
            id={`sname-${key}`}
            name="name"
            defaultValue={site?.name ?? ""}
            autoComplete="off"
          />
        </Field>
      </div>

      <Field label="Address" htmlFor={`a1-${key}`}>
        <Input
          id={`a1-${key}`}
          name="addressLine1"
          defaultValue={site?.addressLine1 ?? ""}
          placeholder="1912 Pike Pl"
          required
          autoComplete="off"
        />
      </Field>

      <Field label="Address line 2" htmlFor={`a2-${key}`}>
        <Input
          id={`a2-${key}`}
          name="addressLine2"
          defaultValue={site?.addressLine2 ?? ""}
          placeholder="Suite 200"
          autoComplete="off"
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-4">
        <Field label="City" htmlFor={`city-${key}`} className="sm:col-span-2">
          <Input
            id={`city-${key}`}
            name="city"
            defaultValue={site?.city ?? ""}
            required
            autoComplete="off"
          />
        </Field>
        <Field label="State" htmlFor={`state-${key}`}>
          <Input
            id={`state-${key}`}
            name="state"
            defaultValue={site?.state ?? ""}
            placeholder="CA"
            required
            autoComplete="off"
          />
        </Field>
        <Field label="ZIP" htmlFor={`zip-${key}`}>
          <Input
            id={`zip-${key}`}
            name="postalCode"
            defaultValue={site?.postalCode ?? ""}
            required
            autoComplete="off"
            inputMode="numeric"
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Country" htmlFor={`country-${key}`}>
          <Input
            id={`country-${key}`}
            name="country"
            defaultValue={site?.country ?? "USA"}
            required
            autoComplete="off"
          />
        </Field>
        <Field
          label="Time zone"
          htmlFor={`tz-${key}`}
          hint="Only set this when the site is outside the company default."
        >
          <Select
            id={`tz-${key}`}
            name="timeZone"
            defaultValue={site?.timeZone ?? ""}
          >
            <option value="">Company default ({defaultTimeZone})</option>
            {TIME_ZONES.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field label="Notes" htmlFor={`notes-${key}`}>
        <Textarea
          id={`notes-${key}`}
          name="notes"
          defaultValue={site?.notes ?? ""}
          rows={2}
          placeholder="Parking round the back, ask for the shift lead"
        />
      </Field>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="active"
          defaultChecked={site?.active ?? true}
          className="size-5 accent-[var(--color-primary)]"
        />
        Active
      </label>

      <FormStatus
        state={state as SaveState}
        pending={pending}
        label={site ? "Save" : "Add site"}
      />
    </form>
  );
}

export function SiteList({
  customerId,
  customerCode,
  sites,
  defaultTimeZone,
}: {
  customerId: string;
  customerCode: string;
  sites: SiteRecord[];
  defaultTimeZone: string;
}) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-3">
      {adding ? (
        <Card>
          <CardContent className="flex flex-col gap-4">
            <div className="text-sm font-semibold">New site</div>
            <SiteForm
              customerId={customerId}
              defaultTimeZone={defaultTimeZone}
              onSaved={() => setAdding(false)}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setAdding(false)}
            >
              Cancel
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Button
          type="button"
          variant="secondary"
          onClick={() => setAdding(true)}
          className="self-start"
        >
          <Plus /> Add site
        </Button>
      )}

      {sites.length === 0 && !adding ? (
        <EmptyState
          title="No sites yet"
          description="Add the locations you get dispatched to. The address is reused on every job at that site."
        />
      ) : null}

      {sites.map((site) => (
        <Card key={site.id}>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-wrap items-start gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">
                  {siteLabel(customerCode, site.siteNumber)}
                  {site.name ? (
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      {site.name}
                    </span>
                  ) : null}
                </div>
                <a
                  href={mapsUrl(site)}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-0.5 flex items-center gap-1 text-xs text-primary underline-offset-4 hover:underline"
                >
                  <MapPin className="size-3" />
                  {formatAddress(site)}
                </a>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {site._count.jobs} job{site._count.jobs === 1 ? "" : "s"}
                  {site.timeZone ? ` · ${site.timeZone}` : ""}
                </div>
              </div>

              <div className="ml-auto flex items-center gap-2">
                {!site.active ? <Badge variant="warning">Inactive</Badge> : null}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setEditingId(editingId === site.id ? null : site.id)
                  }
                >
                  {editingId === site.id ? "Close" : "Edit"}
                </Button>
              </div>
            </div>

            {editingId === site.id ? (
              <div className="border-t border-border pt-3">
                <SiteForm
                  customerId={customerId}
                  site={site}
                  defaultTimeZone={defaultTimeZone}
                />
              </div>
            ) : null}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
