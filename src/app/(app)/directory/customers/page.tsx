import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { db } from "@/lib/db";
import { can, getSessionUser } from "@/lib/session";
import { CustomerList } from "./customer-list";

export const metadata = { title: "Customers" };

export default async function CustomersPage() {
  const user = await getSessionUser();
  if (!user) redirect("/signin");
  if (!can(user, "client.manage")) redirect("/dashboard");

  const customers = await db.customer.findMany({
    orderBy: [{ active: "desc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      code: true,
      active: true,
      _count: { select: { sites: true, jobs: true } },
    },
  });

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <PageHeader
        title="Customers"
        backHref="/directory"
        description="End brands. The code plus a site number becomes “SBUX #24541” in the report, so keep codes short."
      />
      <CustomerList customers={customers} />
    </div>
  );
}
