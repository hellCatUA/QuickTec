import { CircleAlert, CircleCheck } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { calendarDisplayName } from "@/lib/calendar/sync";
import { db } from "@/lib/db";
import { GROUP_TO_ROLE } from "@/lib/nextcloud-groups";
import { can, getSessionUser } from "@/lib/session";
import { CalendarPanel } from "./calendar-panel";

export const metadata = { title: "Integrations" };

function Status({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-sm">
      {ok ? (
        <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" />
      ) : (
        <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
      )}
      <span>{children}</span>
    </div>
  );
}

export default async function IntegrationsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/signin");
  if (!can(user, "settings.integrations")) redirect("/dashboard");

  // Read-only: these come from the container environment, so they are changed
  // in docker-compose and not here.
  const issuer = process.env.NEXTCLOUD_ISSUER;
  const clientId = process.env.NEXTCLOUD_CLIENT_ID;
  const hasSecret = Boolean(process.env.NEXTCLOUD_CLIENT_SECRET);
  const authUrl = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL;
  const hasCalDav = Boolean(
    process.env.CALDAV_USERNAME && process.env.CALDAV_PASSWORD,
  );

  const [activeUsers, provisioned, syncedJobs, stuck] = await Promise.all([
    db.user.count({ where: { active: true } }),
    db.user.count({ where: { active: true, calendarUrl: { not: null } } }),
    db.job.count({ where: { calendarSyncedAt: { not: null } } }),
    // A background push is not awaited by anybody, so this is where its answer
    // survives. Shown without asking: the whole failure mode is silence.
    db.job.findMany({
      where: { calendarSyncError: { not: null } },
      orderBy: { updatedAt: "desc" },
      take: 5,
      select: { id: true, intWoId: true, title: true, calendarSyncError: true },
    }),
  ]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">Integrations</h1>
        <p className="text-sm text-muted-foreground">
          Configured through container environment variables, so this page is
          read-only. Change them in <code>docker-compose.yml</code> and restart.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>NextCloud sign-in (OpenID Connect)</CardTitle>
          <CardDescription>
            QuickTec is an OIDC client of your NextCloud, which acts as the
            provider.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Status ok={Boolean(issuer)}>
            Issuer:{" "}
            <code className="text-xs">{issuer ?? "NEXTCLOUD_ISSUER not set"}</code>
          </Status>
          <Status ok={Boolean(clientId)}>
            Client ID:{" "}
            <code className="text-xs">
              {clientId ?? "NEXTCLOUD_CLIENT_ID not set"}
            </code>
          </Status>
          <Status ok={hasSecret}>
            Client secret {hasSecret ? "is set" : "is missing"}
          </Status>
          <Status ok={Boolean(authUrl)}>
            Redirect URI:{" "}
            <code className="text-xs">
              {authUrl
                ? `${authUrl.replace(/\/$/, "")}/api/auth/callback/nextcloud`
                : "AUTH_URL not set"}
            </code>
          </Status>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Group mapping</CardTitle>
          <CardDescription>
            Read on every sign-in. Changing someone&rsquo;s role means changing
            their NextCloud group; a user in none of these groups is refused
            entry.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {Object.entries(GROUP_TO_ROLE).map(([group, role]) => (
            <div
              key={group}
              className="flex items-center justify-between gap-2 text-sm"
            >
              <code className="text-xs">{group}</code>
              <Badge variant="neutral">{role}</Badge>
            </div>
          ))}
          <p className="mt-2 text-xs text-muted-foreground">
            When a user is in several groups, Manager wins, then Administrator,
            Supervisor, Accountant, Tech.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Calendar sync</CardTitle>
          <CardDescription>
            The system account owns one calendar per tech and shares it
            read-only with them and their supervisor.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Status ok={hasCalDav}>
            System account:{" "}
            <code className="text-xs">
              {process.env.CALDAV_USERNAME ?? "CALDAV_USERNAME not set"}
            </code>
          </Status>
          <Status ok={provisioned > 0}>
            {provisioned} of {activeUsers} active users have a calendar
          </Status>
          <Status ok={syncedJobs > 0}>
            {syncedJobs} job{syncedJobs === 1 ? "" : "s"} pushed so far
          </Status>

          {stuck.length > 0 ? (
            <div className="flex flex-col gap-1 rounded-lg border border-danger/40 p-3">
              <span className="text-sm font-medium text-danger">
                Last push failed on {stuck.length} job
                {stuck.length === 1 ? "" : "s"}
              </span>
              {stuck.map((job) => (
                <div key={job.id} className="text-xs">
                  <Link
                    href={`/jobs/${job.id}`}
                    className="font-medium underline underline-offset-2"
                  >
                    {job.intWoId}
                  </Link>{" "}
                  <span className="text-muted-foreground">
                    {job.calendarSyncError}
                  </span>
                </div>
              ))}
            </div>
          ) : null}

          <p className="text-xs text-muted-foreground">
            Calendars are named{" "}
            <code className="text-xs">{calendarDisplayName("name@417group.org")}</code>
            . Sync is one-way: an event edited or deleted in NextCloud is
            restored on the next run, so nobody is misled into thinking a change
            there meant anything.
          </p>
          <p className="text-xs text-muted-foreground">
            An event runs for the job&rsquo;s estimate until the tech clocks
            out, then for the real time.
          </p>

          <CalendarPanel configured={hasCalDav} />
        </CardContent>
      </Card>
    </div>
  );
}
