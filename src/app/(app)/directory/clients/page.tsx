import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { db } from "@/lib/db";
import { can, getSessionUser } from "@/lib/session";
import { ClientList } from "./client-list";

export const metadata = { title: "Representing companies" };

export default async function ClientsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/signin");
  if (!can(user, "client.manage")) redirect("/dashboard");

  const clients = await db.client.findMany({
    orderBy: [{ active: "desc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      code: true,
      notes: true,
      active: true,
      _count: { select: { jobs: true, projects: true } },
      templates: {
        where: { active: true },
        orderBy: [{ kind: "asc" }, { label: "asc" }],
        select: {
          id: true,
          kind: true,
          label: true,
          isDefault: true,
          attachmentId: true,
          placements: { select: { source: true } },
        },
      },
      dispatchContacts: {
        orderBy: { order: "asc" },
        select: {
          id: true,
          label: true,
          name: true,
          phone: true,
          email: true,
          note: true,
        },
      },
    },
  });

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <PageHeader
        title="Representing companies"
        backHref="/directory"
        description="Who dispatches work to us and pays for it. Fills “Buyer/Representing company” on the report we send back."
      />
      <ClientList
        clients={clients.map((client) => ({
          ...client,
          templates: client.templates.map(({ placements, ...template }) => ({
            ...template,
            boxCount: placements.length,
            mappedCount: placements.filter((placement) => placement.source)
              .length,
          })),
        }))}
      />
    </div>
  );
}
