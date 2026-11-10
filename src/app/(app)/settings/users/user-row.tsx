"use client";

import { Check, ChevronDown, Loader2 } from "lucide-react";
import Link from "next/link";
import { useActionState, useState, useSyncExternalStore } from "react";
import { Avatar } from "@/components/profile/parts";
import { ReadOnlyValue } from "@/components/profile/parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { Field, Input } from "@/components/ui/field";
import { PhoneInput } from "@/components/ui/phone-input";
import { StatePicker } from "@/components/ui/state-picker";
import { ROLE_LABEL } from "@/lib/profile-format";
import { US_TIME_ZONES, timeZoneForZip, timeZoneLabel } from "@/lib/us-regions";
import { cn } from "@/lib/utils";
import { updateUser, type ActionResult } from "../actions";
import { PasswordFallback } from "./password-fallback";
import { ResetPassword } from "./reset-password";

// A role is who somebody is, not how things are going, so none of them is
// drawn in the colour of an error. The two that run the company share one.
const ROLE_VARIANT: Record<
  string,
  "neutral" | "primary" | "success" | "warning" | "danger"
> = {
  ADMINISTRATOR: "primary",
  MANAGER: "primary",
  SUPERVISOR: "success",
  ACCOUNTANT: "neutral",
  TECH: "neutral",
  GUEST: "neutral",
};

