import { db } from "@/lib/db";
import type { PayType } from "@prisma-client";

/**
 * Pay rate lookup, most specific first:
 *
 *   1. per-job override        (set on the assignment, handled by the caller)
 *   2. tech + project
 *   3. tech + client
 *   4. tech default
 *   5. non-billable
 *
 * Travel reimbursement is intentionally absent from steps 4 and 5: it is money
 * the customer allocates for a particular job or project, so a tech never
 * carries a default. It is separate from mileage, which is a write-off record
 * rather than a payment.
 */

export type ResolvedRate = {
  payType: PayType;
  rate: string;
  travelReimbursement: string | null;
  /** Where the rate came from, for showing the operator why. */
  source: "project" | "client" | "default" | "none";
};

export async function resolvePayRate(
  userId: string,
  projectId: string | null,
  clientId: string | null,
): Promise<ResolvedRate> {
  const candidates = await db.payRate.findMany({
    where: {
      userId,
      OR: [
        projectId ? { projectId } : undefined,
        clientId ? { clientId, projectId: null } : undefined,
      ].filter(Boolean) as object[],
    },
    select: {
      projectId: true,
      clientId: true,
      payType: true,
      rate: true,
      travelReimbursement: true,
    },
  });

  const byProject = candidates.find((rate) => rate.projectId === projectId && projectId);
  if (byProject) {
    return {
      payType: byProject.payType,
      rate: byProject.rate.toString(),
      travelReimbursement: byProject.travelReimbursement?.toString() ?? null,
      source: "project",
    };
  }

  const byClient = candidates.find((rate) => !rate.projectId && rate.clientId);
  if (byClient) {
    return {
      payType: byClient.payType,
      rate: byClient.rate.toString(),
      travelReimbursement: byClient.travelReimbursement?.toString() ?? null,
      source: "client",
    };
  }

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { defaultPayType: true, defaultPayRate: true },
  });

  if (user?.defaultPayType) {
    return {
      payType: user.defaultPayType,
      rate: user.defaultPayRate?.toString() ?? "0",
      travelReimbursement: null,
      source: "default",
    };
  }

  // No rate anywhere. Non-billable is the safe fallback: it under-reports
  // rather than inventing a number that would flow into payroll.
  return {
    payType: "NON_BILLABLE",
    rate: "0",
    travelReimbursement: null,
    source: "none",
  };
}

export const PAY_TYPE_LABEL: Record<PayType, string> = {
  HOURLY: "Hourly",
  FLAT: "Flat rate",
  NON_BILLABLE: "Non-billable",
};

export function formatMoney(value: string | number): string {
  return `$${Number(value).toFixed(2)}`;
}

export function formatRate(payType: PayType, rate: string | number): string {
  if (payType === "NON_BILLABLE") return "Non-billable";
  if (payType === "HOURLY") return `${formatMoney(rate)}/hr`;
  return `${formatMoney(rate)} flat`;
}
