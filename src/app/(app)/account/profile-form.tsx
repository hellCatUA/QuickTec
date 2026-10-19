"use client";

import type { PreferredPhone, PrivacyLevel } from "@prisma-client";
import { Check, Loader2, Mail, MapPin, Phone, Route, X } from "lucide-react";
import * as React from "react";
import { useActionState } from "react";
import { ReadOnlyValue } from "@/components/profile/parts";
import { ProfileRow } from "@/components/profile/row";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { NameInput } from "@/components/ui/name-input";
import { PhoneInput } from "@/components/ui/phone-input";
import { StatePicker } from "@/components/ui/state-picker";
import {
  effectivePreferred,
  levelFor,
  PHONE_LABEL,
  whyNotPreferable,
  type PrivacySettings,
  type ProfileField,
} from "@/lib/profile-privacy";
import { stateName, timeZoneForZip, timeZoneLabel, US_TIME_ZONES } from "@/lib/us-regions";
import {
  requestOwnLegalName,
  saveOwnProfile,
  withdrawOwnRequest,
  type ProfileResult,
} from "./actions";

export type OwnProfile = {
  name: string;
  email: string;
  sso: boolean;
  guest: boolean;
  legalName: string | null;
  /** Never set yet, so theirs to give rather than to ask for. */
  legalNameOpen: boolean;
  pendingLegalName: { id: string; value: string; reviewer: string | null } | null;
  role: string;
  supervisor: string | null;
  /** Who answers what they ask: the direct supervisor while they still are one, else null for a manager. */
  reviewer: string | null;
  years: string | null;
  phone: string | null;
  workPhone: string | null;
  voipPhone: string | null;
  preferredPhone: PreferredPhone | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  timeZone: string;
  /** Picked by hand, or simply not what the ZIP says — either way not "from the ZIP". */
  timeZoneManual: boolean;
  primaryRegion: string | null;
  statesOfOperation: string[];
  avatarVisibility: PrivacyLevel;
};

/** The fields that say what they held when the form was opened, as `was.<name>`. */
const OPENED = [
  "name",
  "phone",
  "workPhone",
  "voipPhone",
  "preferredPhone",
  "addressLine1",
  "addressLine2",
  "city",
  "state",
  "postalCode",
  "timeZone",
  "primaryRegion",
  "statesOfOperation",
] as const;

function openedFrom(formData: FormData): Record<(typeof OPENED)[number], string> {
  return Object.fromEntries(
    OPENED.map((key) => [
      key,
      key === "statesOfOperation"
        ? formData.getAll(key).map(String).sort().join(",")
        : String(formData.get(key) ?? ""),
    ]),
  ) as Record<(typeof OPENED)[number], string>;
}

/**
 * The part of somebody's profile that is theirs to keep current, with what is
 * not theirs shown beside it, read-only, so the page is the whole of them.
 *
 * Each line carries who may see it and a way into its history. The levels are
 * worked out here as well as on the server, so choosing the personal phone as
 * the preferred one shows it going Public before anything is saved.
 */
