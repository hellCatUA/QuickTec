import { LogOut } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { signOut } from "@/auth";
import { BottomNav, SideNav } from "@/components/app-nav";
import { CompanyMark } from "@/components/company-mark";
import { ConnectionStatus } from "@/components/connection-status";
import { ServiceWorkerRegistrar } from "@/components/service-worker";
import { Button } from "@/components/ui/button";
import { brandLine } from "@/lib/company";
import { db } from "@/lib/db";
import { buildNavItems } from "@/lib/nav";
import { getSessionUser } from "@/lib/session";

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

  const company = await db.companySettings.findUnique({
    where: { id: "singleton" },
    select: { name: true, logoUrl: true },
  });

  const items = buildNavItems(user);

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
              Both belong here — replacing one with the other loses which app
              you are looking at. */}
          <span className="truncate text-sm font-semibold">
            {brandLine(company?.name)}
          </span>
        </Link>

        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/account"
            className="hidden rounded-lg px-2 py-1 text-right hover:bg-muted sm:block"
          >
            <div className="text-xs font-medium leading-tight">{user.name}</div>
            <div className="text-[10px] leading-tight text-muted-foreground">
              {ROLE_LABEL[user.baseRole] ?? user.baseRole}
            </div>
          </Link>
          <form
            action={async () => {
              "use server";
              // Back through NextCloud asking for credentials, so signing out
              // on a shared phone actually signs you out.
              await signOut({ redirectTo: "/signin?reauth=1" });
            }}
          >
            <Button
              type="submit"
              variant="ghost"
              size="icon"
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut />
            </Button>
          </form>
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
