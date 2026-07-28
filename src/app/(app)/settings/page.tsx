import { Building2, KeyRound, Plug, Users } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { can, getSessionUser } from "@/lib/session";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/signin");

  const sections = [
    {
      href: "/settings/company",
      icon: Building2,
      title: "Company",
      description:
        "Name, logo, contact details, time rounding, mileage rate and pay lag.",
      visible: can(user, "settings.company"),
    },
    {
      href: "/settings/users",
      icon: Users,
      title: "Users",
      description:
        "Direct supervisors, time zones and account status. Roles come from NextCloud groups.",
      visible: can(user, "users.manage"),
    },
    {
      href: "/settings/roles",
      icon: KeyRound,
      title: "Roles & permissions",
      description:
        "The permission matrix — what each role can do and how far it reaches.",
      visible: can(user, "roles.manage"),
    },
    {
      href: "/settings/integrations",
      icon: Plug,
      title: "Integrations",
      description: "NextCloud sign-in and calendar sync status.",
      visible: can(user, "settings.integrations"),
    },
  ].filter((section) => section.visible);

  // The nav link is already hidden for these users; this stops a bookmarked or
  // hand-typed URL from landing them on an empty page.
  if (sections.length === 0) redirect("/dashboard");

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <h1 className="text-lg font-semibold">Settings</h1>

      <div className="grid gap-3 sm:grid-cols-2">
        {sections.map(({ href, icon: Icon, title, description }) => (
          <Link key={href} href={href}>
            <Card className="h-full transition-colors hover:border-primary/50">
              <CardContent className="flex flex-col gap-2">
                <Icon className="size-5 text-primary" />
                <div className="text-sm font-semibold">{title}</div>
                <p className="text-xs text-muted-foreground">{description}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