export function ProfileForm({
  profile,
  settings,
}: {
  profile: OwnProfile;
  settings: PrivacySettings;
}) {
  const [phones, setPhones] = React.useState({
    personal: profile.phone,
    work: profile.workPhone,
    voip: profile.voipPhone,
  });
  const [chosen, setChosen] = React.useState<PreferredPhone | null>(profile.preferredPhone);
  const [zip, setZip] = React.useState(profile.postalCode ?? "");
  const [region, setRegion] = React.useState((profile.state ?? "").toUpperCase());
  const [primary, setPrimary] = React.useState(
    (profile.primaryRegion ?? profile.state ?? "").toUpperCase(),
  );
  const [states, setStates] = React.useState<string[]>(profile.statesOfOperation);
  const [adding, setAdding] = React.useState("");

  const preferred = effectivePreferred(chosen, phones);
  const level = (field: ProfileField) =>
    levelFor(field, settings, {
      preferredPhone: preferred,
      phones,
      avatarVisibility: profile.avatarVisibility,
    });

  const zipZone = timeZoneForZip(zip);
  const [zoneChoice, setZoneChoice] = React.useState(
    profile.timeZoneManual ? profile.timeZone : "auto",
  );

  // What each field showed when the page was opened, and after each save what
  // was saved: only a field changed from it is saved, so what a supervisor
  // set while this sat open stays.
  const [opened, setOpened] = React.useState<Record<(typeof OPENED)[number], string>>(() => ({
    name: profile.name,
    phone: profile.phone ?? "",
    workPhone: profile.workPhone ?? "",
    voipPhone: profile.voipPhone ?? "",
    preferredPhone: preferred ?? "",
    addressLine1: profile.addressLine1 ?? "",
    addressLine2: profile.addressLine2 ?? "",
    city: profile.city ?? "",
    state: region,
    postalCode: profile.postalCode ?? "",
    timeZone: zoneChoice,
    primaryRegion: primary,
    statesOfOperation: [...profile.statesOfOperation].sort().join(","),
  }));

  const [state, formAction, pending] = useActionState<ProfileResult | null, FormData>(
    async (previous, formData) => {
      const result = await saveOwnProfile(previous, formData);
      if (result.ok) setOpened(openedFrom(formData));
      return result;
    },
    null,
  );

  // The phones and the ZIP decide what the preferred phone may be and which
  // zone the ZIP is in, so they are read as they are typed.
  function onInput(event: React.FormEvent<HTMLFormElement>) {
    const target = event.target as HTMLInputElement;
    const value = target.value.trim() || null;
    if (target.name === "phone") setPhones((was) => ({ ...was, personal: value }));
    if (target.name === "workPhone") setPhones((was) => ({ ...was, work: value }));
    if (target.name === "voipPhone") setPhones((was) => ({ ...was, voip: value }));
    if (target.name === "postalCode") setZip(target.value);
  }

  return (
    <form
      // Sent by hand rather than as the form's action: React empties a form
      // its action has saved back to the values it was first drawn with, and
      // the controlled boxes here — the preferred phone, the zone, the states —
      // then showed one thing while holding another. A preferred VoIP line
      // read as Work after saving, and the next save made it Work.
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        React.startTransition(() => formAction(formData));
      }}
      onInput={onInput}
      className="flex flex-col gap-4"
    >
        {OPENED.map((key) => (
          <input key={key} type="hidden" name={`was.${key}`} value={opened[key]} />
        ))}
        <Card>
          <CardHeader>
            <CardTitle>Name &amp; role</CardTitle>
          </CardHeader>
          <ProfileRow
            label="Preferred name"
            htmlFor="own-name"
            source={profile.sso ? "NextCloud" : null}
            level={level("name")}
            field="name"
            hint="What clients and the team call you. First and last name."
          >
            <NameInput id="own-name" name="name" defaultValue={profile.name} required />
          </ProfileRow>
          <ProfileRow
            label="Legal name"
            htmlFor={profile.legalNameOpen ? "own-legal" : undefined}
            level={level("legalName")}
            field="legalName"
          >
            <LegalName profile={profile} />
          </ProfileRow>
          <ProfileRow label="Role" source={profile.sso ? "NextCloud groups" : null} level={level("role")} field="role">
            <ReadOnlyValue>{profile.role}</ReadOnlyValue>
          </ProfileRow>
          {/* A guest is nobody's employee: no supervisor to name, no service
              to count. */}
          {profile.guest ? null : (
            <>
              <ProfileRow label="Direct supervisor" level={level("directSupervisor")} field="directSupervisor">
                <ReadOnlyValue empty="Not set — payroll needs one">{profile.supervisor}</ReadOnlyValue>
              </ProfileRow>
              <ProfileRow
                label="Years of service"
                level={level("yearsOfService")}
                field="yearsOfService"
                hint="Set by your direct supervisor."
              >
                <ReadOnlyValue empty="Not set yet">{profile.years}</ReadOnlyValue>
              </ProfileRow>
            </>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Phone className="size-4 text-muted-foreground" /> Phone
            </CardTitle>
          </CardHeader>
          <ProfileRow
            label="Preferred"
            htmlFor="own-preferred"
            note="The one clients call"
            level={level("preferredPhone")}
            field="preferredPhone"
            hint={
              preferred === "VOIP"
                ? "Clients get only your VoIP line, marked as VoIP."
                : preferred
                  ? `Clients get your ${PHONE_LABEL[preferred].toLowerCase()} phone${phones.voip ? ", and your VoIP line beside it" : ""}.`
                  : phones.personal
                    ? "Clients get no phone until you choose one. Your personal phone goes to them only if you pick it."
                    : "Add a phone below to choose one."
            }
            highlight
          >
            <Select
              id="own-preferred"
              name="preferredPhone"
              value={preferred ?? ""}
              onChange={(event) => setChosen((event.target.value || null) as PreferredPhone | null)}
            >
              {preferred ? null : <option value="">None chosen</option>}
              {(["PERSONAL", "WORK", "VOIP"] as PreferredPhone[]).map((kind) => {
                const why = whyNotPreferable(kind, phones);
                return (
                  <option key={kind} value={kind} disabled={Boolean(why)}>
                    {PHONE_LABEL[kind]}
                    {why ? ` — ${why.toLowerCase()}` : ""}
                  </option>
                );
              })}
            </Select>
          </ProfileRow>
          <ProfileRow
            label="Personal"
            htmlFor="own-phone"
            source={profile.sso ? "NextCloud" : null}
            level={level("personalPhone")}
            field="personalPhone"
            hint={
              settings.personalPhone.allowChoice
                ? "Restricted, unless it is your preferred phone."
                : undefined
            }
          >
            <PhoneInput id="own-phone" name="phone" defaultValue={profile.phone} />
          </ProfileRow>
          <ProfileRow
            label="Work"
            htmlFor="own-work"
            level={level("workPhone")}
            field="workPhone"
            hint="A company phone, if you have one."
          >
            <PhoneInput id="own-work" name="workPhone" defaultValue={profile.workPhone} />
          </ProfileRow>
          <ProfileRow
            label="VoIP"
            htmlFor="own-voip"
            level={level("voipPhone")}
            field="voipPhone"
            hint="If you have one."
          >
            <PhoneInput id="own-voip" name="voipPhone" defaultValue={profile.voipPhone} />
          </ProfileRow>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="size-4 text-muted-foreground" /> Email
            </CardTitle>
          </CardHeader>
          <ProfileRow
            label="Work"
            source={profile.sso ? "NextCloud sign-in" : null}
            level={level("email")}
            field="email"
            hint={
              profile.sso
                ? "Your one email here: you sign in with it, and clients get it. Changed in NextCloud."
                : "Your one email here: you sign in with it, and clients get it. An administrator changes it."
            }
          >
            <ReadOnlyValue>{profile.email}</ReadOnlyValue>
          </ProfileRow>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MapPin className="size-4 text-muted-foreground" /> Home address
            </CardTitle>
          </CardHeader>
          <ProfileRow
            label="Street"
            htmlFor="own-street"
            source={profile.sso ? "NextCloud" : null}
            level={level("street")}
            field="street"
          >
            <div className="flex flex-col gap-2">
              <Input
                id="own-street"
                name="addressLine1"
                defaultValue={profile.addressLine1 ?? ""}
                autoComplete="address-line1"
              />
              <Input
                name="addressLine2"
                aria-label="Apartment, suite"
                placeholder="Apt, suite (optional)"
                defaultValue={profile.addressLine2 ?? ""}
                autoComplete="address-line2"
              />
            </div>
          </ProfileRow>
          <ProfileRow
            label="Home region"
            note="City, state, ZIP"
            htmlFor="own-city"
            level={level("city")}
            field="homeRegion"
            hint={
              level("city") === "PUBLIC"
                ? "Everybody else sees these three — never the street."
                : undefined
            }
          >
            {/* By the width the value has, like the line around it: the city
                on a line of its own with the state and ZIP side by side
                under it, and all three on one line where there is room. */}
            <div className="grid gap-2 @2xs:grid-cols-[minmax(0,1fr)_7rem] @lg:grid-cols-[minmax(0,1fr)_9rem_7rem]">
              <Input
                id="own-city"
                name="city"
                aria-label="City"
                className="@2xs:col-span-2 @lg:col-span-1"
                defaultValue={profile.city ?? ""}
                autoComplete="address-level2"
              />
              <StatePicker
                id="own-state"
                name="state"
                value={region}
                onChange={(next) => {
                  setRegion(next);
                  // The primary region starts as the home state, and follows
                  // it until somebody makes it something else.
                  if (!primary || primary === region) setPrimary(next);
                }}
              />
              <Input
                name="postalCode"
                aria-label="ZIP"
                inputMode="numeric"
                defaultValue={profile.postalCode ?? ""}
                autoComplete="postal-code"
              />
            </div>
          </ProfileRow>
          <ProfileRow
            label="Time zone"
            htmlFor="own-zone"
            note={zoneChoice === "auto" ? "From your ZIP" : "Picked by you"}
            level={level("timeZone")}
            field="timeZone"
            hint="Your times, reminders and pay weeks are shown in it."
          >
            <Select
              id="own-zone"
              name="timeZone"
              value={zoneChoice}
              onChange={(event) => setZoneChoice(event.target.value)}
            >
              <option value="auto">
                From my ZIP{zipZone ? ` — ${timeZoneLabel(zipZone)}` : profile.timeZoneManual ? "" : ` — ${timeZoneLabel(profile.timeZone)}`}
              </option>
              {US_TIME_ZONES.map((zone) => (
                <option key={zone.value} value={zone.value}>
                  {zone.label}
                </option>
              ))}
            </Select>
          </ProfileRow>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Route className="size-4 text-muted-foreground" /> Where you work
            </CardTitle>
          </CardHeader>
          <ProfileRow
            label="Primary region"
            htmlFor="own-primary"
            level={level("primaryRegion")}
            field="primaryRegion"
            hint="Starts as your home state."
          >
            <StatePicker id="own-primary" name="primaryRegion" value={primary} onChange={setPrimary} />
          </ProfileRow>
          <ProfileRow
            label="States of operation"
            note="Where you take jobs"
            htmlFor="own-states"
            level={level("statesOfOperation")}
            field="statesOfOperation"
          >
            <div className="flex flex-col gap-2">
              {states.length > 0 ? (
                <ul className="flex flex-wrap gap-1.5" aria-label="States of operation">
                  {states.map((code) => (
                    <li
                      key={code}
                      className="inline-flex h-10 items-center gap-1 rounded-md border border-border bg-input pl-2.5 pr-1 text-sm sm:h-8"
                    >
                      {stateName(code) ?? code}
                      <input type="hidden" name="statesOfOperation" value={code} />
                      <button
                        type="button"
                        aria-label={`Remove ${stateName(code) ?? code}`}
                        onClick={() => setStates((was) => was.filter((entry) => entry !== code))}
                        className="flex size-8 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground sm:size-6"
                      >
                        <X className="size-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              <StatePicker
                id="own-states"
                value={adding}
                onChange={(next) => {
                  if (next && !states.includes(next)) setStates((was) => [...was, next]);
                  setAdding("");
                }}
              />
            </div>
          </ProfileRow>
        </Card>

        <div className="sticky bottom-[calc(env(safe-area-inset-bottom)+3.5rem)] z-10 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface-raised p-3 shadow-lg md:bottom-4">
          <Button type="submit" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : null}
            Save changes
          </Button>
          {state?.ok ? (
            <span role="status" className="flex items-center gap-1 text-sm text-success">
              <Check className="size-4" /> {state.message ?? "Saved."}
            </span>
          ) : state && !state.ok ? (
            <span role="alert" className="text-sm text-danger">
              {state.error}
            </span>
          ) : null}
        </div>
    </form>
  );
}

/**
 * The legal name: given once, at onboarding, which until there is one means
 * "while there is none"; asked for after that.
 */
function LegalName({ profile }: { profile: OwnProfile }) {
  const [asking, setAsking] = React.useState(false);
  const [result, setResult] = React.useState<ProfileResult | null>(null);
  const [busy, startTransition] = React.useTransition();

  if (profile.legalNameOpen) {
    return (
      <div className="flex flex-col gap-1.5">
        <NameInput id="own-legal" name="legalName" defaultValue="" placeholder="As on your ID" />
        <p className="text-xs text-muted-foreground">
          For payroll and anything you sign. You set it once; after that a change is asked for
          {` — ${profile.reviewer ?? "a manager"} answers`}.
        </p>
      </div>
    );
  }

  const pendingRequest = profile.pendingLegalName;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <ReadOnlyValue className="min-w-48 flex-1" empty="Not set">
          {profile.legalName}
        </ReadOnlyValue>
        {!asking && !pendingRequest ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => setAsking(true)}>
            Request a change
          </Button>
        ) : null}
      </div>

      {pendingRequest ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">
          <span className="min-w-0 flex-1">
            Asked for <b>{pendingRequest.value}</b> — waiting on{" "}
            {pendingRequest.reviewer ?? "a manager"}.
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() =>
              startTransition(async () => {
                setResult(await withdrawOwnRequest(pendingRequest.id));
              })
            }
          >
            Withdraw
          </Button>
        </div>
      ) : null}

      {asking ? (
        <LegalAsk
          reviewer={profile.reviewer}
          busy={busy}
          onCancel={() => setAsking(false)}
          onSend={(value) =>
            startTransition(async () => {
              const formData = new FormData();
              formData.set("legalName", value);
              const answer = await requestOwnLegalName(null, formData);
              setResult(answer);
              if (answer.ok) setAsking(false);
            })
          }
        />
      ) : null}

      {result ? (
        <p role={result.ok ? "status" : "alert"} className={result.ok ? "text-xs text-success" : "text-xs text-danger"}>
          {result.ok ? result.message : result.error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The new legal name, sent on its own rather than with the page's save. It
 * sits inside the profile form, and a form cannot hold another, so it has no
 * name to submit under and Enter sends it rather than saving the page.
 */
function LegalAsk({
  reviewer,
  busy,
  onSend,
  onCancel,
}: {
  reviewer: string | null;
  busy: boolean;
  onSend: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = React.useState("");
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <label htmlFor="own-legal-new" className="text-xs font-medium text-muted-foreground">
        The legal name you want, as on your ID
      </label>
      <div className="flex flex-wrap gap-2">
        <span
          className="min-w-48 flex-1"
          onInput={(event) => setValue((event.target as HTMLInputElement).value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            onSend(value);
          }}
        >
          <NameInput id="own-legal-new" placeholder="First Middle Last" />
        </span>
        <Button type="button" size="sm" disabled={busy} onClick={() => onSend(value)}>
          {busy ? <Loader2 className="animate-spin" /> : null}
          {reviewer ? "Send to your supervisor" : "Send to a manager"}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
