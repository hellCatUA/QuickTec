import { formatCents, formatHours, type Moneyish, toCents } from "@/lib/money";
import type { PayType, SplitMode } from "@prisma-client";

/**
 * The total tech budget, and the shares that add up to it.
 *
 * The rule this file exists to make true: **the total is the crew's lines
 * added up.** Not a ceiling stored beside them that somebody compares against
 * at payroll and finds a difference in — the same number, reached the same
 * way, from one place.
 *
 * So the total is never stored as money. What is stored is the terms and each
 * tech's share of them, and every figure anybody reads is derived. There is no
 * third number, which means there is nothing to reconcile.
 *
 * Shares are integers in basis points summing to exactly 10 000. That is what
 * turns the invariant from a rule into arithmetic: three techs on $400.00 come
 * out 133.34 / 133.33 / 133.33 because the allocation hands the spare cents
 * out deliberately, not because three roundings happened to agree.
 *
 * No database handle in here on purpose — the budget editor computes the same
 * split in the browser as the server writes, and a preview that disagrees with
 * what gets saved is worse than no preview.
 */

export const BASIS_POINTS = 10_000;

/** One set of pay terms, in the smallest units the arithmetic is exact in. */
export type Terms = {
  payType: PayType;
  /** The flat part. Zero unless FLAT or FLAT_HOURLY. */
  flatCents: number;
  /** How many of this tech's own minutes the flat part covers. */
  flatMinutes: number;
  /** The hourly part. Zero unless HOURLY or FLAT_HOURLY. */
  hourlyCents: number;
};

export const NON_BILLABLE: Terms = {
  payType: "NON_BILLABLE",
  flatCents: 0,
  flatMinutes: 0,
  hourlyCents: 0,
};

// --- reading terms off a row -----------------------------------------------

/** A job's budget, as its columns hold it. */
export function jobTerms(job: {
  budgetType: PayType | null;
  budgetFlat: Moneyish | null;
  budgetFlatHours: Moneyish | null;
  budgetHourly: Moneyish | null;
}): Terms | null {
  if (!job.budgetType) return null;
  return normaliseTerms({
    payType: job.budgetType,
    flatCents: job.budgetFlat ? toCents(job.budgetFlat) : 0,
    flatMinutes: job.budgetFlatHours ? hoursToMinutes(job.budgetFlatHours) : 0,
    hourlyCents: job.budgetHourly ? toCents(job.budgetHourly) : 0,
  });
}

/**
 * One tech's terms, as their assignment holds them.
 *
 * `payRate` carries the flat amount for FLAT and the hourly rate otherwise,
 * which is how every row written before budgets already reads.
 */
export function assignmentTerms(assignment: {
  payType: PayType;
  payRate: Moneyish;
  payFlat?: Moneyish | null;
  payFlatHours?: Moneyish | null;
}): Terms {
  if (assignment.payType === "NON_BILLABLE") return NON_BILLABLE;
  if (assignment.payType === "FLAT") {
    return {
      payType: "FLAT",
      flatCents: toCents(assignment.payRate),
      flatMinutes: 0,
      hourlyCents: 0,
    };
  }
  if (assignment.payType === "HOURLY") {
    return {
      payType: "HOURLY",
      flatCents: 0,
      flatMinutes: 0,
      hourlyCents: toCents(assignment.payRate),
    };
  }
  return {
    payType: "FLAT_HOURLY",
    flatCents: assignment.payFlat ? toCents(assignment.payFlat) : 0,
    flatMinutes: assignment.payFlatHours
      ? hoursToMinutes(assignment.payFlatHours)
      : 0,
    hourlyCents: toCents(assignment.payRate),
  };
}

