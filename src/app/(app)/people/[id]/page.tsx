import type { PrivacyLevel } from "@prisma-client";
import { Lock, Mail, Phone, ShieldCheck } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { ProfileHistory } from "@/components/profile/history";
import { Avatar, LevelBadge } from "@/components/profile/parts";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { avatarSrc, requestedAvatarSrc } from "@/lib/avatar";
import { usTimeInZone } from "@/lib/datetime";
import { db } from "@/lib/db";
import { formatRate } from "@/lib/money";
import { isGuest } from "@/lib/permissions";
import { telHref } from "@/lib/phone";
import {
  audienceFor,
  contactPhones,
  levelsFor,
  loadPrivacySettings,
  loadProfile,
  mayEditProfileOf,
  notTheirEmployee,
  seesHistory,
  seesPayOf,
  shows,
} from "@/lib/profile";
import {
  homeRegion,
  isoDate,
  monthYear,
  phoneText,
  ROLE_LABEL,
  stateText,
  statesText,
  streetText,
} from "@/lib/profile-format";
import { profileHistory } from "@/lib/profile-history";
import {
  isProfileField,
  PHONE_LABEL,
  PROFILE_FIELDS,
  yearsLabel,
  type ProfileField,
} from "@/lib/profile-privacy";
import { getSessionUser } from "@/lib/session";
import { timeZoneLabel } from "@/lib/us-regions";
import { cn } from "@/lib/utils";
import { ManagerPanel } from "./manager-panel";

export const metadata = { title: "Profile" };

/**
 * Somebody's profile, as the person looking may see it.
 *
 * Every line is asked the same question — may this viewer see it? — and a line
 * they may not is left out rather than blanked, with one sentence at the end
 * saying what there is that they cannot see. Their supervisor and managers see
 * all of it, the history, and whatever the person is waiting on them for.
 */
