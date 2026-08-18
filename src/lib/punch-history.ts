import type { TimelineTone } from "@/lib/timeline";

/**
 * Everything that has happened to one punch, in the order it happened.
 *
 * The job's timeline answers "what happened on this job"; this answers "why
 * does this clock say what it says", which is a different question and the one
 * somebody asks when payroll is queried. So it reads as a statement of the day
 * rather than a list of database actions: a clock-in with the time it records,
 * a change with the time it used to say struck through beside the time it says
 * now, and under every line the person and the moment they did it — which is
 * not the same as the time being written about, and confusing the two is how a
 * timeline becomes unreadable.
 *
 * Pure so that the shape can be argued with in a test rather than in a browser.
 */

export type PunchChange = {
  label: string;
  /** What it used to say. Absent when nothing was there before. */
  from: string | null;
  to: string;
};

/**
 * Which picture goes on the line.
 *
 * A name rather than a component, so this file stays free of React and can be
 * read by a test that has no browser in it.
 */
export type PunchIcon =
  | "in"
  | "out"
  | "breakStart"
  | "breakEnd"
  | "added"
  | "removed"
  | "changed"
  | "asked"
  | "approved"
  | "denied"
  | "flagged"
  | "other";

export type PunchHistoryRow = {
  id: string;
  action: string;
  icon: PunchIcon;
  /** "Clock In", "Punch changed", "Punch change denied". */
  title: string;
  /** On the same line as the title: a time, a duration, a span. */
  suffix: string | null;
  changes: PunchChange[];
  reason: string | null;
  /** Written by hand by whoever turned a request down. */
  denial: string | null;
  by: string;
  /** When the action was taken, which is rarely the time it is about. */
  at: string;
  tone: TimelineTone;
  /**
   * Part of a request-and-answer pair.
   *
   * Somebody asks for a change and somebody else decides it, and the two rows
   * are the same event seen from both ends. Marked so the interface can join
   * them up rather than leaving a reader to match times by eye.
   */
  paired: boolean;
};

export type PunchEvent = {
  id: string;
  action: string;
  createdAt: Date;
  actorName: string | null;
  detail: Record<string, unknown> | null;
};

type Format = {
  /** A clock time as a person reads it: "8:30 AM". */
  time: (iso: string | Date) => string;
  /** Minutes between two instants. */
  minutes: (from: string | Date, to: string | Date) => number;
};

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function hours(minutes: number): string {
  return `${(minutes / 60).toFixed(2)} hrs`;
}

/**
 * Which of the two clocks moved, and from what to what.
 *
 * A whole-punch change carries both and usually only one of them differs;
 * listing the one that did not is noise dressed as detail.
 */
function clockChanges(
  detail: Record<string, unknown>,
  format: Format,
): PunchChange[] {
  const changes: PunchChange[] = [];

  const pairs: [string, string, string][] = [
    ["Clock In", "fromIn", "toIn"],
    ["Clock Out", "fromOut", "toOut"],
  ];

  for (const [label, fromKey, toKey] of pairs) {
    const to = str(detail[toKey]);
    if (!to) continue;
    const from = str(detail[fromKey]);
    if (from === to) continue;
    changes.push({
      label,
      from: from ? format.time(from) : null,
      to: format.time(to),
    });
  }

  // The older per-field shape, before a punch was edited as one thing.
  if (changes.length === 0 && str(detail.to)) {
    const field = str(detail.field);
    changes.push({
      label: field === "clockOut" ? "Clock Out" : "Clock In",
      from: str(detail.from) ? format.time(detail.from as string) : null,
      to: format.time(detail.to as string),
    });
  }

  return changes;
}

