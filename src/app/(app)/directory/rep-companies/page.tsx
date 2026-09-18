import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { db } from "@/lib/db";
import { can, getSessionUser } from "@/lib/session";
import { RepCompanyList } from "./rep-company-list";

export const metadata = { title: "Rep companies" };

export default async function RepCompaniesPage() {
  const user = await getSessionUser();
  if (!user) redirect("/signin");
  if (!can(user, "client.manage")) redirect("/dashboard");

  const repCompanies = await db.repCompany.findMany({
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
        title="Rep companies"
        backHref="/directory"
        description="Who represents the customer and hands the work down. One link above the paying company, and not the same as either of them."
      />
      <RepCompanyList repCompanies={repCompanies} />
    </div>
  );
}
