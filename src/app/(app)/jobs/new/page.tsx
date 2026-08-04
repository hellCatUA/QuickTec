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

  const [
    company,
    clients,
    sites,
    projects,
    customers,
    techs,
    templates,
    clientDispatch,
  ] =
    await Promise.all([
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
        numberPending: true,
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
        client: { select: { name: true } },
        customerId: true,
        intWoCounter: true,
        breakPaid: true,
        defaultJobTitle: true,
        defaultPayType: true,
        defaultPayRate: true,
        travelReimbursement: true,
        dispatchContacts: {
          orderBy: { order: "asc" },
          select: { id: true, label: true, name: true },
        },
        // Who normally does this work. Shown first in the crew search rather
        // than enforced: a project member is a default, not a fence.
        members: { select: { userId: true } },
      },
    }),
    db.customer.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, code: true, name: true },
    }),
    db.user.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, baseRole: true },
    }),
    db.clientDocumentTemplate.findMany({
      where: { active: true },
      orderBy: [{ isDefault: "desc" }, { label: "asc" }],
      select: {
        id: true,
        clientId: true,
        kind: true,
        label: true,
        isDefault: true,
      },
    }),
    // Numbers held against a representing company. Offered on any job for
    // them, so their NOC line is not retyped on every one.
    db.dispatchContact.findMany({
      where: { clientId: { not: null } },
      orderBy: { order: "asc" },
      select: {
        id: true,
        clientId: true,
        label: true,
        name: true,
        phone: true,
        email: true,
        note: true,
      },
    }),
  ]);

  // Without a site there is nothing to dispatch to, and the address that ends
  // up on the client report comes from it.
  if (clients.length === 0) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <PageHeader title="New job" backHref="/jobs" />
        <EmptyState
          title="Set up the directory first"
          description="Add at least one representing company — whoever dispatches the work and pays for it. Sites can be added from the job form itself."
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
        projects={projects.map((project) => ({
          id: project.id,
          name: project.name,
          externalProjectId: project.externalProjectId,
          clientId: project.clientId,
          clientName: project.client.name,
          customerId: project.customerId,
          intWoCounter: project.intWoCounter,
          breakPaid: project.breakPaid,
          defaultJobTitle: project.defaultJobTitle,
          defaultPayType: project.defaultPayType,
          defaultPayRate: project.defaultPayRate?.toString() ?? null,
          travelReimbursement: project.travelReimbursement?.toString() ?? null,
          memberIds: project.members.map((member) => member.userId),
          dispatchContacts: project.dispatchContacts,
        }))}
        techs={techs}
        customers={customers}
        templates={templates}
        clientDispatch={clientDispatch.map((contact) => ({
          ...contact,
          clientId: contact.clientId!,
        }))}
        canSetPay={can(user, "pay.edit_rates")}
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