export function buildPunchHistory(
  events: PunchEvent[],
  format: Format,
): PunchHistoryRow[] {
  // The day in the order it was lived: in, break, back, out, and whatever was
  // argued about afterwards. Sorted here rather than trusted from the caller,
  // who reads newest-first to cap the query and should not have to know that
  // the pairing below depends on the order.
  const ordered = [...events].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  );

  // How long each break ran, which is only known when it ends — so the line
  // that says a break started can only carry it by looking forward. The nth
  // start is the nth end, breaks on one punch being one at a time.
  const breakMinutes: (number | null)[] = ordered
    .filter((event) => event.action === "break_end")
    .map((event) =>
      typeof event.detail?.minutes === "number" ? event.detail.minutes : null,
    );
  let breakIndex = 0;

  // Requests and their answers are the same event from both ends, so a row is
  // marked whenever the other half is somewhere in the list.
  const hasRequest = ordered.some(
    (event) => event.action === "punch_change_requested",
  );
  const hasAnswer = ordered.some(
    (event) =>
      event.action === "punch_change_approved" ||
      event.action === "punch_change_denied",
  );
  const paired = hasRequest && hasAnswer;

  return ordered.map((event) => {
    const detail = event.detail ?? {};
    const by = event.actorName ?? "the system";
    const at = format.time(event.createdAt);

    const base = {
      id: event.id,
      action: event.action,
      changes: [] as PunchChange[],
      reason: str(detail.reason),
      denial: str(detail.denial),
      by,
      at,
      paired: false,
    };

    switch (event.action) {
      case "clock_in":
        return {
          ...base,
          title: "Clock In",
          icon: "in" as PunchIcon,
          suffix: str(detail.at) ? format.time(detail.at as string) : null,
          tone: "success" as TimelineTone,
        };

      case "clock_out":
        return {
          ...base,
          title: "Clock Out",
          icon: "out" as PunchIcon,
          suffix: str(detail.at) ? format.time(detail.at as string) : null,
          tone: "neutral" as TimelineTone,
        };

      case "break_start": {
        const ran = breakMinutes[breakIndex++] ?? null;
        return {
          ...base,
          title: "Break In",
          icon: "breakStart" as PunchIcon,
          suffix: [
            str(detail.at) ? format.time(detail.at as string) : at,
            ran === null ? null : `${ran} min`,
          ]
            .filter(Boolean)
            .join(" · "),
          tone: "neutral" as TimelineTone,
        };
      }

      case "break_end":
        return {
          ...base,
          title: "Break Out",
          icon: "breakEnd" as PunchIcon,
          suffix: [
            str(detail.at) ? format.time(detail.at as string) : at,
            typeof detail.minutes === "number"
              ? `${detail.minutes} min`
              : null,
          ]
            .filter(Boolean)
            .join(" · "),
          tone: "neutral" as TimelineTone,
        };

      case "time_added": {
        const from = str(detail.from);
        const to = str(detail.to);
        const span =
          from && to ? ` (${hours(format.minutes(from, to))})` : "";
        return {
          ...base,
          title: "Punch Added",
          icon: "added" as PunchIcon,
          suffix: from
            ? `${format.time(from)} → ${to ? format.time(to) : "still on site"}${span}`
            : null,
          tone: "warning" as TimelineTone,
        };
      }

      case "time_removed": {
        const from = str(detail.from);
        const to = str(detail.to);
        return {
          ...base,
          title: "Punch Removed",
          icon: "removed" as PunchIcon,
          // The day that was taken away, because a removal with no times on it
          // says only that something happened.
          suffix: from
            ? `${format.time(from)} → ${to ? format.time(to) : "still on site"}`
            : null,
          tone: "danger" as TimelineTone,
        };
      }

      case "punch_changed":
      case "time_adjusted":
        return {
          ...base,
          title: "Punch Adjusted",
          icon: "changed" as PunchIcon,
          suffix: null,
          changes: clockChanges(detail, format),
          tone: "warning" as TimelineTone,
        };

      case "punch_change_requested":
        return {
          ...base,
          title: "Punch Adjust requested",
          icon: "asked" as PunchIcon,
          suffix: null,
          changes: clockChanges(detail, format),
          tone: "warning" as TimelineTone,
          paired,
        };

      case "punch_change_approved":
        return {
          ...base,
          title: "Punch Adjust approved",
          icon: "approved" as PunchIcon,
          suffix: null,
          changes: clockChanges(detail, format),
          tone: "success" as TimelineTone,
          paired,
        };

      case "punch_change_denied":
        return {
          ...base,
          title: "Punch Adjust denied",
          icon: "denied" as PunchIcon,
          suffix: null,
          changes: clockChanges(detail, format),
          tone: "danger" as TimelineTone,
          paired,
        };

      case "time_flag_accepted":
        return {
          ...base,
          title: "Time flag accepted",
          icon: "approved" as PunchIcon,
          suffix: str(detail.field),
          tone: "success" as TimelineTone,
        };

      case "time_flag_reopened":
        return {
          ...base,
          title: "Time flag reopened",
          icon: "flagged" as PunchIcon,
          suffix: str(detail.field),
          tone: "warning" as TimelineTone,
        };

      default:
        return {
          ...base,
          title:
            event.action.charAt(0).toUpperCase() +
            event.action.slice(1).replace(/_/g, " "),
          icon: "other" as PunchIcon,
          suffix: null,
          tone: "neutral" as TimelineTone,
        };
    }
  });
}
