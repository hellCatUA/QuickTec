import { redirect } from "next/navigation";
import { getCompanySettings } from "@/lib/company";
import { can, getSessionUser } from "@/lib/session";
import { CompanyForm } from "./company-form";

export const metadata = { title: "Company settings" };

export default async function CompanySettingsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/signin");
  if (!can(user, "settings.company")) redirect("/dashboard");

  const company = await getCompanySettings();

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">Company</h1>
        <p className="text-sm text-muted-foreground">
          These values drive export headers, the internal work order numbering
          and every money calculation in the app.
        </p>
      </div>

      <CompanyForm
        company={{
          ...company,
          mileageRate: company.mileageRate.toString(),
        }}
      />
    </div>
  );
}
