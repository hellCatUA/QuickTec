/**
 * Time zone handling.
 *
 * Everything is stored in UTC. Every rendering and every calendar boundary —
 * which month an INT WO belongs to, which Monday starts a pay week — has to be
 * computed in a real zone, or a job scheduled at 11pm on 31 July in Los Angeles
 * files itself under August.
 *
 * Uses Intl rather than a date library so there is no tz database to keep in
 * sync with the host.
 */

export const DEFAULT_TIME_ZONE = "America/Los_Angeles";

export type ZonedParts = {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
};

const partsCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = partsCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    partsCache.set(timeZone, formatter);
  }
  return formatter;
}

export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = partsFormatter(timeZone).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");

  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    // Intl renders midnight as 24 in hour12:false on some engines.
    hour: get("hour") % 24,
    minute: get("minute"),
  };
}

/** "2026-07-28" in the given zone. Used in ZIP names and photo watermarks. */
export function isoDateInZone(date: Date, timeZone: string): string {
  const { year, month, day } = zonedParts(date, timeZone);
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** "07-28-2026" — the format used in exports. */
export function usDateInZone(date: Date, timeZone: string): string {
  const { year, month, day } = zonedParts(date, timeZone);
  return `${pad(month)}-${pad(day)}-${year}`;
}

/** "9:05 AM" — clock times in the text report carry no date. */
export function usTimeInZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

export function usDateTimeInZone(date: Date, timeZone: string): string {
  return `${usDateInZone(date, timeZone)} ${usTimeInZone(date, timeZone)}`;
}

export function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

/**
 * The UTC instant of local midnight on the Monday that starts this date's week.
 * Pay weeks run Monday to Sunday.
 */
export function startOfWeekMonday(date: Date, timeZone: string): Date {
  const { year, month, day } = zonedParts(date, timeZone);

  // Weekday of the zoned calendar date, computed via a UTC proxy so the host's
  // own zone never enters into it.
  const proxy = new Date(Date.UTC(year, month - 1, day));
  const isoWeekday = (proxy.getUTCDay() + 6) % 7; // Monday = 0

  proxy.setUTCDate(proxy.getUTCDate() - isoWeekday);

  return zonedMidnight(
    proxy.getUTCFullYear(),
    proxy.getUTCMonth() + 1,
    proxy.getUTCDate(),
    timeZone,
  );
}

/** Exclusive end of the pay week — local midnight the following Monday. */
export function endOfWeekMonday(date: Date, timeZone: string): Date {
  const start = startOfWeekMonday(date, timeZone);
  const { year, month, day } = zonedParts(start, timeZone);
  const proxy = new Date(Date.UTC(year, month - 1, day + 7));
  return zonedMidnight(
    proxy.getUTCFullYear(),
    proxy.getUTCMonth() + 1,
    proxy.getUTCDate(),
    timeZone,
  );
}

/**
 * The UTC instant corresponding to 00:00 on a calendar date in a zone.
 * Solved by iteration because the offset depends on the answer — on a DST
 * boundary the first guess can be an hour out.
 */
export function zonedMidnight(
  year: number,
  month: number,
  day: number,
  timeZone: string,
): Date {
  let guess = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));

  for (let attempt = 0; attempt < 3; attempt++) {
    const parts = zonedParts(guess, timeZone);
    const driftMinutes =
      (parts.year - year) * 525_600 +
      (parts.month - month) * 43_200 +
      (parts.day - day) * 1_440 +
      parts.hour * 60 +
      parts.minute;

    if (driftMinutes === 0) break;
    guess = new Date(guess.getTime() - driftMinutes * 60_000);
  }

  return guess;
}

/**
 * Snaps a clock time to the company's rounding interval.
 *
 * Note this is deliberately NOT "nearest". The rule the business runs on is a
 * window of [target - 3 min, target + 2 min) at five-minute steps:
 *
 *   09:57 → 10:00     (nearest would give 09:55)
 *   10:01 → 10:00
 *   10:03 → 10:05
 *
 * Implemented as floor((t + ceil(interval/2)) / interval), which reproduces
 * those windows exactly and degrades to ordinary round-half-up on an even
 * interval. The half-minute of bias favours the tech, which is the intent.
 *
 * Applied once, when the button is pressed. Pay is then computed from the
 * snapped value with no second rounding.
 */
export function roundToInterval(date: Date, intervalMinutes: number): Date {
  const intervalMs = intervalMinutes * 60_000;
  const biasMs = Math.ceil(intervalMinutes / 2) * 60_000;

  return new Date(
    Math.floor((date.getTime() + biasMs) / intervalMs) * intervalMs,
  );
}

/** Decimal hours as they appear in the report: 2 h 35 m → "2.58". */
export function decimalHours(minutes: number): string {
  return (minutes / 60).toFixed(2);
}
