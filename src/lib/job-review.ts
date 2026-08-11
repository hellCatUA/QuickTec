/**
 * What a reviewer needs to be shown before signing a job off.
 *
 * A single Approve button asks somebody to vouch for a day they did not see,
 * and the honest answer to it is always yes — there is nothing on the screen to
 * say no to. So the review is four passes, and each one arrives with the things
 * that do not look right already found.
 *
 * Pure, and separate from the page, because "is this late" and "is this over
 * estimate" are arithmetic somebody will want to argue with, and arithmetic is
 * worth being able to test without a browser.
 *
 * Nothing here blocks approval. A late start is usually the site's fault and a
 * long day is usually real work; the reviewer is the one who knows which. The
 * job is to make sure they are looking at it rather than to decide for them.
 */

export type ReviewLevel = "warn" | "note";

export type ReviewFlag = {
  level: ReviewLevel;
  text: string;
};

/** How late counts as late. Traffic is not a finding. */
export const LATE_START_MINUTES = 30;

/** How far past the estimate is worth a second look, as a fraction of it. */
export const OVER_ESTIMATE_FRACTION = 0.25;

function hours(minutes: number): string {
  return `${(minutes / 60).toFixed(2)} hrs`;
}

export type TimesInput = {
  scheduledStart: Date | null;
  estimateMinutes: number | null;
  /** One per tech, already totalled. */
  visits: {
    who: string;
    clockInAt: Date;
    clockOutAt: Date | null;
    paidMinutes: number;
  }[];
};

/**
 * Turning up late and staying long are the two things a client asks about, and
 * both are invisible in a list of timestamps.
 */
export function reviewTimes(input: TimesInput): ReviewFlag[] {
  const flags: ReviewFlag[] = [];

  if (input.visits.length === 0) {
    flags.push({
      level: "warn",
      text: "Nobody clocked in. There is no time on this job to approve.",
    });
    return flags;
  }

  for (const visit of input.visits) {
    if (!visit.clockOutAt) {
      flags.push({
        level: "warn",
        text: `${visit.who} is still clocked in.`,
      });
    }

    if (input.scheduledStart) {
      const late = Math.round(
        (visit.clockInAt.getTime() - input.scheduledStart.getTime()) / 60_000,
      );
      if (late >= LATE_START_MINUTES) {
        flags.push({
          level: "warn",
          text: `${visit.who} checked in ${late} minutes after the scheduled start.`,
        });
      }
    }
  }

  const worked = input.visits.reduce(
    (total, visit) => total + visit.paidMinutes,
    0,
  );

  if (input.estimateMinutes && input.estimateMinutes > 0) {
    // Per tech, not summed: two techs on a six-hour job book twelve hours
    // between them and neither of them is over.
    const perTech = worked / input.visits.length;
    const over = perTech - input.estimateMinutes;
    if (over > input.estimateMinutes * OVER_ESTIMATE_FRACTION) {
      flags.push({
        level: "warn",
        text: `${hours(perTech)} against an estimate of ${hours(
          input.estimateMinutes,
        )}.`,
      });
    }
  }

  return flags;
}

export type DeliverablesInput = {
  /** Sections the job asks for, and whether anything is in them. */
  sections: { label: string; required: boolean; filled: boolean }[];
  photoCount: number;
  /** Their sheet, signed on site. */
  hasSignOff: boolean;
};

export function reviewDeliverables(input: DeliverablesInput): ReviewFlag[] {
  const flags: ReviewFlag[] = [];

  const missing = input.sections
    .filter((section) => section.required && !section.filled)
    .map((section) => section.label);
  if (missing.length > 0) {
    flags.push({
      level: "warn",
      text: `Required and empty: ${missing.join(", ")}.`,
    });
  }

  const empty = input.sections
    .filter((section) => !section.required && !section.filled)
    .map((section) => section.label);
  if (empty.length > 0) {
    flags.push({
      level: "note",
      text: `Nothing in ${empty.join(", ")}.`,
    });
  }

  if (input.photoCount === 0) {
    flags.push({ level: "warn", text: "No photos at all." });
  }

  if (!input.hasSignOff) {
    flags.push({
      level: "note",
      text: "No signed sheet attached.",
    });
  }

  return flags;
}

export type ReimbursementsInput = {
  entries: { label: string; amount: number; hasReceipt: boolean }[];
};

/**
 * Money the company pays back, which is the part of a job most likely to be
 * queried weeks later when nobody remembers.
 */
export function reviewReimbursements(input: ReimbursementsInput): ReviewFlag[] {
  const flags: ReviewFlag[] = [];

  const noReceipt = input.entries
    .filter((entry) => !entry.hasReceipt)
    .map((entry) => entry.label);
  if (noReceipt.length > 0) {
    flags.push({
      level: "warn",
      text: `No receipt: ${noReceipt.join(", ")}.`,
    });
  }

  return flags;
}

export type WorkInput = {
  /** What actually goes to the client, when somebody has written it. */
  merged: string | null;
  entries: { who: string; text: string | null }[];
};

export function reviewWork(input: WorkInput): ReviewFlag[] {
  const flags: ReviewFlag[] = [];

  const written = input.entries.filter((entry) => entry.text?.trim());

  if (!input.merged?.trim() && written.length === 0) {
    flags.push({
      level: "warn",
      text: "Nothing written. The client report would go out empty.",
    });
    return flags;
  }

  const silent = input.entries
    .filter((entry) => !entry.text?.trim())
    .map((entry) => entry.who);
  if (!input.merged?.trim() && silent.length > 0) {
    flags.push({
      level: "note",
      text: `${silent.join(", ")} wrote nothing, so the report carries only the others.`,
    });
  }

  return flags;
}

/** The worst thing found, for a step's badge. */
export function worst(flags: ReviewFlag[]): ReviewLevel | null {
  if (flags.some((flag) => flag.level === "warn")) return "warn";
  if (flags.length > 0) return "note";
  return null;
}