export default async function PersonPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ history?: string }>;
}) {
  const viewer = await getSessionUser();
  if (!viewer) redirect("/signin");
  if (isGuest(viewer)) notFound();

  const { id } = await params;
  if (id === viewer.id) redirect("/account");

  const profile = await loadProfile(id);
  if (!profile) notFound();

  const [settings, audience, payVisible] = await Promise.all([
    loadPrivacySettings(),
    audienceFor(viewer, profile),
    seesPayOf(viewer, profile.id),
  ]);
  const levels = levelsFor(profile, settings);
  // The pay rate answers to the permission matrix as well as to its level:
  // somebody "View pay rates" was taken from does not read it here instead.
  const show = (field: ProfileField) =>
    shows(levels, audience, field) && (field !== "defaultPayRate" || payVisible);

  const editable = mayEditProfileOf(viewer, profile);
  const history = seesHistory(audience);
  const { history: historyParam } = await searchParams;
  const historyField = isProfileField(historyParam) ? historyParam : null;

  const [requests, entries] = await Promise.all([
    editable
      ? db.profileRequest.findMany({
          where: { userId: profile.id, status: "PENDING" },
          orderBy: { createdAt: "asc" },
          select: { id: true, field: true, value: true, createdAt: true },
        })
      : [],
    history ? profileHistory(profile.id, historyField) : [],
  ]);

  const years = show("yearsOfService") ? yearsLabel(profile.serviceStartDate) : null;
  const place = homeRegion({
    city: show("city") ? profile.city : null,
    state: show("state") ? profile.state : null,
    zip: show("zip") ? profile.postalCode : null,
  });
  const phones = contactPhones(profile, levels, audience);
  const picture = show("picture") ? avatarSrc(profile.id, profile.avatarPath) : null;
  const directSupervisor = profile.directSupervisorId === viewer.id;

  // Shown by their level like every other line: the company may open any of
  // them up, and a Federated street is then shown to everybody signed in.
  const personal = (["legalName", "street", "personalPhone", "defaultPayRate"] as ProfileField[]).filter(
    (field) =>
      show(field) &&
      // The personal phone may already be up in Contact, as the preferred one.
      (field !== "personalPhone" ||
        (Boolean(profile.phone) && !phones.some((phone) => phone.kind === "PERSONAL"))),
  );

  const hidden = (Object.keys(PROFILE_FIELDS) as ProfileField[]).filter(
    (field) =>
      !show(field) &&
      // Only what there is to hide: an empty street is not a secret.
      hasValue(profile, field),
  );

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <PageHeader title={profile.name} backHref="/people" />
      {/* A line of its own rather than beside the name, which it squeezed
          onto two lines on a phone. */}
      {directSupervisor ? (
        <Badge variant="primary" className="-mt-2 self-start">
          <ShieldCheck className="size-3.5" /> You are their direct supervisor
        </Badge>
      ) : null}

      {!profile.active ? (
        <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
          This account is deactivated.
        </p>
      ) : null}

      <div className="grid items-start gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <Card>
          <CardContent className="flex flex-col items-center gap-3 text-center">
            <Avatar src={picture} name={profile.name} size={128} />
            <div>
              <h2 className="text-lg font-semibold">{profile.name}</h2>
              <p className="text-sm text-muted-foreground">
                {[show("role") ? (ROLE_LABEL[profile.baseRole] ?? profile.baseRole) : null, years ? `${years} with the company` : null]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            {place || show("timeZone") ? (
              <ul className="flex flex-col gap-1 text-sm text-foreground/80">
                {place ? <li>{place}</li> : null}
                {show("timeZone") ? (
                  <li className="text-muted-foreground">
                    {usTimeInZone(new Date(), profile.timeZone)} there ·{" "}
                    {timeZoneLabel(profile.timeZone)}
                  </li>
                ) : null}
              </ul>
            ) : null}
            <div className="grid w-full grid-cols-2 gap-2">
              {phones[0] ? (
                <a href={telHref(phones[0].number)} className={buttonVariants({ size: "sm" })}>
                  <Phone /> Call
                </a>
              ) : null}
              {show("email") ? (
                <a
                  href={`mailto:${profile.email}`}
                  className={cn(buttonVariants({ size: "sm", variant: "secondary" }), !phones[0] && "col-span-2")}
                >
                  <Mail /> Email
                </a>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Contact</CardTitle>
            </CardHeader>
            <dl>
              {phones.map((phone) => (
                <Line
                  key={phone.kind}
                  label={phone.preferred ? "Preferred phone" : phone.kind === "VOIP" ? "VoIP" : "Phone"}
                  level={levels[phone.kind === "VOIP" ? "voipPhone" : phone.kind === "WORK" ? "workPhone" : "personalPhone"]}
                >
                  <a href={telHref(phone.number)} className="hover:underline">
                    {phoneText(phone.number)}
                  </a>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {phone.preferred
                      ? `${PHONE_LABEL[phone.kind]} · the one clients get`
                      : phone.kind === "VOIP"
                        ? null
                        : PHONE_LABEL[phone.kind]}
                  </span>
                </Line>
              ))}
              {show("workPhone") && profile.workPhone && !phones.some((phone) => phone.kind === "WORK") ? (
                <Line label="Work phone" level={levels.workPhone}>
                  {phoneText(profile.workPhone)}
                </Line>
              ) : null}
              {show("email") ? (
                <Line label="Email" level={levels.email}>
                  <a href={`mailto:${profile.email}`} className="hover:underline">
                    {profile.email}
                  </a>
                </Line>
              ) : null}
              {place ? (
                <Line label="Home region" level={levels.city}>
                  {place}
                </Line>
              ) : null}
            </dl>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>With the company</CardTitle>
            </CardHeader>
            <dl>
              {show("role") ? (
                <Line label="Role" level={levels.role}>
                  {ROLE_LABEL[profile.baseRole] ?? profile.baseRole}
                </Line>
              ) : null}
              {show("directSupervisor") ? (
                <Line label="Direct supervisor" level={levels.directSupervisor}>
                  {profile.directSupervisor?.name ?? <span className="text-muted-foreground">Not set</span>}
                </Line>
              ) : null}
              {show("yearsOfService") ? (
                <Line label="Years of service" level={levels.yearsOfService}>
                  {years ?? <span className="text-muted-foreground">Not set</span>}
                  {profile.serviceStartDate ? (
                    <span className="ml-2 text-xs text-muted-foreground">
                      since {monthYear(profile.serviceStartDate)}
                    </span>
                  ) : null}
                </Line>
              ) : null}
              {show("primaryRegion") ? (
                <Line label="Primary region" level={levels.primaryRegion}>
                  {/* The home state stands in only for somebody who may see it. */}
                  {stateText(profile.primaryRegion ?? (show("state") ? profile.state : null)) ?? (
                    <span className="text-muted-foreground">Not set</span>
                  )}
                </Line>
              ) : null}
              {show("statesOfOperation") ? (
                <Line label="States of operation" level={levels.statesOfOperation}>
                  {statesText(profile.statesOfOperation) ?? <span className="text-muted-foreground">None listed</span>}
                </Line>
              ) : null}
            </dl>
          </Card>

          {personal.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Lock className="size-4 text-muted-foreground" /> Personal details
                </CardTitle>
              </CardHeader>
              <dl>
                {show("legalName") ? (
                  <Line label="Legal name" level={levels.legalName}>
                    {profile.legalName ?? <span className="text-muted-foreground">Not set</span>}
                  </Line>
                ) : null}
                {show("street") ? (
                  <Line label="Street address" level={levels.street}>
                    {streetText(profile.addressLine1, profile.addressLine2) ?? (
                      <span className="text-muted-foreground">Not on file</span>
                    )}
                  </Line>
                ) : null}
                {show("personalPhone") && profile.phone && !phones.some((phone) => phone.kind === "PERSONAL") ? (
                  <Line label="Personal phone" level={levels.personalPhone}>
                    <a href={telHref(profile.phone)} className="hover:underline">
                      {phoneText(profile.phone)}
                    </a>
                  </Line>
                ) : null}
                {show("defaultPayRate") ? (
                  <Line label="Default pay rate" level={levels.defaultPayRate}>
                    {profile.defaultPayType && profile.defaultPayRate ? (
                      formatRate(
                        profile.defaultPayType as Parameters<typeof formatRate>[0],
                        profile.defaultPayRate.toString(),
                      )
                    ) : (
                      <span className="text-muted-foreground">Not set</span>
                    )}
                  </Line>
                ) : null}
              </dl>
            </Card>
          ) : null}

          {hidden.length > 0 ? (
            <p className="flex items-start gap-2 rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
              <Lock className="mt-0.5 size-4 shrink-0" />
              <span>
                Not shown to you:{" "}
                {hidden.map((field) => PROFILE_FIELDS[field].label.toLowerCase()).join(", ")}.
                Only {profile.name}, their direct supervisor and their managers see them.
              </span>
            </p>
          ) : null}

          {editable ? (
            <ManagerPanel
              subject={{
                id: profile.id,
                name: profile.name,
                legalName: profile.legalName,
                serviceStartDate: isoDate(profile.serviceStartDate),
                workPhone: profile.workPhone,
                voipPhone: profile.voipPhone,
                primaryRegion: profile.primaryRegion,
                statesOfOperation: profile.statesOfOperation,
                hasPicture: Boolean(profile.avatarPath),
              }}
              directSupervisor={profile.directSupervisor?.name ?? null}
              notTheirEmployee={notTheirEmployee(viewer, profile)}
              requests={requests.map((request) => ({
                id: request.id,
                field: request.field,
                value: request.value,
                at: request.createdAt.toISOString(),
                pictureSrc:
                  request.field === "PICTURE" ? requestedAvatarSrc(profile.id, request.id) : null,
              }))}
              currentPicture={avatarSrc(profile.id, profile.avatarPath)}
              levels={{
                legalName: levels.legalName,
                yearsOfService: levels.yearsOfService,
                workPhone: levels.workPhone,
                voipPhone: levels.voipPhone,
                primaryRegion: levels.primaryRegion,
                statesOfOperation: levels.statesOfOperation,
                picture: levels.picture,
              }}
            />
          ) : null}

          {history ? (
            <ProfileHistory
              entries={entries}
              field={historyField}
              all={historyParam === "all"}
              timeZone={viewer.timeZone}
              basePath={`/people/${profile.id}`}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Line({
  label,
  level,
  children,
}: {
  label: string;
  level: PrivacyLevel;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1 border-t border-border px-4 py-3 text-sm first:border-t-0 sm:grid-cols-[10rem_minmax(0,1fr)_auto] sm:items-center sm:gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
      <LevelBadge level={level} iconOnly className="hidden sm:inline-flex" />
    </div>
  );
}

function hasValue(
  profile: NonNullable<Awaited<ReturnType<typeof loadProfile>>>,
  field: ProfileField,
): boolean {
  switch (field) {
    case "picture":
      return Boolean(profile.avatarPath);
    case "legalName":
      return Boolean(profile.legalName);
    case "personalPhone":
      return Boolean(profile.phone);
    case "workPhone":
      return Boolean(profile.workPhone);
    case "voipPhone":
      return Boolean(profile.voipPhone);
    case "preferredPhone":
      return Boolean(profile.phone || profile.workPhone || profile.voipPhone);
    case "street":
      return Boolean(profile.addressLine1);
    case "city":
      return Boolean(profile.city);
    case "state":
      return Boolean(profile.state);
    case "zip":
      return Boolean(profile.postalCode);
    case "yearsOfService":
      return Boolean(profile.serviceStartDate);
    case "defaultPayRate":
      return Boolean(profile.defaultPayType);
    case "statesOfOperation":
      return profile.statesOfOperation.length > 0;
    case "primaryRegion":
      return Boolean(profile.primaryRegion ?? profile.state);
    default:
      return true;
  }
}
