/**
 * iCalendar (RFC 5545) generation.
 *
 * NextCloud is strict about folding and escaping, and a malformed VEVENT is
 * rejected wholesale rather than partially — so both are done properly here
 * rather than by string concatenation at the call site.
 */

export type CalendarEventInput = {
  /** Stable across updates: the same job always writes the same event. */
  uid: string;
  start: Date;
  end: Date;
  summary: string;
  location?: string | null;
  description?: string | null;
  url?: string | null;
  /** Bumped on every push so clients know the event changed. */
  sequence: number;
  createdAt: Date;
  updatedAt: Date;
};

/** 20260728T163000Z — UTC, which sidesteps shipping a VTIMEZONE. */
function icalDate(date: Date): string {
  return `${date.toISOString().replace(/[-:]/g, "").split(".")[0]}Z`;
}

/**
 * Escapes a TEXT value. Backslash first, or the escapes introduced below get
 * escaped again.
 */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/**
 * Folds a content line to 75 octets, continuing with a leading space.
 *
 * Counted in octets rather than characters: a line of Cyrillic or an em dash
 * measures short in JavaScript and long on the wire, and NextCloud rejects the
 * over-long line.
 */
function fold(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;

  const parts: string[] = [];
  let current = "";
  let currentBytes = 0;
  // Continuation lines carry a leading space, so they hold one octet less.
  let limit = 75;

  for (const char of line) {
    const size = encoder.encode(char).length;
    if (currentBytes + size > limit) {
      parts.push(current);
      current = char;
      currentBytes = size;
      limit = 74;
    } else {
      current += char;
      currentBytes += size;
    }
  }
  parts.push(current);

  return parts.join("\r\n ");
}

function line(name: string, value: string): string {
  return fold(`${name}:${value}`);
}

export function buildVEvent(event: CalendarEventInput): string {
  const lines = [
    "BEGIN:VEVENT",
    line("UID", event.uid),
    line("DTSTAMP", icalDate(new Date())),
    line("DTSTART", icalDate(event.start)),
    line("DTEND", icalDate(event.end)),
    line("SUMMARY", escapeText(event.summary)),
    line("SEQUENCE", String(event.sequence)),
    line("CREATED", icalDate(event.createdAt)),
    line("LAST-MODIFIED", icalDate(event.updatedAt)),
    line("TRANSP", "OPAQUE"),
  ];

  if (event.location) lines.push(line("LOCATION", escapeText(event.location)));
  if (event.description) {
    lines.push(line("DESCRIPTION", escapeText(event.description)));
  }
  if (event.url) lines.push(line("URL", event.url));

  lines.push("END:VEVENT");
  return lines.join("\r\n");
}

export function buildCalendar(events: CalendarEventInput[]): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//QuickTec//Field Service//EN",
    "CALSCALE:GREGORIAN",
    ...events.map(buildVEvent),
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

/**
 * One event per job per tech.
 *
 * Deterministic so an update overwrites rather than duplicating, and so a
 * delete can be issued without having recorded the path.
 */
export function eventUid(jobId: string, userId: string): string {
  return `job-${jobId}-${userId}@quicktec`;
}

export function eventFileName(jobId: string, userId: string): string {
  return `${eventUid(jobId, userId)}.ics`;
}
