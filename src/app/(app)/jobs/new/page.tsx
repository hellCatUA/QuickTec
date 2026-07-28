import { redirect } from "next/navigation";
import { EmptyState, PageHeader } from "@/components/ui/page-header";
import { getCompanySettings } from "@/lib/company";
import { db } from "@/lib/db";
import { can, getSessionUser } from "@/lib/session";
import { JobForm } from "./job-form";

export const metadata = { title: "New job" };

export default async function NewJobPage() {
  const user = await getSessionUser();
  if (!user) redirect("/signin");
  if (!can(user, "job.create")) redirect("/jobs");

  const [company, clients, sites, projects, techs] = await Promise.all([
    getCompanySettings(),
    db.client.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.site.findMany({
      where: { active: true, customer: { active: true } },
      orderBy: [{ customer: { code: "asc" } }, { siteNumber: "asc" }],
      select: {
        id: true,
        siteNumber: true,
        city: true,
        state: true,
        customer: { select: { id: true, code: true, name: true } },
      },
    }),
    db.project.findMany({
      where: { status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        externalProjectId: true,
        clientId: true,
        customerId: true,
        intWoCounter: true,
      },
    }),
    db.user.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, baseRole: true },
    }),
  ]);

  // Without a site there is nothing to dispatch to, and the address that ends
  // up on the client report comes from it.
  if (clients.length === 0 || sites.length === 0) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <PageHeader title="New job" backHref="/jobs" />
        <EmptyState
          title="Set up the directory first"
          description={
            clients.length === 0
              ? "Add at least one client — the buyer or representing company that dispatches the work."
              : "Add at least one customer and site. The site supplies the address that goes on the client report."
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <PageHeader
        title="New job"
        backHref="/jobs"
        description={`The ${company.name} ${company.intWoLabel} is assigned automatically when you save.`}
      />

      <JobForm
        canAssign={can(user, "job.assign")}
        needsApproval={!can(user, "job.approve_report")}
        clients={clients}
        sites={sites}
        projects={projects}
        techs={techs}
        globalNextSequence={
          (await db.intWoCounter.findUnique({
            where: { scope: `global:${new Date().getFullYear()}` },
            select: { value: true },
          }))?.value ?? 0
        }
        breakPaidByDefault={company.breakPaidByDefault}
      />
    </div>
  );
}
