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

export const APP_NAME = "QuickTec";

/**
 * "417 Group | QuickTec" — whose deployment this is, and what it is running.
 *
 * Falls back to the app name alone on a fresh install, where the company row
 * is still called QuickTec and "QuickTec | QuickTec" would be the result.
 */
export function brandLine(companyName: string | null | undefined): string {
  const name = (companyName ?? "").trim();
  if (!name || name.toLowerCase() === APP_NAME.toLowerCase()) return APP_NAME;
  return `${name} | ${APP_NAME}`;
}

/** "NetCom INT WO ID" — the field label follows the company name. */
export function intWoFieldLabel(company: {
  name: string;
  intWoLabel: string;
}): string {
  return `${company.name} ${company.intWoLabel}`.trim();
}
