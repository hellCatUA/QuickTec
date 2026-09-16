import { isoDateInZone, zonedParts } from "@/lib/datetime";
import type { PayExpense } from "@/lib/pay-period";

/**
 * How money, hours and periods are written on the Pay and Payroll screens.
 *
 * Kept out of the components because the two screens have to agree: a week
 * shown as "W36 · Aug 31 – Sep 6" to a tech and as something else to the
 * manager approving it is how two people end up talking about different weeks.
 */

const EXPENSE_KIND_LABEL: Record<PayExpense["kind"], string> = {
  TRAVEL: "Travel",
  PARKING: "Parking",
  TOLL: "Toll",
  HOTEL: "Hotel",
  MATERIAL: "Material",
};

/**
 * What a statement line calls an expense.
 *
 * The name the tech typed wins where there is one — "Holiday Inn" says more
 * than "Hotel", and the icon beside it has already said which kind it is.
 * Parking and tolls have no name to use, so they keep the word.
 */
export function expenseLabel(expense: PayExpense): string {
  return expense.label?.trim() || EXPENSE_KIND_LABEL[expense.kind];
}

/** "$1,592.50". Cents in, because that is what the domain works in. */
export function money(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

/** "24.50" — hours the way the time records already print them. */
export function hours(minutes: number): string {
  return (minutes / 60).toFixed(2);
}

/** "Sep 14" */
export function shortDate(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
  }).format(date);
}

/**
 * "Mon 14" — the day column in the week's day-by-day breakdown.
 *
 * Assembled from the parts rather than formatted whole: en-US renders that
 * combination as "14 Mon", which reads as a quantity of Mondays.
 */
export function dayLabel(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    day: "numeric",
  }).formatToParts(date);

  const find = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return `${find("weekday")} ${find("day")}`;
}

/** "8:00 AM" */
export function clockTime(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

/** "September 2026" */
export function monthLabel(year: number, month: number): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  }).format(Date.UTC(year, month - 1, 1));
}

/** "Sep" — the month in an export button, where the row is already labelled. */
export function monthAbbr(month: number): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
  }).format(Date.UTC(2000, month - 1, 1));
}

/**
 * "Sep 14 – 20", or "Aug 31 – Sep 6" when the week crosses a month.
 *
 * `end` is the exclusive end of the range, so the Sunday is the day before it.
 */
export function weekSpan(start: Date, end: Date, timeZone: string): string {
  const sunday = new Date(end.getTime() - 86_400_000);
  const from = zonedParts(start, timeZone);
  const to = zonedParts(sunday, timeZone);

  return from.month === to.month
    ? `${shortDate(start, timeZone)} – ${to.day}`
    : `${shortDate(start, timeZone)} – ${shortDate(sunday, timeZone)}`;
}

/** The ?week= value for a Monday. */
export function weekParam(start: Date, timeZone: string): string {
  return isoDateInZone(start, timeZone);
}

/** The ?month= value: "2026-09". */
export function monthParam(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** "2026-09" back into its two numbers, or null if it is not one. */
export function parseMonthParam(
  value: string | undefined,
): { year: number; month: number } | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;

  return { year, month };
}
