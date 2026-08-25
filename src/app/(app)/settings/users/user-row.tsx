"use client";

import { Check, Loader2 } from "lucide-react";
import { useActionState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { updateUser, type ActionResult } from "../actions";
import { ResetPassword } from "./reset-password";

const TIME_ZONES = [
  "America/Los_Angeles",
  "America/Phoenix",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "UTC",
];

const ROLE_VARIANT: Record<
  string,
  "neutral" | "primary" | "success" | "warning" | "danger"
> = {
  ADMINISTRATOR: "danger",
  MANAGER: "primary",
  SUPERVISOR: "success",
  ACCOUNTANT: "warning",
  TECH: "neutral",
};

export function UserRow({
  user,
  supervisorOptions,
}: {
  user: {
    id: string;
    name: string;
    nameOverridden: boolean;
    legalName: string | null;
    email: string;
    baseRole: string;
    active: boolean;
    timeZone: string;
    phone: string | null;
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    state: string | null;
    postalCode: string | null;
    country: string | null;
    directSupervisorId: string | null;
    lastLoginAt: string | null;
    signInMethod: string;
    hasPassword: boolean;
  };
  supervisorOptions: { id: string; name: string }[];
}) {
  const [state, formAction, pending] = useActionState<
    ActionResult | null,
    FormData
  >(updateUser, null);

  return (
    <Card>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="userId" value={user.id} />

          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{user.name}</div>
              <div className="truncate text-xs text-muted-foreground">
                {user.email}
              </div>
            </div>
            {user.signInMethod === "LOCAL" ? (
              <Badge variant="warning">
                {user.hasPassword ? "Outside" : "Invited"}
              </Badge>
            ) : null}
            <Badge
              variant={ROLE_VARIANT[user.baseRole] ?? "neutral"}
              className="ml-auto"
            >
              {user.baseRole}
            </Badge>
          </div>

          {/* Only for accounts whose password this app actually holds. A
              NextCloud one is answered in NextCloud. */}
          {user.signInMethod === "LOCAL" ? (
            <ResetPassword userId={user.id} email={user.email} />
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Display name"
              htmlFor={`name-${user.id}`}
              hint={
                user.signInMethod === "LOCAL"
                  ? "What the app calls them."
                  : user.nameOverridden
                    ? "Set here, so NextCloud no longer changes it. Clear the box to hand it back."
                    : "Comes from NextCloud. Typing here takes it over."
              }
            >
              <Input
                id={`name-${user.id}`}
                name="name"
                defaultValue={user.name}
                autoComplete="off"
              />
            </Field>

            <Field
              label="Legal name"
              htmlFor={`legal-${user.id}`}
              hint="For payroll and anything with a signature line. Blank means the display name is it."
            >
              <Input
                id={`legal-${user.id}`}
                name="legalName"
                defaultValue={user.legalName ?? ""}
                autoComplete="off"
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field
              label="Direct supervisor"
              htmlFor={`sup-${user.id}`}
              hint="Approves and pays this user."
            >
              <Select
                id={`sup-${user.id}`}
                name="directSupervisorId"
                defaultValue={user.directSupervisorId ?? ""}
              >
                <option value="">— none —</option>
                {supervisorOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Time zone" htmlFor={`tz-${user.id}`}>
              <Select
                id={`tz-${user.id}`}
                name="timeZone"
                defaultValue={user.timeZone}
              >
                {TIME_ZONES.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Phone" htmlFor={`phone-${user.id}`}>
              <Input
                id={`phone-${user.id}`}
                name="phone"
                type="tel"
                defaultValue={user.phone ?? ""}
              />
            </Field>
          </div>

          {/* Wanted by payroll and by anybody posting something physical.
              Never on the report a customer reads. */}
          <fieldset className="flex flex-col gap-4">
            <legend className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Address
            </legend>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Address line 1" htmlFor={`addr1-${user.id}`}>
                <Input
                  id={`addr1-${user.id}`}
                  name="addressLine1"
                  defaultValue={user.addressLine1 ?? ""}
                  autoComplete="off"
                />
              </Field>
              <Field label="Address line 2" htmlFor={`addr2-${user.id}`}>
                <Input
                  id={`addr2-${user.id}`}
                  name="addressLine2"
                  defaultValue={user.addressLine2 ?? ""}
                  autoComplete="off"
                />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-4">
              <Field label="City" htmlFor={`city-${user.id}`}>
                <Input
                  id={`city-${user.id}`}
                  name="city"
                  defaultValue={user.city ?? ""}
                  autoComplete="off"
                />
              </Field>
              <Field label="State" htmlFor={`state-${user.id}`}>
                <Input
                  id={`state-${user.id}`}
                  name="state"
                  defaultValue={user.state ?? ""}
                  autoComplete="off"
                />
              </Field>
              <Field label="ZIP" htmlFor={`zip-${user.id}`}>
                <Input
                  id={`zip-${user.id}`}
                  name="postalCode"
                  defaultValue={user.postalCode ?? ""}
                  autoComplete="off"
                />
              </Field>
              <Field label="Country" htmlFor={`country-${user.id}`}>
                <Input
                  id={`country-${user.id}`}
                  name="country"
                  defaultValue={user.country ?? ""}
                  autoComplete="off"
                />
              </Field>
            </div>
          </fieldset>

          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="active"
                defaultChecked={user.active}
                className="size-5 accent-[var(--color-primary)]"
              />
              Active
            </label>

            <span className="text-xs text-muted-foreground">
              {user.lastLoginAt
                ? `Last sign-in ${new Date(user.lastLoginAt).toLocaleString("en-US")}`
                : "Never signed in"}
            </span>

            <div className="ml-auto flex items-center gap-2">
              {state?.ok ? (
                <span className="flex items-center gap-1 text-xs text-success">
                  <Check className="size-3.5" /> Saved
                </span>
              ) : null}
              {state && !state.ok ? (
                <span className="text-xs text-danger">{state.error}</span>
              ) : null}
              <Button type="submit" size="sm" variant="secondary" disabled={pending}>
                {pending ? <Loader2 className="animate-spin" /> : null}
                Save
              </Button>
            </div>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