/** The columns to write for one line of terms. */
export function termsColumns(terms: Terms): {
  payType: PayType;
  payRate: string;
  payFlat: string | null;
  payFlatHours: string | null;
} {
  const money = (cents: number) => (cents / 100).toFixed(2);
  if (terms.payType === "NON_BILLABLE") {
    return { payType: "NON_BILLABLE", payRate: "0", payFlat: null, payFlatHours: null };
  }
  if (terms.payType === "FLAT") {
    return {
      payType: "FLAT",
      payRate: money(terms.flatCents),
      payFlat: null,
      payFlatHours: null,
    };
  }
  if (terms.payType === "HOURLY") {
    return {
      payType: "HOURLY",
      payRate: money(terms.hourlyCents),
      payFlat: null,
      payFlatHours: null,
    };
  }
  return {
    payType: "FLAT_HOURLY",
    payRate: money(terms.hourlyCents),
    payFlat: money(terms.flatCents),
    payFlatHours: (terms.flatMinutes / 60).toFixed(2),
  };
}

function hoursToMinutes(hours: Moneyish): number {
  return Math.round(Number(hours.toString()) * 60);
}

// --- the zero rule ---------------------------------------------------------

/**
 * Zero is not a rate.
 *
 * Somebody typing 0 means "nobody is paid for this", not "multiply by
 * nothing", and half of a Flat + Hourly left at zero is not a special case —
 * it is the simpler type, and storing it as itself keeps a branch out of
 * payroll that would never fire.
 *
 * One step, in the domain, so that no form can forget it: New Job, the budget
 * editor, project defaults and a tech's own default all pass through here.
 */
export function normaliseTerms(raw: Terms): Terms {
  const flatCents = Math.max(0, Math.round(raw.flatCents));
  const hourlyCents = Math.max(0, Math.round(raw.hourlyCents));
  const flatMinutes = Math.max(0, Math.round(raw.flatMinutes));

  if (raw.payType === "NON_BILLABLE") return NON_BILLABLE;
  if (flatCents === 0 && hourlyCents === 0) return NON_BILLABLE;

  if (raw.payType === "FLAT") {
    return { payType: "FLAT", flatCents, flatMinutes: 0, hourlyCents: 0 };
  }
  if (raw.payType === "HOURLY") {
    return { payType: "HOURLY", flatCents: 0, flatMinutes: 0, hourlyCents };
  }

  // FLAT_HOURLY, which collapses when either half is missing.
  if (flatCents === 0) {
    return { payType: "HOURLY", flatCents: 0, flatMinutes: 0, hourlyCents };
  }
  if (hourlyCents === 0) {
    return { payType: "FLAT", flatCents, flatMinutes: 0, hourlyCents: 0 };
  }
  return { payType: "FLAT_HOURLY", flatCents, flatMinutes, hourlyCents };
}

/** What is wrong with these terms, said the way the form should say it. */
export function termsError(terms: Terms): string | null {
  if (terms.payType !== "FLAT_HOURLY") return null;
  if (terms.flatMinutes <= 0) {
    return "Say how many hours the flat amount covers.";
  }
  return null;
}

// --- splitting -------------------------------------------------------------

export type CrewMember = {
  /** The assignment id in practice; only identity and order matter here. */
  id: string;
  isLead: boolean;
  /** Non-billable on a job that pays: a share of nothing. */
  excluded?: boolean;
  /** This tech's own default rate, in cents, for BY_TECH_RATE. */
  defaultRateCents?: number;
  /** Their share, for MANUAL. Ignored by the other modes. */
  basisPoints?: number;
};

/**
 * Who gets what proportion, in basis points summing to exactly 10 000.
 *
 * EVEN is the default and the answer almost every time. BY_TECH_RATE is what
 * a tech's own default rate is for once a job has a budget: it stops deciding
 * the money and starts deciding the proportions, so a lead on a higher rate
 * still comes out ahead of a second-year. MANUAL is for the day somebody
 * carried the job.
 */
export function splitShares(mode: SplitMode, crew: CrewMember[]): number[] {
  return sharesFrom(mode, weightsFor(mode, crew), priorityOrder(crew));
}

