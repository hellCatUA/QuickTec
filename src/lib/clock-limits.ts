/**
 * How far somebody may move a clock that is already recorded.
 *
 * This is the one calculation in the app that decides what a person is paid,
 * so it is a pure function with the facts handed to it rather than a set of
 * checks scattered through an action. Every branch below is somebody's money.
 *
 * The shape of it comes from what actually goes wrong on site:
 *
 *   A crew forgets to clock out and notices the next morning. The honest fix
 *   is always downwards — nobody was on site at 3am — so the lead may pull a
 *   clock-out back as far as it needs to go. There is no way to steal time
 *   with that.
 *
 *   Adding time is the opposite. "We were there another hour" may be true and
 *   is exactly what somebody would write if it were not, so a lead or a
 *   supervisor may add up to an hour and anything beyond goes to the person
 *   who pays for it.
 *
 *   A clock-in moves either way — arrived earlier than logged, logged on the
 *   drive over — and an hour covers the honest cases in both directions.
 *
 * Whoever pays for the time has no limits: the direct supervisor, the project
 * manager, a manager. They are the ones who fix what the bounds above refuse.
 */

/** An hour, in both directions where a direction is allowed at all. */
export const CLOCK_GRACE_MINUTES = 60;

export type ClockField = "clockIn" | "clockOut";

export type ClockAuthority =
  /** Pays for the time: direct supervisor, project manager, manager. */
  | "unbounded"
  /** On site and answerable for it: the job's lead, or a supervisor. */
  | "bounded"
  /** Anyone else on the job: says what it should be and waits. */
  | "suggest"
  /** Not their clock to touch. */
  | "none";

export type ClockVerdict =
  | { outcome: "allow" }
  | { outcome: "approval"; reason: string }
  | { outcome: "refuse"; reason: string };

/** Whole minutes between two instants, rounded to the nearest. */
export function minutesBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 60_000);
}

export function judgeClockEdit(
  authority: ClockAuthority,
  edit: { field: ClockField; from: Date; to: Date },
): ClockVerdict {
  if (authority === "none") {
    return { outcome: "refuse", reason: "You cannot change clock times." };
  }

  const drift = minutesBetween(edit.from, edit.to);

  // Nothing to decide. Worth answering before anything else so that saving a
  // form without touching the time never asks anybody for approval.
  if (drift === 0) return { outcome: "allow" };

  if (authority === "unbounded") return { outcome: "allow" };

  if (authority === "suggest") {
    return {
      outcome: "approval",
      reason:
        "Your supervisor sees this as a request. Say what happened and it goes to them.",
    };
  }

  // Bounded: the job's lead, or a supervisor.
  if (edit.field === "clockOut" && drift < 0) {
    // Downwards without limit. A crew that forgot to clock out until the
    // morning is the case this exists for, and it can only ever give time back.
    return { outcome: "allow" };
  }

  const over = Math.abs(drift) - CLOCK_GRACE_MINUTES;
  if (over <= 0) return { outcome: "allow" };

  const direction =
    edit.field === "clockOut" ? "adding to a clock-out" : "moving a clock-in";
  return {
    outcome: "approval",
    reason: `${Math.abs(drift)} minutes is more than the hour ${direction} allows. It goes to whoever pays for the time.`,
  };
}

/**
 * Who this person is, as far as a clock is concerned.
 *
 * Rank alone does not answer it. A supervisor is bounded like the lead; the
 * same person is unbounded on a tech who reports to them, because then it is
 * their own payroll they are signing off.
 */
export function clockAuthority(input: {
  /** Scope of job.adjust_time — "ALL" is a manager. */
  scope: string | null;
  /** They are the direct supervisor of the tech whose clock this is. */
  isDirectSupervisor: boolean;
  /** They manage the project this job belongs to. */
  isProjectManager: boolean;
  /** They are leading this job. */
  isLead: boolean;
  /** Rank enough to supervise at all. */
  isSupervisor: boolean;
}): ClockAuthority {
  if (!input.scope) return "none";

  if (
    input.scope === "ALL" ||
    input.isDirectSupervisor ||
    input.isProjectManager
  ) {
    return "unbounded";
  }

  if (input.isLead || input.isSupervisor) return "bounded";

  return "suggest";
}

/**
 * A visit that ends before it starts is not a correction, it is a typo.
 *
 * visitTotals clamps a negative span to zero, so without this the tech is
 * silently paid nothing for the day, jobSpan reports an offsite earlier than
 * its onsite, and the review panel reads "16:00 – 08:00" — with nothing
 * anywhere having refused. Bounded authority makes it reachable: pulling a
 * clock-out back is deliberately unlimited, because that direction can only
 * ever give time back. Past the clock-in it stops being that.
 */
export function clockOrderProblem(
  clockIn: Date,
  clockOut: Date | null,
): string | null {
  if (!clockOut) return null;
  if (clockOut.getTime() <= clockIn.getTime()) {
    return "That would put the clock-out at or before the clock-in.";
  }
  return null;
}
