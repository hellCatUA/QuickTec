import type { PayType } from "@prisma-client";

/**
 * Money, kept apart from pay-rates.ts and payroll.ts on purpose.
 *
 * Both of those need a database handle; the live earnings counter and the
 * budget editor run in the browser. Importing one from the other would drag
 * the whole Prisma client into the bundle, so the arithmetic that has no
 * business touching a database lives here.
 */

export const PAY_TYPE_LABEL: Record<PayType, string> = {
  HOURLY: "Hourly",
  FLAT: "Flat rate",
  FLAT_HOURLY: "Flat + Hourly",
  NON_BILLABLE: "Non-billable",
};

/** Anything Prisma might hand back for a Decimal column, plus the obvious. */
export type Moneyish = string | number | { toString(): string };

export function toCents(value: Moneyish): number {
  return Math.round(Number(value.toString()) * 100);
}

export function fromCents(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function formatMoney(value: string | number): string {
  return `$${Number(value).toFixed(2)}`;
}

export function formatCents(cents: number): string {
  return `$${fromCents(cents)}`;
}

/**
 * Hours as somebody says them out loud: 2, 2.5, 0.25.
 *
 * Not `toFixed(2)` — "covers 2.00 hrs" reads like a measurement rather than
 * an agreement, and the quarter-hours are the only fractions that occur.
 */
export function formatHours(minutes: number): string {
  const hours = minutes / 60;
  return Number.isInteger(hours) ? String(hours) : String(Number(hours.toFixed(2)));
}

/**
 * One line of pay terms, said in one phrase.
 *
 * `flat` and `flatMinutes` are only read for FLAT_HOURLY, where the rate
 * alone cannot describe the deal.
 */
export function formatRate(
  payType: PayType,
  rate: string | number,
  flat?: { amount: string | number; minutes: number },
): string {
  if (payType === "NON_BILLABLE") return "Non-billable";
  if (payType === "HOURLY") return `${formatMoney(rate)}/hr`;
  if (payType === "FLAT") return `${formatMoney(rate)} flat`;
  if (!flat) return `${formatMoney(rate)}/hr after a flat amount`;
  return `${formatMoney(flat.amount)} for ${formatHours(flat.minutes)} hrs, then ${formatMoney(rate)}/hr`;
}