/**
 * Weights become shares — except when somebody typed them.
 *
 * A manual split is the number a person entered, and scaling it back up to
 * 10 000 would turn "$40.00 unallocated" into a silent correction. The
 * remainder counter exists precisely so that never happens, so manual shares
 * come back exactly as given and `splitError` is what refuses them.
 */
function sharesFrom(
  mode: SplitMode,
  weights: number[],
  priority: number[],
): number[] {
  if (mode === "MANUAL") return weights;
  return allocate(BASIS_POINTS, weights, priority);
}

/**
 * The proportions themselves, before anything is rounded to a share.
 *
 * Every figure is allocated from these rather than from each other, which is
 * the difference between an even three-way split of $400.00 coming out
 * 133.34 / 133.33 / 133.33 and coming out 133.36 / 133.32 / 133.32. Both add
 * to $400.00; only one of them looks like an even split to the person being
 * paid.
 */
function weightsFor(mode: SplitMode, crew: CrewMember[]): number[] {
  const included = crew.map((member) => !member.excluded);
  if (!included.some(Boolean)) return crew.map(() => 0);

  if (mode === "MANUAL") {
    return crew.map((member, index) =>
      included[index] ? Math.max(0, Math.round(member.basisPoints ?? 0)) : 0,
    );
  }

  const weights = crew.map((member, index) => {
    if (!included[index]) return 0;
    if (mode === "BY_TECH_RATE") return Math.max(0, member.defaultRateCents ?? 0);
    return 1;
  });

  // Everybody on zero — nobody has a default rate recorded — is not a reason
  // to pay nobody. Fall back to equal weights and let the interface say why.
  return weights.some((one) => one > 0)
    ? weights
    : included.map((one) => (one ? 1 : 0));
}

/** What is wrong with this split, said the way the form should say it. */
export function splitError(shares: number[]): string | null {
  const total = shares.reduce((sum, one) => sum + one, 0);
  if (shares.length === 0) return null;
  if (total === 0) {
    return "Nothing is allocated. If nobody is to be paid, set the budget itself to Non-billable.";
  }
  if (total !== BASIS_POINTS) {
    const off = (total - BASIS_POINTS) / 100;
    return off > 0
      ? `The shares come to ${off.toFixed(2)}% more than the budget.`
      : `${(-off).toFixed(2)}% of the budget is unallocated.`;
  }
  return null;
}

/**
 * Hand out `total` in proportion to `weights`, losing nothing.
 *
 * Largest remainder: everybody gets their floor, and the cents left over go to
 * whoever was closest to the next one up. `priority` breaks ties — the lead
 * first, so the odd cent lands somewhere anybody can predict rather than
 * wherever the sort happened to leave it.
 */
export function allocate(
  total: number,
  weights: number[],
  priority?: number[],
): number[] {
  const sum = weights.reduce((running, one) => running + one, 0);
  if (sum <= 0 || total === 0) return weights.map(() => 0);

  const exact = weights.map((weight) => (total * weight) / sum);
  const out = exact.map((value) => Math.floor(value));
  let left = total - out.reduce((running, one) => running + one, 0);

  const rank = new Map<number, number>();
  (priority ?? weights.map((_, index) => index)).forEach((index, place) => {
    rank.set(index, place);
  });

  const order = exact
    .map((value, index) => ({ index, part: value - Math.floor(value) }))
    .filter(({ index }) => weights[index] > 0)
    .sort(
      (a, b) =>
        b.part - a.part ||
        (rank.get(a.index) ?? a.index) - (rank.get(b.index) ?? b.index),
    );

  for (const { index } of order) {
    if (left <= 0) break;
    out[index] += 1;
    left -= 1;
  }

  return out;
}

function priorityOrder(crew: CrewMember[]): number[] {
  return crew
    .map((member, index) => ({ index, lead: member.isLead }))
    .sort((a, b) => Number(b.lead) - Number(a.lead) || a.index - b.index)
    .map(({ index }) => index);
}

/**
 * The crew's lines, from the job's terms.
 *
 * Every money component is allocated across the crew in one pass, so each one
 * adds back to the total exactly — the hourly rate included. Three techs on
 * $80.00/hr come out 26.67 / 26.67 / 26.66, which is $80.00, rather than three
 * times $26.67, which is not.
 */
