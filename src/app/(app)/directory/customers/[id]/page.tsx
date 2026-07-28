import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { getCompanySettings } from "@/lib/company";
import { db } from "@/lib/db";
import { can, getSessionUser } from "@/lib/session";
import { SiteList } from "./site-list";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const customer = await db.customer.findUnique({
    where: { id },
    select: { name: true },
  });
  return { title: customer?.name ?? "Customer" };
}

export default async function CustomerSitesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/signin");
  if (!can(user, "client.manage")) redirect("/dashboard");

  const { id } = await params;

  const [customer, company] = await Promise.all([
    db.customer.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        code: true,
        sites: {
          orderBy: [{ active: "desc" }, { siteNumber: "asc" }],
          select: {
            id: true,
            siteNumber: true,
            name: true,
            addressLine1: true,
            addressLine2: true,
            city: true,
            state: true,
            postalCode: true,
            country: true,
            timeZone: true,
            notes: true,
            active: true,
            _count: { select: { jobs: true } },
          },
        },
      },
    }),
    getCompanySettings(),
  ]);

  if (!customer) notFound();

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <PageHeader
        title={`${customer.name} sites`}
        backHref="/directory/customers"
        description={`Site numbers combine with the code as “${customer.code} #24541”. Leave the time zone blank to use the company default (${company.defaultTimeZone}).`}
      />
      <SiteList
        customerId={customer.id}
        customerCode={customer.code}
        sites={customer.sites}
        defaultTimeZone={company.defaultTimeZone}
      />
    </div>
  );
}
