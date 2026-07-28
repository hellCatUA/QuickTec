import { LogOut } from "lucide-react";
import { redirect } from "next/navigation";
import { signOut } from "@/auth";
import { BottomNav, SideNav, type NavItem } from "@/components/app-nav";
import { ConnectionStatus } from "@/components/connection-status";
import { ServiceWorkerRegistrar } from "@/components/service-worker";
import { ThemeToggle } from "@/components/theme";
import { Button } from "@/components/ui/button";
import { db } from "@/lib/db";
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

  const company = await db.companySettings.findUnique({
    where: { id: "singleton" },
    select: { name: true, logoUrl: true },
  });

  const items: NavItem[] = [
    { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
  ];
  if (can(user, "job.view")) {
    items.push({ href: "/jobs", label: "Jobs", icon: "jobs" });
  }
  if (can(user, "mileage.submit")) {
    items.push({ href: "/mileage", label: "Mileage", icon: "mileage" });
  }
  if (can(user, "payroll.view")) {
    items.push({ href: "/pay", label: "Pay", icon: "pay" });
  }
  if (
    can(user, "settings.company") ||
    can(user, "users.manage") ||
    can(user, "roles.manage") ||
    can(user, "settings.integrations")
  ) {
    items.push({ href: "/settings", label: "Settings", icon: "settings" });
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <ServiceWorkerRegistrar />
      <ConnectionStatus />

      <header className="flex items-center gap-3 border-b border-border bg-surface px-4 py-2">
        <div className="flex min-w-0 items-center gap-2">
          {company?.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={company.logoUrl}
              alt=""
              className="size-7 rounded object-contain"
            />
          ) : (
            <div className="flex size-7 items-center justify-center rounded bg-primary text-xs font-bold text-primary-foreground">
              Q
            </div>
          )}
          <span className="truncate text-sm font-semibold">
            {company?.name ?? "QuickTec"}
          </span>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <div className="hidden text-right sm:block">
            <div className="text-xs font-medium leading-tight">{user.name}</div>
            <div className="text-[10px] leading-tight text-muted-foreground">
              {ROLE_LABEL[user.baseRole] ?? user.baseRole}
            </div>
          </div>
          <ThemeToggle />
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/signin" });
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
