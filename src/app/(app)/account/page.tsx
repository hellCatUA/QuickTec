import { BriefcaseBusiness, Clock, DollarSign, LogOut, MapPin } from "lucide-react";
import { redirect } from "next/navigation";
import { signOut } from "@/auth";
import { ProfileHistory } from "@/components/profile/history";
import { EditableKey, LevelBadge, LevelsLegend, ReadOnlyValue } from "@/components/profile/parts";
import { ThemeToggle } from "@/components/theme";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { avatarSrc, requestedAvatarSrc } from "@/lib/avatar";
import { db } from "@/lib/db";
import { formatRate } from "@/lib/money";
import { levelsFor, loadPrivacySettings, loadProfile } from "@/lib/profile";
import { homeRegion, monthYear, ROLE_LABEL } from "@/lib/profile-format";
import { profileHistory } from "@/lib/profile-history";
import { isProfileField, yearsLabel } from "@/lib/profile-privacy";
import { getSessionUser } from "@/lib/session";
import { timeZoneForZip, timeZoneLabel } from "@/lib/us-regions";
import { PictureCard } from "./picture-card";
import { ProfileForm } from "./profile-form";

export const metadata = { title: "Your profile" };

/**
 * Everything that belongs to the person rather than the company.
 *
 * Their profile, with who may see each line of it; then the theme and the way
 * out. The theme lives here rather than in the header: it is set once and then
 * never again, so a permanent control on every screen was three taps of dead
 * space on a phone.
 */
export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ history?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/signin");

  const { history } = await searchParams;
  const historyField = isProfileField(history) ? history : null;

  const [profile, settings, requests, entries] = await Promise.all([
    loadProfile(user.id),
    loadPrivacySettings(),
    db.profileRequest.findMany({
      where: { userId: user.id, status: "PENDING" },
      select: { id: true, field: true, value: true },
    }),
    profileHistory(user.id, historyField),
  ]);
  if (!profile) redirect("/signin");

  const levels = levelsFor(profile, settings);
  const pendingPicture = requests.find((request) => request.field === "PICTURE") ?? null;
  const pendingLegal = requests.find((request) => request.field === "LEGAL_NAME") ?? null;
  const reviewer = profile.directSupervisor?.name ?? null;

  const years = yearsLabel(profile.serviceStartDate);
  const since = monthYear(profile.serviceStartDate);
  // "From the ZIP" only when it still is: a zone somebody set on the users
  // page before profiles existed is a choice, even though nobody flagged it.
  const zipZone = timeZoneForZip(profile.postalCode);
  const zoneManual = profile.timeZoneManual || (zipZone !== null && zipZone !== profile.timeZone);
  const place = homeRegion({ city: profile.city, state: profile.state, zip: profile.postalCode });

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <PageHeader
        title="Your profile"
        description="What NextCloud already knows comes from there. The icon on every line says who sees it — the company sets that; your picture is the one you choose."
      />
      <EditableKey />

      <div className="grid items-start gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <aside className="flex flex-col gap-4">
          <Card>
            <CardContent>
              <PictureCard
                name={profile.name}
                src={avatarSrc(profile.id, profile.avatarPath)}
                level={levels.picture}
                baseLevel={settings.picture.level}
                allowPublic={settings.picture.allowPublic}
                pending={
                  pendingPicture
                    ? { id: pendingPicture.id, src: requestedAvatarSrc(profile.id, pendingPicture.id) }
                    : null
                }
                reviewer={reviewer}
              >
                <div>
                  <div className="text-lg font-semibold">{profile.name}</div>
                  <div className="text-sm text-muted-foreground">
                    {ROLE_LABEL[profile.baseRole] ?? profile.baseRole}
                    {reviewer ? ` · reports to ${reviewer}` : ""}
                  </div>
                </div>
                <ul className="flex flex-col items-center gap-1 text-sm text-foreground/80">
                  {place ? (
                    <li className="flex items-center gap-1.5">
                      <MapPin className="size-3.5 text-muted-foreground" /> {place}
                    </li>
                  ) : null}
                  <li className="flex items-center gap-1.5">
                    <Clock className="size-3.5 text-muted-foreground" /> {timeZoneLabel(profile.timeZone)}
                  </li>
                  {years ? (
                    <li className="flex items-center gap-1.5">
                      <BriefcaseBusiness className="size-3.5 text-muted-foreground" /> {years} with
                      the company
                    </li>
                  ) : null}
                </ul>
              </PictureCard>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Who sees what</CardTitle>
            </CardHeader>
            <CardContent>
              <LevelsLegend />
            </CardContent>
          </Card>
        </aside>

        <div className="flex min-w-0 flex-col gap-4">
          <ProfileForm
            settings={settings}
            profile={{
              name: profile.name,
              email: profile.email,
              sso: profile.signInMethod === "SSO",
              legalName: profile.legalName,
              pendingLegalName:
                pendingLegal && pendingLegal.value
                  ? { id: pendingLegal.id, value: pendingLegal.value, reviewer }
                  : null,
              role: ROLE_LABEL[profile.baseRole] ?? profile.baseRole,
              supervisor: reviewer,
              years: years ? `${years}${since ? ` · since ${since}` : ""}` : null,
              phone: profile.phone,
              workPhone: profile.workPhone,
              voipPhone: profile.voipPhone,
              preferredPhone: profile.preferredPhone,
              addressLine1: profile.addressLine1,
              addressLine2: profile.addressLine2,
              city: profile.city,
              state: profile.state,
              postalCode: profile.postalCode,
              timeZone: profile.timeZone,
              timeZoneManual: zoneManual,
              primaryRegion: profile.primaryRegion,
              statesOfOperation: profile.statesOfOperation,
              avatarVisibility: profile.avatarVisibility,
            }}
          />

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <DollarSign className="size-4 text-muted-foreground" /> Pay
              </CardTitle>
            </CardHeader>
            <div className="grid gap-2 p-4 sm:grid-cols-[10rem_minmax(0,1fr)_auto] sm:gap-4">
              <span className="text-sm font-medium sm:pt-2.5">Default pay rate</span>
              <div>
                <ReadOnlyValue empty="Not set">
                  {profile.defaultPayType && profile.defaultPayRate
                    ? formatRate(
                        profile.defaultPayType as Parameters<typeof formatRate>[0],
                        profile.defaultPayRate.toString(),
                      )
                    : null}
                </ReadOnlyValue>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Set by managers. A job or a project with its own rate pays that instead.
                </p>
              </div>
              <div className="sm:pt-2">
                <LevelBadge level={levels.defaultPayRate} />
              </div>
            </div>
          </Card>

          <ProfileHistory
            entries={entries}
            field={historyField}
            all={history === "all"}
            timeZone={user.timeZone}
            basePath="/account"
          />

          <Card>
            <CardHeader>
              <CardTitle>Appearance</CardTitle>
              <CardDescription>
                Dark is the default and what the app is designed for. Kept on this device only.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ThemeToggle />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Sign out</CardTitle>
              <CardDescription>
                Signing back in asks NextCloud for your password again, so a shared phone does not
                stay signed in as you.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form
                action={async () => {
                  "use server";
                  await signOut({ redirectTo: "/signin?reauth=1" });
                }}
              >
                <Button type="submit" variant="danger">
                  <LogOut /> Sign out
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