export function splitTerms(
  total: Terms,
  crew: CrewMember[],
  mode: SplitMode,
): { shares: number[]; lines: Terms[] } {
  const priority = priorityOrder(crew);
  const weights = weightsFor(mode, crew);
  const shares = sharesFrom(mode, weights, priority);

  if (total.payType === "NON_BILLABLE") {
    return { shares, lines: crew.map(() => NON_BILLABLE) };
  }

  // From the weights, never from the shares: rounding a proportion and then
  // rounding money against it rounds twice. The shares below are what gets
  // stored and shown; the money is written at the same moment, so nothing
  // ever has to recover one from the other.
  const flat = allocate(total.flatCents, weights, priority);
  const hourly = allocate(total.hourlyCents, weights, priority);

  const lines = crew.map((_, index) =>
    shares[index] === 0
      ? NON_BILLABLE
      : normaliseTerms({
          payType: total.payType,
          flatCents: flat[index],
          // The flat covers each tech's OWN first hours. Dana leaving early
          // does not hand her unused hours to Terry.
          flatMinutes: total.flatMinutes,
          hourlyCents: hourly[index],
        }),
  );

  return { shares, lines };
}

/** What the crew's lines add up to — which is what "the total" means. */
export function sumTerms(lines: Terms[]): Terms {
  const paid = lines.filter((line) => line.payType !== "NON_BILLABLE");
  if (paid.length === 0) return NON_BILLABLE;
  return normaliseTerms({
    payType: paid[0].payType,
    flatCents: paid.reduce((sum, line) => sum + line.flatCents, 0),
    flatMinutes: paid[0].flatMinutes,
    hourlyCents: paid.reduce((sum, line) => sum + line.hourlyCents, 0),
  });
}

// --- what it comes to ------------------------------------------------------

/**
 * One tech's labour for the minutes they were paid for.
 *
 * FLAT ignores the minutes, which is the point of a flat. FLAT_HOURLY charges
 * the rate only past the hours the flat already covered — for this tech, on
 * their own clock.
 */
export function labourCentsFor(terms: Terms, paidMinutes: number): number {
  if (terms.payType === "NON_BILLABLE") return 0;
  if (terms.payType === "FLAT") return terms.flatCents;
  if (terms.payType === "HOURLY") {
    return Math.round((terms.hourlyCents * paidMinutes) / 60);
  }
  const over = Math.max(0, paidMinutes - terms.flatMinutes);
  return terms.flatCents + Math.round((terms.hourlyCents * over) / 60);
}

/**
 * One set of terms, said in one phrase.
 *
 * Here rather than in money.ts because it reads all three numbers, and the
 * only thing that holds all three is Terms. formatRate takes a single rate and
 * cannot tell a flat amount from an hourly one without being told which slot
 * to look in — which is exactly the kind of guess that prints "$0.00 flat".
 */
export function describeTerms(terms: Terms): string {
  if (terms.payType === "NON_BILLABLE") return "Non-billable";
  if (terms.payType === "FLAT") return `${formatCents(terms.flatCents)} flat`;
  if (terms.payType === "HOURLY") return `${formatCents(terms.hourlyCents)}/hr`;
  return `${formatCents(terms.flatCents)} for ${formatHours(terms.flatMinutes)} hrs, then ${formatCents(terms.hourlyCents)}/hr`;
}

/**
 * Somebody's share dropping under the rate they are normally on.
 *
 * Splitting a job rate is allowed; going quiet about it is not. Only hourly
 * work compares — a flat share has no rate to be under.
 */
export function underOwnRate(
  line: Terms,
  defaultRateCents: number | null,
): boolean {
  if (!defaultRateCents || defaultRateCents <= 0) return false;
  if (line.payType === "NON_BILLABLE" || line.payType === "FLAT") return false;
  return line.hourlyCents < defaultRateCents;
}
