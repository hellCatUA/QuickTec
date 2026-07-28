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
import { getCompanySettings } from "@/lib/company";
import { db } from "@/lib/db";
import { PERMISSIONS, type Permission } from "@/lib/permissions";
import { can, getSessionUser } from "@/lib/session";

export const metadata = { title: "Dashboard" };

const SCOPE_LABEL = {
  OWN: "Own",
  REPORTS: "Reports",
  PROJECT: "Project",
  ALL: "All",
} as const;

export default async function DashboardPage() {
  const user = await getSessionUser();
  if (!user) redirect("/signin");

  const [company, supervisor, reportCount] = await Promise.all([
    getCompanySettings(),
    user.directSupervisorId
      ? db.user.findUnique({
          where: { id: user.directSupervisorId },
          select: { name: true, email: true, phone: true },
        })
      : Promise.resolve(null),
    db.user.count({ where: { directSupervisorId: user.id } }),
  ]);

  // Things that will quietly break later if they are left unset now.
  const setupChecks = can(user, "settings.company")
    ? [
        {
          done: company.name !== "QuickTec",
          label: "Set the company name",
          detail:
            "Used in the internal work order field label and every export header.",
          href: "/settings/company",
        },
        {
          done: Boolean(company.logoUrl),
          label: "Add a company logo",
          detail: "Appears on the internal PDF work order.",
          href: "/settings/company",
        },
        {
          done: (await db.user.count({ where: { directSupervisorId: null, baseRole: "TECH" } })) === 0,
          label: "Give every tech a direct supervisor",
          detail:
            "Payroll approval routes through this link. A tech without one cannot be paid.",
          href: "/settings/users",
        },
      ]
    : [];

  const grantedPermissions = (
    Object.keys(PERMISSIONS) as Permission[]
  ).flatMap((permission) => {
    const scope = user.grants.get(permission);
    return scope ? [{ permission, scope }] : [];
  });

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">
          Welcome back, {user.name.split(" ")[0]}
        </h1>
        <p className="text-sm text-muted-foreground">
          {company.name} · {SCOPE_LABEL[user.grants.get("job.view") ?? "OWN"]}{" "}
          job visibility
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Your role</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Base role</span>
              <Badge variant="primary">{user.baseRole}</Badge>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Direct supervisor</span>
              <span className="truncate text-right">
                {supervisor?.name ?? (
                  <span className="text-warning">Not set</span>
                )}
              </span>
            </div>
            {reportCount > 0 ? (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Direct reports</span>
                <span>{reportCount}</span>
              </div>
            ) : null}
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Time zone</span>
              <span>{user.timeZone}</span>
            </div>
          </CardContent>
        </Card>

        {supervisor ? (
          <Card>
            <CardHeader>
              <CardTitle>Supervisor contact</CardTitle>
              <CardDescription>
                Always the first entry in a job&rsquo;s dispatch block.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              <div className="font-medium">{supervisor.name}</div>
              {supervisor.phone ? (
                <a
                  href={`tel:${supervisor.phone}`}
                  className="text-primary underline-offset-4 hover:underline"
                >
                  {supervisor.phone}
                </a>
              ) : null}
              <a
                href={`mailto:${supervisor.email}`}
                className="truncate text-primary underline-offset-4 hover:underline"
              >
                {supervisor.email}
              </a>
            </CardContent>
          </Card>
        ) : null}
      </div>

      {setupChecks.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Setup</CardTitle>
            <CardDescription>
              Worth finishing before the first real job goes in.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {setupChecks.map((check) => (
              <Link
                key={check.label}
                href={check.href}
                className="flex items-start gap-3 text-sm"
              >
                {check.done ? (
                  <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" />
                ) : (
                  <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
                )}
                <span>
                  <span
                    className={
                      check.done ? "text-muted-foreground line-through" : ""
                    }
                  >
                    {check.label}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {check.detail}
                  </span>
                </span>
              </Link>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>What you can do</CardTitle>
          <CardDescription>
            Effective permissions after role grants and any personal overrides.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-1.5">
          {grantedPermissions.map(({ permission, scope }) => (
            <Badge key={permission} variant="neutral" title={permission}>
              {PERMISSIONS[permission].label}
              <span className="opacity-60">· {SCOPE_LABEL[scope]}</span>
            </Badge>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
