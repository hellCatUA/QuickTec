import { db } from "@/lib/db";
import type { PayType } from "@prisma-client";

/**
 * Pay rate lookup, most specific first:
 *
 *   1. per-job override        (set on the assignment, handled by the caller)
 *   2. tech + project
 *   3. tech + client
 *   4. the project's own default
 *   5. tech default
 *   6. non-billable
 *
 * The project default sits above the tech default on purpose: it is the number
 * negotiated for this work, and a personal default is what applies to work
 * nobody negotiated.
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
  source: "project" | "client" | "project-default" | "default" | "none";
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

  if (projectId) {
    const project = await db.project.findUnique({
      where: { id: projectId },
      select: {
        defaultPayType: true,
        defaultPayRate: true,
        travelReimbursement: true,
      },
    });
    if (project?.defaultPayType) {
      return {
        payType: project.defaultPayType,
        rate: project.defaultPayRate?.toString() ?? "0",
        travelReimbursement: project.travelReimbursement?.toString() ?? null,
        source: "project-default",
      };
    }
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

export { PAY_TYPE_LABEL, formatMoney, formatRate } from "@/lib/money";
