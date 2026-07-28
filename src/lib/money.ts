import type { PayType } from "@prisma-client";

/**
 * Money formatting, kept apart from pay-rates.ts on purpose.
 *
 * The rate *resolver* needs a database handle, and the live earnings counter
 * needs these formatters — importing one from the other would drag the whole
 * Prisma client into the browser bundle.
 */

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
