"use client";

import { Check, Loader2 } from "lucide-react";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { updateCompanySettings, type ActionResult } from "../actions";

// Everywhere the company actually operates. Kept short on purpose — a long
// list is unusable on a phone.
const TIME_ZONES = [
  "America/Los_Angeles",
  "America/Phoenix",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "UTC",
];

type CompanyFormValues = {
  name: string;
  logoUrl: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  intWoLabel: string;
  defaultTimeZone: string;
  timeRoundingMinutes: number;
  techTimeAdjustLimit: number;
  breakPaidByDefault: boolean;
  mileageRate: string;
  payLagWeeks: number;
  maxPhotosPerJob: number;
  watermarkEnabled: boolean;
};

export function CompanyForm({ company }: { company: CompanyFormValues }) {
  const [state, formAction, pending] = useActionState<
    ActionResult | null,
    FormData
  >(updateCompanySettings, null);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Identity</CardTitle>
          <CardDescription>
            The company name is used verbatim in the internal work order field
            label, e.g. &ldquo;{company.name} {company.intWoLabel}&rdquo;.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Company name" htmlFor="name">
            <Input id="name" name="name" defaultValue={company.name} required />
          </Field>
          <Field
            label="Internal WO label"
            htmlFor="intWoLabel"
            hint="Appended after the company name."
          >
            <Input
              id="intWoLabel"
              name="intWoLabel"
              defaultValue={company.intWoLabel}
              required
            />
          </Field>
          <Field
            label="Logo URL"
            htmlFor="logoUrl"
            hint="File upload arrives with the storage layer; a URL works today."
            className="sm:col-span-2"
          >
            <Input
              id="logoUrl"
              name="logoUrl"
              defaultValue={company.logoUrl ?? ""}
              placeholder="https://…"
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Contact</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Address line 1" htmlFor="addressLine1">
            <Input
              id="addressLine1"
              name="addressLine1"
              defaultValue={company.addressLine1 ?? ""}
            />
          </Field>
          <Field label="Address line 2" htmlFor="addressLine2">
            <Input
              id="addressLine2"
              name="addressLine2"
              defaultValue={company.addressLine2 ?? ""}
            />
          </Field>
          <Field label="City" htmlFor="city">
            <Input id="city" name="city" defaultValue={company.city ?? ""} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="State" htmlFor="state">
              <Input
                id="state"
                name="state"
                defaultValue={company.state ?? ""}
              />
            </Field>
            <Field label="ZIP" htmlFor="postalCode">
              <Input
                id="postalCode"
                name="postalCode"
                defaultValue={company.postalCode ?? ""}
              />
            </Field>
          </div>
          <Field label="Country" htmlFor="country">
            <Input
              id="country"
              name="country"
              defaultValue={company.country ?? ""}
            />
          </Field>
          <Field label="Phone" htmlFor="phone">
            <Input
              id="phone"
              name="phone"
              type="tel"
              defaultValue={company.phone ?? ""}
            />
          </Field>
          <Field label="Email" htmlFor="email">
            <Input
              id="email"
              name="email"
              type="email"
              defaultValue={company.email ?? ""}
            />
          </Field>
          <Field label="Website" htmlFor="website">
            <Input
              id="website"
              name="website"
              defaultValue={company.website ?? ""}
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Time &amp; pay</CardTitle>
          <CardDescription>
            Clock times snap to the rounding interval once, at the moment of
            clock in/out. Pay is then computed from the snapped time with no
            second rounding.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Default time zone" htmlFor="defaultTimeZone">
            <Select
              id="defaultTimeZone"
              name="defaultTimeZone"
              defaultValue={company.defaultTimeZone}
            >
              {TIME_ZONES.map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Clock rounding (minutes)"
            htmlFor="timeRoundingMinutes"
          >
            <Input
              id="timeRoundingMinutes"
              name="timeRoundingMinutes"
              type="number"
              min={1}
              max={60}
              defaultValue={company.timeRoundingMinutes}
            />
          </Field>
          <Field
            label="Tech time adjust limit (minutes)"
            htmlFor="techTimeAdjustLimit"
            hint="How far a tech may move their own clock time. Supervisors are not capped."
          >
            <Input
              id="techTimeAdjustLimit"
              name="techTimeAdjustLimit"
              type="number"
              min={0}
              max={480}
              defaultValue={company.techTimeAdjustLimit}
            />
          </Field>
          <Field
            label="Mileage rate ($ / mile)"
            htmlFor="mileageRate"
          >
            <Input
              id="mileageRate"
              name="mileageRate"
              type="number"
              step="0.0001"
              min={0}
              defaultValue={company.mileageRate}
            />
          </Field>
          <Field
            label="Pay lag (weeks)"
            htmlFor="payLagWeeks"
            hint="Weeks between the end of a pay week and the expected payment date."
          >
            <Input
              id="payLagWeeks"
              name="payLagWeeks"
              type="number"
              min={0}
              max={26}
              defaultValue={company.payLagWeeks}
            />
          </Field>
          <Field label="Max photos per job" htmlFor="maxPhotosPerJob">
            <Input
              id="maxPhotosPerJob"
              name="maxPhotosPerJob"
              type="number"
              min={1}
              max={500}
              defaultValue={company.maxPhotosPerJob}
            />
          </Field>

          <label className="flex items-center gap-3 sm:col-span-2">
            <input
              type="checkbox"
              name="breakPaidByDefault"
              defaultChecked={company.breakPaidByDefault}
              className="size-5 accent-[var(--color-primary)]"
            />
            <span className="text-sm">
              Breaks are paid by default
              <span className="block text-xs text-muted-foreground">
                Unpaid breaks are deducted from pay only — the client is still
                billed for the full onsite span.
              </span>
            </span>
          </label>

          <label className="flex items-center gap-3 sm:col-span-2">
            <input
              type="checkbox"
              name="watermarkEnabled"
              defaultChecked={company.watermarkEnabled}
              className="size-5 accent-[var(--color-primary)]"
            />
            <span className="text-sm">
              Watermark uploaded photos
              <span className="block text-xs text-muted-foreground">
                Bottom-right stamp: YYYY-MM-DD-AssignmentID-Customer-#SiteID
              </span>
            </span>
          </label>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : null}
          Save changes
        </Button>
        {state?.ok ? (
          <span className="flex items-center gap-1 text-sm text-success">
            <Check className="size-4" /> Saved
          </span>
        ) : null}
        {state && !state.ok ? (
          <span className="text-sm text-danger">{state.error}</span>
        ) : null}
      </div>
    </form>
  );
}
