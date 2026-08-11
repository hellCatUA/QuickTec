import Link from "next/link";
import { redirect } from "next/navigation";
import { signOut } from "@/auth";
import { AccountMenu } from "@/components/account-menu";
import { BottomNav, SideNav } from "@/components/app-nav";
import { CompanyMark } from "@/components/company-mark";
import { ConnectionStatus } from "@/components/connection-status";
import { ServiceWorkerRegistrar } from "@/components/service-worker";
import { APP_NAME, brandLine } from "@/lib/company";
import { db } from "@/lib/db";
import { buildNavItems } from "@/lib/nav";
import { can, getSessionUser } from "@/lib/session";

const ROLE_LABEL: Record<string, string> = {
  ADMINISTRATOR: "Administrator",
  MANAGER: "Manager",
  SUPERVISOR: "Supervisor",
  TECH: "Tech",
  ACCOUNTANT: "Accountant",
};

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/signin");

  // A password an administrator typed is a password they still know. Nothing
  // else in the app until it has been replaced.
  if (user.mustChangePassword) redirect("/set-password");

  const company = await db.companySettings.findUnique({
    where: { id: "singleton" },
    select: { name: true, logoUrl: true, showCompanyNameInHeader: true },
  });

  const items = buildNavItems(user);
  const canManageSettings =
    can(user, "settings.company") ||
    can(user, "users.manage") ||
    can(user, "roles.manage") ||
    can(user, "settings.integrations");

  return (
    <div className="flex min-h-dvh flex-col">
      <ServiceWorkerRegistrar />
      <ConnectionStatus />

      <header className="flex items-center gap-3 border-b border-border bg-surface px-4 py-2">
        <Link href="/dashboard" className="flex min-w-0 items-center gap-2">
          <CompanyMark
            logoUrl={company?.logoUrl}
            name={company?.name}
            className="size-10 text-sm"
          />
          {/* The company owns the deployment, QuickTec is what it is running.
              Whether both are spelled out is a setting: a long company name
              eats the whole bar on a phone, and the logo already says whose
              deployment this is. */}
          <span className="truncate text-lg font-semibold tracking-tight">
            {company?.showCompanyNameInHeader === false
              ? APP_NAME
              : brandLine(company?.name)}
          </span>
        </Link>

        <div className="ml-auto flex items-center gap-2">
          <AccountMenu
            name={user.name}
            role={ROLE_LABEL[user.baseRole] ?? user.baseRole}
            canManageSettings={canManageSettings}
            signOutAction={async () => {
              "use server";
              // Back through NextCloud asking for credentials, so signing out
              // on a shared phone actually signs you out.
              await signOut({ redirectTo: "/signin?reauth=1" });
            }}
          />
        </div>
      </header>

      <div className="flex flex-1">
        <SideNav items={items} />
        {/* pb-20 clears the mobile tab bar. */}
        <main className="min-w-0 flex-1 p-4 pb-20 md:pb-4">{children}</main>
      </div>

      <BottomNav items={items} />
    </div>
  );
}
