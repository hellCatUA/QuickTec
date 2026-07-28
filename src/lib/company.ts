import { db } from "@/lib/db";

/**
 * The company row is a singleton created by the seed. Reading it through this
 * helper means callers never have to deal with it being missing.
 */
export async function getCompanySettings() {
  return db.companySettings.upsert({
    where: { id: "singleton" },
    update: {},
    create: { id: "singleton" },
  });
}

export type CompanySettings = Awaited<ReturnType<typeof getCompanySettings>>;

/** "NetCom INT WO ID" — the field label follows the company name. */
export function intWoFieldLabel(company: {
  name: string;
  intWoLabel: string;
}): string {
  return `${company.name} ${company.intWoLabel}`.trim();
}
