import { Briefcase, Building, MapPin } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { db } from "@/lib/db";
import { can, getSessionUser } from "@/lib/session";

export const metadata = { title: "Directory" };

export default async function DirectoryPage() {
  const user = await getSessionUser();
  if (!user) redirect("/signin");

  const canManageClients = can(user, "client.manage");
  const canManageProjects = can(user, "project.manage");
  if (!canManageClients && !canManageProjects) redirect("/dashboard");

  const [clients, customers, sites, projects] = await Promise.all([
    db.client.count({ where: { active: true } }),
    db.customer.count({ where: { active: true } }),
    db.site.count({ where: { active: true } }),
    db.project.count({ where: { status: "ACTIVE" } }),
  ]);

  const sections = [
    {
      href: "/directory/clients",
      icon: Building,
      title: "Clients",
      count: clients,
      description:
        "Buyers and representing companies that dispatch work to us. Exported as “Buyer/Representing company”.",
      visible: canManageClients,
    },
    {
      href: "/directory/customers",
      icon: MapPin,
      title: "Customers & sites",
      count: `${customers} / ${sites}`,
      description:
        "End brands and their locations. The customer code and site number combine into “SBUX #24541”.",
      visible: canManageClients,
    },
    {
      href: "/projects",
      icon: Briefcase,
      title: "Projects",
      count: projects,
      description:
        "Project IDs, general scope of work, membership and deliverable defaults.",
      visible: canManageProjects,
    },
  ].filter((section) => section.visible);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <PageHeader
        title="Directory"
        description="The records every job is built from."
      />

      <div className="grid gap-3 sm:grid-cols-2">
        {sections.map(({ href, icon: Icon, title, count, description }) => (
          <Link key={href} href={href}>
            <Card className="h-full transition-colors hover:border-primary/50">
              <CardContent className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <Icon className="size-5 text-primary" />
                  <span className="tabular text-sm text-muted-foreground">
                    {count}
                  </span>
                </div>
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
