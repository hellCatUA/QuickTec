import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { db } from "@/lib/db";
import { can, getSessionUser } from "@/lib/session";
import { ClientList } from "./client-list";

export const metadata = { title: "Clients" };

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
    },
  });

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <PageHeader
        title="Clients"
        backHref="/directory"
        description="Buyers and representing companies. This is what fills “Buyer/Representing company” on the client-facing report."
      />
      <ClientList clients={clients} />
    </div>
  );
}
