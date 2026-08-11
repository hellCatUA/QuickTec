/**
 * Why a punch was touched.
 *
 * A free-text box produces "fixed", "per John", and forty spellings of "forgot
 * to clock out", which is unreadable a month later and unaddable-up ever. These
 * are the answers, grouped by whose fault it was — ours, the company that
 * issued the work, or the client — because that grouping is the one somebody
 * eventually has to argue from when a client queries an invoice.
 *
 * The three lists differ because the questions differ. Nobody removes a punch
 * because somebody forgot to make one, and nobody adds one because the job was
 * cancelled.
 */

export type PunchAction = "adjust" | "remove" | "add";

export type PunchReason = {
  /** Stored. Stable — the label may be reworded, this must not be. */
  code: string;
  /** Whose side it happened on. */
  party: "QuickTec" | "RepCompany" | "Client";
  /** What happened, as it reads in the picker. */
  what: string;
};

function reason(code: string): PunchReason {
  const [party, ...rest] = code.split("/");
  return {
    code,
    party: party as PunchReason["party"],
    what: rest.join("/"),
  };
}

export const ADJUST_REASONS: PunchReason[] = [
  "QuickTec/Adjust to time worked",
  "QuickTec/Forgot to punch",
  "QuickTec/Unapproved OE",
  "QuickTec/Error/App",
  "QuickTec/Other",
  "RepCompany/Adjust to time worked",
  "RepCompany/Forgot to punch",
  "RepCompany/Unapproved OE",
  "RepCompany/Other",
  "Client/Adjust to time worked",
  "Client/Unapproved OE",
  "Client/Other",
].map(reason);

export const REMOVE_REASONS: PunchReason[] = [
  "QuickTec/Error/Personnel",
  "QuickTec/Error/Schedule",
  "QuickTec/Error/App",
  "QuickTec/Job Re-scheduled",
  "QuickTec/Job Failed",
  "QuickTec/Job Cancelled",
  "QuickTec/Job Aborted",
  "QuickTec/Other",
  "RepCompany/Job Re-scheduled",
  "RepCompany/Job Failed",
  "RepCompany/Job Cancelled",
  "RepCompany/Job Aborted",
  "RepCompany/Other",
  "Client/Job Re-scheduled",
  "Client/Job Failed",
  "Client/Job Cancelled",
  "Client/Job Aborted",
  "Client/Other",
].map(reason);

export const ADD_REASONS: PunchReason[] = [
  "QuickTec/Adjust to time worked",
  "QuickTec/Forgot to punch",
  "QuickTec/Error/App",
  "QuickTec/Other",
].map(reason);

export function reasonsFor(action: PunchAction): PunchReason[] {
  if (action === "remove") return REMOVE_REASONS;
  if (action === "add") return ADD_REASONS;
  return ADJUST_REASONS;
}

export function isPunchReason(action: PunchAction, code: string): boolean {
  return reasonsFor(action).some((entry) => entry.code === code);
}

/**
 * "Other" is not an answer, it is a promise to write one.
 *
 * Everything else names what happened well enough to be counted; Other is the
 * row somebody reaches for when none of them fit, and without the note it is
 * the same unreadable free text the list exists to replace.
 */
export function noteRequired(code: string): boolean {
  return code.endsWith("/Other");
}

export function punchReasonProblem(
  action: PunchAction,
  code: string,
  note: string | null,
): string | null {
  if (!code) return "Choose a reason.";
  if (!isPunchReason(action, code)) return "That is not one of the reasons.";
  if (noteRequired(code) && !note?.trim()) {
    return "Other needs a note saying what actually happened.";
  }
  return null;
}

/** How a reason and its note read on a timeline, in one line. */
export function describeReason(
  code: string | null,
  note: string | null,
): string | null {
  if (!code && !note) return null;
  if (!code) return note;
  return note?.trim() ? `${code} — ${note.trim()}` : code;
}

/** The company's own name is configurable; the stored codes are not. */
export function reasonLabel(entry: PunchReason, companyName: string): string {
  const party =
    entry.party === "QuickTec"
      ? companyName
      : entry.party === "RepCompany"
        ? "Representing company"
        : "Client";
  return `${party} · ${entry.what}`;
}