function subscribeToHash(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

export type UserRowData = {
  /** Their picture, or null for their initials. */
  picture: string | null;
  /** Who approves and pays them, by name, for the closed row. */
  supervisorName: string | null;
  /** When they last signed in, already written out in the viewer's zone. */
  lastLogin: string | null;
  user: {
    id: string;
    name: string;
    nameOverridden: boolean;
    legalName: string | null;
    email: string;
    baseRole: string;
    active: boolean;
    timeZone: string;
    /** Their zone was picked rather than left to follow their ZIP. */
    zoneByHand: boolean;
    phone: string | null;
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    state: string | null;
    postalCode: string | null;
    country: string | null;
    directSupervisorId: string | null;
    signInMethod: string;
    passwordFallback: boolean;
    hasPassword: boolean;
  };
  supervisorOptions: { id: string; name: string }[];
};

/**
 * One account: a line that says who it is, opening onto the form that changes
 * it.
 *
 * Every account used to be the whole form, open, one under another — thirteen
 * hundred pixels each on a phone, so nine people were twelve thousand and
 * finding the tenth meant scrolling past the addresses of the other nine. The
 * line carries what somebody scans this page for: the role, who they report
 * to, when they were last here. The form is still mounted while it is shut, so
 * a row half filled in and closed by mistake has lost nothing.
 */
export function UserRow({
  user,
  picture,
  supervisorName,
  lastLogin,
  supervisorOptions,
}: UserRowData) {
  // A link from elsewhere — "give every tech a supervisor" — can name the
  // account it is about, and lands on it open. Read from the address rather
  // than copied into state: the address is the one that knows, and it is
  // whatever was pressed here afterwards that overrides it.
  const named = useSyncExternalStore(
    subscribeToHash,
    () => window.location.hash === `#user-${user.id}`,
    () => false,
  );
  const [pressed, setPressed] = useState<boolean | null>(null);
  const open = pressed ?? named;

  const [state, formAction, pending] = useActionState<
    ActionResult | null,
    FormData
  >(updateUser, null);

  const [supervisorId, setSupervisorId] = useState(
    user.directSupervisorId ?? "",
  );
  const [region, setRegion] = useState((user.state ?? "").toUpperCase());
  const [zone, setZone] = useState(user.timeZone);

  // Their ZIP knows which clock they are on, and nobody wants to think about
  // it. Only ever offered — a typed zone is left alone, because the ZIP-to-zone
  // table follows county lines it cannot see.
  const [zip, setZip] = useState(user.postalCode ?? "");
  const suggested = timeZoneForZip(zip);
  const zoneMatchesZip = !suggested || suggested === zone;
  // A zone left to follow the ZIP moves with it when saved; there is nothing
  // to offer. Only one picked — before, or here just now — is kept.
  const follows = !user.zoneByHand && zone === user.timeZone;

  // The link that decides who signs off their week. A tech without one cannot
  // be paid, which is worth seeing without opening anything.
  const unsupervised = user.baseRole === "TECH" && !user.directSupervisorId;

  return (
    <Card
      id={`user-${user.id}`}
      data-user-row={user.id}
      className={cn("scroll-mt-4", !user.active && "opacity-70")}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`user-panel-${user.id}`}
        onClick={() => setPressed(!open)}
        className="flex w-full items-center gap-3 rounded-xl p-3 text-left sm:p-4"
      >
        <Avatar src={picture} name={user.name} size={36} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate text-sm font-semibold">{user.name}</span>
            <Badge variant={ROLE_VARIANT[user.baseRole] ?? "neutral"}>
              {ROLE_LABEL[user.baseRole] ?? user.baseRole}
            </Badge>
            {user.signInMethod === "LOCAL" ? (
              <Badge variant="warning">
                {user.hasPassword ? "Outside" : "Invited"}
              </Badge>
            ) : user.passwordFallback ? (
              // Worth seeing from the list rather than by opening each row:
              // which company accounts have a second way in is the question
              // somebody asks when they are checking, not when they are
              // granting.
              <Badge variant="warning">Password too</Badge>
            ) : null}
            {user.active ? null : <Badge variant="neutral">Deactivated</Badge>}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {user.email}
          </span>
          {/* Two facts side by side where there is room and one under the
              other where there is not — never one of them cut short. As a
              single line the date was what a phone dropped: "Last sign-in
              11-09-202…". */}
          <span className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
            <span
              className={cn(
                "min-w-0 [overflow-wrap:anywhere]",
                !supervisorName && unsupervised && "text-warning",
              )}
            >
              {supervisorName
                ? `Reports to ${supervisorName}`
                : "No direct supervisor"}
            </span>
            <span className="whitespace-nowrap">
              {lastLogin ? `Last sign-in ${lastLogin}` : "Never signed in"}
            </span>
          </span>
        </span>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      <div
        id={`user-panel-${user.id}`}
        hidden={!open}
        className={cn("border-t border-border p-3 sm:p-4", !open && "hidden")}
      >
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="userId" value={user.id} />

          <Link
            href={`/people/${user.id}`}
            className="inline-flex min-h-10 items-center self-start text-xs font-medium text-primary hover:underline"
          >
            Open their profile
          </Link>

          {/* Two different questions. An outside account's password is the
              only way into it, so the question is "they have lost it". A
              company account's is a spare key for the day NextCloud cannot be
              reached, so the question is "should this person have one". */}
          {user.signInMethod === "LOCAL" ? (
            <ResetPassword userId={user.id} email={user.email} />
          ) : (
            <PasswordFallback
              userId={user.id}
              granted={user.passwordFallback}
              hasPassword={user.hasPassword}
            />
          )}

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

            {/* The legal name is the direct supervisor's, and anybody else
                changing it is warned and the supervisor told — which happens
                on the profile, so it is changed there and only shown here. */}
            <Field label="Legal name">
              <ReadOnlyValue empty="Not set">{user.legalName}</ReadOnlyValue>
              <Link
                href={`/people/${user.id}`}
                className="text-xs font-medium text-primary hover:underline"
              >
                Change it on their profile
              </Link>
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field
              label="Direct supervisor"
              htmlFor={`sup-${user.id}`}
              hint="Approves and pays this user."
            >
              <Combobox
                id={`sup-${user.id}`}
                name="directSupervisorId"
                value={supervisorId}
                onChange={setSupervisorId}
                options={supervisorOptions.map((option) => ({
                  value: option.id,
                  label: option.name,
                }))}
                placeholder="Search by name…"
                emptyText="Nobody by that name can approve."
              />
            </Field>

            <Field
              label="Time zone"
              htmlFor={`tz-${user.id}`}
              hint={
                zoneMatchesZip || follows
                  ? undefined
                  : "Their ZIP says otherwise — set from the button below, or leave it if you know better."
              }
            >
              <Combobox
                id={`tz-${user.id}`}
                name="timeZone"
                value={zone}
                onChange={setZone}
                options={US_TIME_ZONES.map((entry) => ({
                  value: entry.value,
                  label: entry.label,
                  hint: entry.value,
                  keywords: entry.value,
                }))}
                allowClear={false}
                placeholder="Search zones…"
              />
            </Field>

            <Field label="Phone" htmlFor={`phone-${user.id}`}>
              <PhoneInput
                id={`phone-${user.id}`}
                name="phone"
                defaultValue={user.phone}
              />
            </Field>
          </div>

          {/* Wanted by payroll and by anybody posting something physical.
              Never on the report a customer reads. */}
          <fieldset className="flex flex-col gap-4">
            {/* A heading over the group, and drawn as one. In the small
                capitals of a field's own label it sat directly on top of
                "Street" and read as a second label for the same box. */}
            <legend className="mb-3 text-sm font-semibold">Address</legend>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Street" htmlFor={`addr1-${user.id}`}>
                <Input
                  id={`addr1-${user.id}`}
                  name="addressLine1"
                  defaultValue={user.addressLine1 ?? ""}
                  autoComplete="off"
                />
              </Field>
              <Field label="Apt, suite" htmlFor={`addr2-${user.id}`}>
                <Input
                  id={`addr2-${user.id}`}
                  name="addressLine2"
                  defaultValue={user.addressLine2 ?? ""}
                  autoComplete="off"
                />
              </Field>
            </div>

            {/* State and ZIP are a couple of characters each: side by side
                on a phone rather than a full-width row apiece. */}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Field
                label="City"
                htmlFor={`city-${user.id}`}
                className="col-span-2 sm:col-span-1"
              >
                <Input
                  id={`city-${user.id}`}
                  name="city"
                  defaultValue={user.city ?? ""}
                  autoComplete="off"
                />
              </Field>
              <Field label="State" htmlFor={`state-${user.id}`}>
                <StatePicker
                  id={`state-${user.id}`}
                  name="state"
                  value={region}
                  onChange={setRegion}
                />
              </Field>
              <Field
                label="ZIP"
                htmlFor={`zip-${user.id}`}
                hint={
                  zoneMatchesZip
                    ? undefined
                    : follows
                      ? `Their zone follows the ZIP: saved, it moves to ${timeZoneLabel(suggested)}.`
                      : "This ZIP is on another clock."
                }
              >
                <Input
                  id={`zip-${user.id}`}
                  name="postalCode"
                  value={zip}
                  onChange={(event) => setZip(event.target.value)}
                  inputMode="numeric"
                  autoComplete="off"
                />
              </Field>
              <Field
                label="Country"
                htmlFor={`country-${user.id}`}
                className="col-span-2 sm:col-span-1"
              >
                <Input
                  id={`country-${user.id}`}
                  name="country"
                  defaultValue={user.country ?? ""}
                  autoComplete="off"
                />
              </Field>
            </div>

            {/* Offered rather than applied: the table works off ZIP prefixes
                and the real boundaries follow county lines, so the last word
                belongs to whoever knows the address. */}
            {suggested && !zoneMatchesZip && !follows ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="self-start"
                onClick={() => setZone(suggested)}
              >
                Use the zone for {zip.trim()}
              </Button>
            ) : null}
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
      </div>
    </Card>
  );
}
