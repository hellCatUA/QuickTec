import { CircleAlert, CircleCheck } from "lucide-react";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { GROUP_TO_ROLE } from "@/lib/nextcloud-groups";
import { can, getSessionUser } from "@/lib/session";

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
          <CardDescription>Arrives in a later phase.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm text-muted-foreground">
          <p>
            A system NextCloud account will provision one CalDAV calendar per
            tech, named{" "}
            <code className="text-xs">
              417-SYS: QuickTec (name@417group.org)
            </code>
            , and share it with that tech&rsquo;s supervisor.
          </p>
          <p>
            Sync is one-way, app to NextCloud: events deleted or edited in
            NextCloud are restored on the next sync.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
