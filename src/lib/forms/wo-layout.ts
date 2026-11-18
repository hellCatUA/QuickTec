/**
 * Where the sign-off goes on a paying company's work order.
 *
 * Some paying companies have no sign-off sheet of their own, and the job still
 * has to come back with something signed. What every job does have is the
 * work order WorkMarket printed for it, and that already carries the places a
 * customer signs: an arrival and a departure time, a box for notes, and a row
 * for a printed name, a signature and a date. This file finds those places.
 *
 * The work orders are generated, so the words are always the same words, but
 * they are rarely laid out well: a header over the logo, a notes box that
 * starts at the foot of one page and carries on at the top of the next, a page
 * count that is wrong. So nothing here is trusted blindly. What it finds is a
 * proposal — three boxes on the page — that a person looks at and moves before
 * anything is saved, and a work order it cannot read still gets the three
 * boxes, parked where somebody can drag them to the right place.
 *
 * Everything is in PDF points from the bottom-left corner of the page, the way
 * pdf.js reports text and pdf-lib draws it, so a box found here is drawn
 * exactly where it was found.
 *
 * Pure: it takes what wo-scan.ts read out of the file and returns numbers. It
 * runs in the browser, where the work order is opened, and in the suites.
 */

/** One run of text as pdf.js reports it: x and y are where its baseline starts. */
export type WoTextItem = {
  text: string;
  x: number;
  y: number;
  width: number;
  /** The font size it was set in, near enough. */
  height: number;
};

/**
 * A thin horizontal line: a ruled line in the notes box, a signature line, a
 * box's border. Real ones arrive as filled rectangles a fraction of a point
 * tall, and occasionally as stroked lines with no height at all.
 */
export type WoRule = { x0: number; x1: number; y0: number; y1: number };

export type WoScanPage = {
  /** The page's own box, so a position on the screen maps onto it. */
  view: [number, number, number, number];
  items: WoTextItem[];
  rules: WoRule[];
};

export type WoScan = { pages: WoScanPage[] };

export type WoRect = {
  /** Zero-based. */
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * Check-in on the top line, check-out on the bottom one. The box spans both,
 * so moving it moves the pair and stretching it changes the gap between them.
 */
export type WoTimesBox = WoRect & { size: number };

/** Lines of text, one per ruled line where the box has them. */
export type WoNotesBox = WoRect & { size: number; pitch: number };

/**
 * One row: printed name at its left edge, the signature `signatureAt` points
 * in, the date `dateAt` points in. The y is the line they are written on.
 */
export type WoApprovalBox = WoRect & {
  size: number;
  signatureAt: number;
  dateAt: number;
};

export type WoOverlay = {
  /** The pages of the first copy. Nothing is ever written on another page. */
  pages: number[];
  times: WoTimesBox;
  notes: WoNotesBox;
  approval: WoApprovalBox;
  /** WorkMarket's own check-in and check-out, painted out before ours go on. */
  covers: WoRect[];
};

/** What was recognised, so the screen can say which boxes were guessed. */
export type WoFound = {
  /** "lines": blank lines to write on. "printed": WorkMarket printed times there. */
  times: "lines" | "printed" | null;
  /** "lines": its ruled lines. "heading": only the heading, the box under it guessed. */
  notes: "lines" | "heading" | null;
  approval: boolean;
  /** Whether the copies were told apart, rather than every page taken as the first. */
  copies: boolean;
};

export type WoLayout = { overlay: WoOverlay; found: WoFound };

export type WoDetectOptions = {
  /**
   * Every page rather than the first copy's. Somebody chooses this on the
   * screen when the copies were told apart wrongly — a work order whose
   * description says "customer copy" somewhere it should not used to end the
   * first copy on page 1, with the signature row out of reach and no way to
   * bring it back.
   */
  everyPage?: boolean;
};

/** How the two time lines sit inside their box, as fractions of the size. */
export const TIMES_ASCENT = 0.8;
export const TIMES_DESCENT = 0.25;
/** A line of writing sits this far above the rule it is written on. */
export const RULE_LIFT = 1.5;
/** How tall the approval row is above its line: room for a signature. */
export const APPROVAL_HEIGHT = 21;

const LETTER: WoScanPage["view"] = [0, 0, 612, 792];

const LABEL_IN = /^Check[- ]?In:/i;
const LABEL_OUT = /^Check[- ]?Out:/i;
const LABEL_EITHER = /^Check[- ]?(?:In|Out):/i;
const ARRIVAL = /^ARRIVAL TIME\b/i;
const DEPARTURE = /^DEPARTURE TIME\b/i;
const NOTES = /^Notes:?$/i;
const SIGNATURE = /^Customer Signature\b/i;
const NAME = /^Customer Name\b/i;
/** Whatever is on a page this reads anything near: the pages worth reading the lines of. */
const ANY_LABEL = [ARRIVAL, DEPARTURE, LABEL_EITHER, NOTES, SIGNATURE, NAME];

/**
 * Words pdf.js handed over one at a time, put back into the runs they were
 * set in.
 *
 * pdf.js starts a new run of text wherever the gap between two words is wider
 * than a space, and some work orders are set with wide spacing: "ARRIVAL
 * TIME", "Customer Signature" and "CUSTOMER COPY" each arrived as two runs and
 * none of them was ever found. Joined here — only words close enough to be the
 * same phrase, and only from the start of such a phrase, since a label starts
 * one — they are found like any other.
 */
const MERGED = new WeakMap<WoScanPage, WoTextItem[]>();

function mergedRuns(page: WoScanPage): WoTextItem[] {
  const cached = MERGED.get(page);
  if (cached) return cached;

  const lines: WoTextItem[][] = [];
  for (const item of [...page.items].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const line = lines.find((candidate) => Math.abs(candidate[0].y - item.y) < 1);
    if (line) line.push(item);
    else lines.push([item]);
  }

  const merged: WoTextItem[] = [];
  for (const line of lines) {
    line.sort((a, b) => a.x - b.x);
    let phrase: WoTextItem[] = [];
    const close = () => {
      for (let length = 2; length <= Math.min(6, phrase.length); length++) {
        const run = phrase.slice(0, length);
        const last = run[run.length - 1];
        merged.push({
          text: run.map((item) => item.text).join(" "),
          x: run[0].x,
          y: run[0].y,
          width: last.x + last.width - run[0].x,
          height: Math.max(...run.map((item) => item.height)),
        });
      }
      phrase = [];
    };
    for (const item of line) {
      const previous = phrase[phrase.length - 1];
      if (previous) {
        const gap = item.x - (previous.x + previous.width);
        // Wider than a word space, narrower than the gap between two columns.
        if (gap < -1 || gap > 1.2 * Math.max(previous.height, item.height, 6)) close();
      }
      phrase.push(item);
    }
    close();
  }

  MERGED.set(page, merged);
  return merged;
}

/** Every run on the page, and then the phrases made of several. */
function labelsOn(page: WoScanPage | undefined): WoTextItem[] {
  return page ? [...page.items, ...mergedRuns(page)] : [];
}

const find = (page: WoScanPage | undefined, pattern: RegExp) =>
  labelsOn(page).find((item) => pattern.test(item.text));

const isRule = (rule: WoRule, minWidth: number) =>
  rule.x1 - rule.x0 >= minWidth && rule.y1 - rule.y0 <= 1.6;

/**
 * "Customer Name (Printed)", "Customer Signature" and "Date", side by side.
 *
 * The name on the same line is what makes it the row. A description line that
 * begins "Customer signature required…" used to be taken for it, and ended the
 * first copy of a one-copy work order a page early.
 */
function approvalLabels(page: WoScanPage | undefined) {
  const all = labelsOn(page);
  for (const signature of all.filter((item) => SIGNATURE.test(item.text))) {
    const name = all.find(
      (item) =>
        NAME.test(item.text) &&
        Math.abs(item.y - signature.y) <= 2 &&
        item.x < signature.x,
    );
    if (!name) continue;
    const date =
      all.find(
        (item) =>
          /^Date:?$/i.test(item.text) &&
          Math.abs(item.y - signature.y) <= 2 &&
          item.x > signature.x,
      ) ?? null;
    return { name, signature, date };
  }
  return null;
}

/**
 * A copy's own heading: the exact words, in the top quarter of the page.
 *
 * Anything looser ends the first copy at a sentence. "CUSTOMER COPY stays
 * with the store manager", at the start of a line of instructions inside the
 * first copy, cut it to page 1, and the notes and the signature row beyond it
 * could not be reached.
 */
function copyHeading(page: WoScanPage, pattern: RegExp): boolean {
  const top = page.view[3] - 0.25 * (page.view[3] - page.view[1]);
  return labelsOn(page).some((item) => pattern.test(item.text) && item.y >= top);
}

/**
 * Which pages are the first copy.
 *
 * A WorkMarket work order is printed three times over — the resource copy the
 * customer signs, the customer's copy, and the instructions — and only the
 * first is signed. It runs to the page before "CUSTOMER COPY"; failing that,
 * to the first page with a signature row. A document with neither is not one
 * of theirs, and every page is fair game.
 */
function firstCopy(
  scan: WoScan,
  options: WoDetectOptions = {},
): { pages: number[]; copies: boolean } {
  const count = scan.pages.length;
  const customerCopy = scan.pages.findIndex((page) => copyHeading(page, /^CUSTOMER COPY$/i));
  const signatureRow = scan.pages.findIndex((page) => approvalLabels(page) !== null);
  const instructions = scan.pages.findIndex((page) =>
    copyHeading(page, /^RESOURCE INSTRUCTIONS$/i),
  );

  let last = count - 1;
  let copies = false;
  if (customerCopy > 0) {
    last = customerCopy - 1;
    copies = true;
  } else if (signatureRow >= 0) {
    last = signatureRow;
    copies = true;
  } else if (instructions > 0) {
    last = instructions - 1;
    copies = true;
  }
  if (options.everyPage) last = count - 1;

  return {
    pages: Array.from({ length: Math.max(1, last + 1) }, (_, index) => index),
    copies,
  };
}

/**
 * The pages whose drawing is worth reading: those with something on them this
 * looks for, and the page after a notes heading, where its lines carry on.
 *
 * Reading a page's drawing decodes every picture on it. A scanned work order
 * is nothing but pictures, and reading all of them to look for ruled lines
 * took a second and a gigabyte for a 23 MB scan, which a phone does not have.
 * Every line this uses is found next to a label, so a page with none has
 * nothing to give.
 */
export function pagesToRead(scan: WoScan, options: WoDetectOptions = {}): number[] {
  const { pages } = firstCopy(scan, options);
  const wanted = new Set<number>();
  for (const index of pages) {
    const all = labelsOn(scan.pages[index]);
    if (all.some((item) => ANY_LABEL.some((pattern) => pattern.test(item.text)))) {
      wanted.add(index);
    }
    if (all.some((item) => NOTES.test(item.text)) && pages.includes(index + 1)) {
      wanted.add(index + 1);
    }
  }
  return [...wanted].sort((a, b) => a - b);
}

/** A box spanning two baselines, the way the filler reads it back. */
function timesBox(
  page: number,
  x: number,
  width: number,
  top: number,
  bottom: number,
  size: number,
): WoTimesBox {
  const y = bottom - TIMES_DESCENT * size;
  return {
    page,
    x,
    y,
    width,
    height: top + TIMES_ASCENT * size - y,
    size,
  };
}

/** The line written on under a label: the nearest rule below it, if drawn. */
function lineUnder(page: WoScanPage, label: WoTextItem): WoRule | null {
  return (
    page.rules
      .filter(
        (rule) =>
          isRule(rule, 30) &&
          rule.x0 >= label.x - 8 &&
          rule.x0 <= label.x + 24 &&
          rule.y1 <= label.y - 2 &&
          rule.y1 >= label.y - 24,
      )
      .sort((a, b) => b.y1 - a.y1)[0] ?? null
  );
}

/**
 * Check-in and check-out.
 *
 * Two layouts turn up. Where WorkMarket has no times for the job it prints
 * "ARRIVAL TIME" and "DEPARTURE TIME" over blank lines ending in "AM/PM", and
 * the times are written on the lines. Where it does, it prints "Check-In:" and
 * "Check-Out:" with its own times after them — the ones the tech's phone
 * reported, which are as often as not the wrong day — and those are painted
 * out and ours written in their place.
 */
function findTimes(
  scan: WoScan,
  pages: number[],
): { box: WoTimesBox; covers: WoRect[]; found: WoFound["times"] } | null {
  for (const index of pages) {
    const page = scan.pages[index];
    const arrival = find(page, ARRIVAL);
    const departure = find(page, DEPARTURE);
    if (arrival && departure && departure.y < arrival.y) {
      const lines = [arrival, departure].map((label) => {
        const rule = lineUnder(page, label);
        const amPm = page.items.find(
          (item) =>
            /^AM\s*\/\s*PM$/i.test(item.text) &&
            item.x > label.x &&
            item.y < label.y - 3 &&
            item.y > label.y - 22,
        );
        // Without a drawn line the "AM/PM" printed at its end says where it
        // is: its baseline sits a few points above the rule.
        const base = rule ? rule.y1 : amPm ? amPm.y - 4.4 : label.y - 15;
        const left = rule ? rule.x0 : label.x;
        const right = rule ? rule.x1 : amPm ? amPm.x - 4 : label.x + 90;
        return { baseline: base + RULE_LIFT, left, right };
      });

      const x = Math.min(lines[0].left, lines[1].left) + 2;
      const right = Math.min(lines[0].right, lines[1].right);
      return {
        box: timesBox(index, x, Math.max(40, right - x), lines[0].baseline, lines[1].baseline, 10),
        covers: [],
        found: "lines",
      };
    }

    // The colon matters: the same box is headed "CHECK IN / OUT TIMES" and
    // "CHECK IN REQUIRED", and taking either for the label put our times over
    // the heading.
    const checkIn = find(page, LABEL_IN);
    const checkOut = find(page, LABEL_OUT);
    if (checkIn && checkOut && checkOut.y < checkIn.y && Math.abs(checkIn.x - checkOut.x) < 12) {
      const gap = checkIn.y - checkOut.y;
      // The label's own width. Usually a run of its own; when the value came
      // in the same run, the label's share of it by characters.
      const labelEnd = (item: WoTextItem) => {
        const label = LABEL_EITHER.exec(item.text)?.[0] ?? item.text;
        return item.x + item.width * (label.length / Math.max(1, item.text.length));
      };

      // The box the two labels sit in, by its own lines: the rule under its
      // heading, above Check-In, and its border under Check-Out. Its right
      // edge is as far as WorkMarket's times can reach. Without one the reach
      // used to be a flat 220 points, which painted out a second column on
      // the same lines — a site contact, a phone number, a ticket — and left
      // a time set further out than that beside ours.
      const spans = (rule: WoRule, label: WoTextItem) =>
        rule.x0 <= label.x + 10 && rule.x1 >= label.x + 40;
      const above = page.rules
        .filter(
          (rule) => spans(rule, checkIn) && rule.y0 > checkIn.y + 2 && rule.y0 < checkIn.y + 30,
        )
        .sort((a, b) => a.y0 - b.y0)[0];
      const below = page.rules
        .filter((rule) => spans(rule, checkOut) && rule.y1 < checkOut.y - 2)
        .sort((a, b) => b.y1 - a.y1)[0];
      const border = below?.y1 ?? -Infinity;
      const pageRight = page.view[2] - 36;
      const reach = above?.x1 ?? below?.x1 ?? pageRight;

      // The value after a label: its first run anywhere in the column, then
      // only the runs that carry straight on from it. A gap wider than a few
      // spaces is the next thing on the line, not more of the time.
      const value = (label: WoTextItem): WoTextItem[] => {
        const start = labelEnd(label);
        const kept: WoTextItem[] =
          label.text.replace(LABEL_EITHER, "").trim() !== ""
            ? [{ ...label, x: start, width: label.x + label.width - start }]
            : [];
        let end = kept.length > 0 ? label.x + label.width : null;
        const runs = page.items
          .filter(
            (item) =>
              item !== label &&
              Math.abs(item.y - label.y) < 1.5 &&
              item.x >= start - 1 &&
              item.x < reach,
          )
          .sort((a, b) => a.x - b.x);
        for (const item of runs) {
          if (end !== null && item.x - end > Math.max(12, 1.5 * (item.height || 9))) break;
          kept.push(item);
          end = Math.max(end ?? item.x, item.x + item.width);
        }
        return kept;
      };

      const inValue = value(checkIn);
      const outValue = value(checkOut);
      const outEnd = Math.max(
        labelEnd(checkOut),
        ...outValue.map((item) => item.x + item.width),
      );
      // A value too long for the column wraps under the label — "PDT" on a
      // line of its own. Only directly under the label, only one line's
      // worth, never past the box's own border, never a label of its own, and
      // only what could not have fitted on the line it continues: a third line
      // reading "Total: 4.30 hrs" was painted out as the end of a time.
      const space = 0.28 * (checkOut.height || 9);
      const wrapped = page.items.filter(
        (item) =>
          item.y > border &&
          item.y < checkOut.y - gap * 0.5 &&
          item.y > checkOut.y - gap * 1.6 &&
          Math.abs(item.x - checkOut.x) <= 3 &&
          item.text.length <= 24 &&
          !/^[A-Za-z][A-Za-z .]*:/.test(item.text) &&
          !/:$/.test(item.text) &&
          outEnd + space + item.width > reach,
      );

      const covered = [...inValue, ...outValue, ...wrapped];
      const covers = covered.map((item) => {
        const height = item.height || 9;
        return {
          page: index,
          x: item.x - 0.6,
          y: item.y - height * 0.28,
          width: item.width + 1.2,
          height: height * 1.18,
        };
      });

      const size = Math.round(Math.min(11, Math.max(7, checkIn.height || 9)) * 2) / 2;
      const x = Math.max(labelEnd(checkIn), labelEnd(checkOut)) + 4;
      const right = Math.min(
        Math.max(x + 90, ...covered.map((item) => item.x + item.width)),
        reach + 4,
        pageRight,
      );
      return {
        box: timesBox(index, x, Math.max(60, right - x), checkIn.y, checkOut.y, size),
        covers,
        found: "printed",
      };
    }
  }
  return null;
}

/**
 * The longest run of evenly spaced, equally long rules: the ruled lines of a
 * notes box. A box's own border is two rules of the same length too, but a
 * hundred points apart rather than ten, so it never makes a run.
 */
function ruledRun(rules: WoRule[], like?: { x0: number; x1: number }): WoRule[] {
  const groups = new Map<string, WoRule[]>();
  for (const rule of rules) {
    if (like && (Math.abs(rule.x0 - like.x0) > 3 || Math.abs(rule.x1 - like.x1) > 3)) {
      continue;
    }
    const key = `${Math.round(rule.x0 / 3)}:${Math.round(rule.x1 / 3)}`;
    groups.set(key, [...(groups.get(key) ?? []), rule]);
  }

  let best: WoRule[] = [];
  for (const group of groups.values()) {
    const sorted = [...group].sort((a, b) => b.y1 - a.y1);
    for (let start = 0; start < sorted.length; start++) {
      const run = [sorted[start]];
      let pitch: number | null = null;
      for (let next = start + 1; next < sorted.length; next++) {
        const step = run[run.length - 1].y1 - sorted[next].y1;
        if (step < 0.5) continue; // the same line drawn twice
        if (pitch === null) {
          if (step < 6 || step > 22) break;
          pitch = step;
        } else if (Math.abs(step - pitch) > 1) {
          break;
        }
        run.push(sorted[next]);
      }
      // Longest wins; on a tie the higher one, which is the one nearer its
      // heading.
      if (run.length > best.length) best = run;
    }
  }
  return best.length >= 2 ? best : [];
}

function notesFromRun(page: number, run: WoRule[]): WoNotesBox {
  const pitch = (run[0].y1 - run[run.length - 1].y1) / (run.length - 1);
  const x0 = Math.min(...run.map((rule) => rule.x0));
  const x1 = Math.max(...run.map((rule) => rule.x1));
  return {
    page,
    x: x0,
    y: run[run.length - 1].y1,
    width: x1 - x0,
    height: pitch * run.length,
    size: Math.min(9.5, Math.max(7, Math.round(pitch * 0.84 * 2) / 2)),
    pitch,
  };
}

/**
 * The notes box: the ruled lines under "Notes".
 *
 * On a long work order it begins at the foot of a page with room for three
 * lines and carries on at the top of the next; the part with more lines is
 * used, since a box split over two pages is two places to read one note.
 *
 * Every "Notes" in the first copy is tried, in order, for one with lines under
 * it. Only the first used to be, and a "Notes" line in the job's description
 * won: the note was printed over the description while the real box stayed
 * empty, and the screen said it had been found.
 */
function findNotes(
  scan: WoScan,
  pages: number[],
): { box: WoNotesBox; found: WoFound["notes"] } | null {
  const headings = pages.flatMap((index) =>
    labelsOn(scan.pages[index])
      .filter((item) => NOTES.test(item.text))
      .sort((a, b) => b.y - a.y)
      .map((heading) => ({ index, heading })),
  );

  for (const { index, heading } of headings) {
    const box = notesUnder(scan, pages, index, heading);
    if (box) return { box, found: "lines" };
  }

  // No lines under any of them: the box is taken to start under the one set
  // largest, which is the section's heading rather than a word in a sentence.
  const chosen = [...headings].sort((a, b) => b.heading.height - a.heading.height)[0];
  if (!chosen) return null;
  const page = scan.pages[chosen.index];
  const top = chosen.heading.y - 8;
  const pitch = 11;
  const lines = Math.max(3, Math.min(10, Math.floor((top - page.view[1] - 50) / pitch)));
  const x = chosen.heading.x + 6;
  return {
    box: {
      page: chosen.index,
      x,
      y: top - lines * pitch,
      width: Math.min(510, page.view[2] - x - 40),
      height: lines * pitch,
      size: 9,
      pitch,
    },
    found: "heading",
  };
}

/** The ruled lines under one notes heading, on its page or carried on to the next. */
function notesUnder(
  scan: WoScan,
  pages: number[],
  index: number,
  heading: WoTextItem,
): WoNotesBox | null {
  const page = scan.pages[index];
  const below = page.rules.filter(
    (rule) =>
      isRule(rule, 150) &&
      rule.y1 < heading.y - 2 &&
      // Lines under the bottom margin were cut off by the page and never
      // printed; one Trison work order drew a fifth that nobody can see.
      rule.y0 >= page.view[1] + 30,
  );
  let here = ruledRun(below);
  // Its own lines start right under its heading; a ruled table further down
  // the page is something else.
  if (here.length > 0 && heading.y - here[0].y1 > 40) here = [];

  const nextIndex = index + 1;
  const next = pages.includes(nextIndex) ? scan.pages[nextIndex] : undefined;
  let there: WoRule[] = [];
  if (next) {
    const top = next.rules.filter(
      (rule) => isRule(rule, 150) && rule.y1 <= next.view[3] - 30,
    );
    const run = ruledRun(top, here[0]);
    // Only a continuation: empty lines in the top half of the page, not a
    // table with writing in it somewhere further down.
    const empty =
      run.length > 0 &&
      !next.items.some(
        (item) => item.y > run[run.length - 1].y1 - 0.5 && item.y < run[0].y1 + 6,
      );
    const high = run.length > 0 && run[0].y1 > (next.view[1] + next.view[3]) / 2;
    if (empty && high) there = run;
  }

  if (here.length === 0 && there.length === 0) return null;
  return there.length > here.length ? notesFromRun(nextIndex, there) : notesFromRun(index, here);
}

/**
 * "Customer Name (Printed)", "Customer Signature" and "Date", side by side
 * under their lines. Everything is written on the line, above the label.
 */
function findApproval(
  scan: WoScan,
  pages: number[],
): WoApprovalBox | null {
  for (const index of pages) {
    const page = scan.pages[index];
    const row = approvalLabels(page);
    if (!row) continue;
    const { name, signature, date } = row;

    const lineOver = (label: WoTextItem) =>
      page.rules.find(
        (rule) =>
          isRule(rule, 40) &&
          Math.abs(rule.x0 - label.x) <= 4 &&
          rule.y0 >= label.y + 3 &&
          rule.y0 <= label.y + 16,
      ) ?? null;

    const lines = [name, signature, date].map((label) => (label ? lineOver(label) : null));
    const drawn = lines.filter((line): line is WoRule => line !== null);
    const y = drawn.length > 0 ? Math.max(...drawn.map((line) => line.y1)) : name.y + 9;

    const signatureAt = signature.x - name.x;
    const dateAt = date ? date.x - name.x : signatureAt * 2;
    const right = lines[2]?.x1 ?? (date ? date.x + 140 : name.x + dateAt + 140);
    return {
      page: index,
      x: name.x,
      y,
      width: Math.min(right, page.view[2] - 20) - name.x,
      height: APPROVAL_HEIGHT,
      size: 10,
      signatureAt,
      dateAt,
    };
  }
  return null;
}

const overlaps = (a: WoRect, b: WoRect, margin = 4) =>
  a.page === b.page &&
  a.x < b.x + b.width + margin &&
  b.x < a.x + a.width + margin &&
  a.y < b.y + b.height + margin &&
  b.y < a.y + a.height + margin;

/**
 * A parked box moved clear of the others on its page: down a line at a time,
 * then up. On a one-page document the notes and the signature row were both
 * parked low on page 1, one on top of the other, and the one underneath could
 * not be got at to drag it away.
 */
function clearOf<T extends WoRect>(box: T, others: WoRect[], view: WoScanPage["view"]): T {
  if (!others.some((other) => overlaps(box, other))) return box;
  const step = 12;
  const lowest = view[1] + 10;
  const highest = view[3] - box.height - 10;
  const tries: number[] = [];
  for (let y = box.y - step; y >= lowest; y -= step) tries.push(y);
  for (let y = box.y + step; y <= highest; y += step) tries.push(y);
  for (const y of tries) {
    const moved = { ...box, y };
    if (!others.some((other) => overlaps(moved, other))) return moved;
  }
  return box;
}

/** Reads the three places out of a work order, and parks whatever it cannot. */
export function detectWoLayout(scan: WoScan, options: WoDetectOptions = {}): WoLayout {
  const { pages, copies } = firstCopy(scan, options);
  const lastPage = pages[pages.length - 1];
  const view = (index: number) => scan.pages[index]?.view ?? LETTER;

  const times = findTimes(scan, pages);
  const notes = findNotes(scan, pages);
  const approval = findApproval(scan, pages);

  // Where nothing was found, a box is parked where that part usually is, so
  // there is something on the page to drag rather than a blank to explain.
  const first = view(0);
  const timesBoxDefault = timesBox(
    0,
    first[2] - 182,
    140,
    first[3] - 150,
    first[3] - 164,
    10,
  );
  const notesDefault: WoNotesBox = {
    page: 0,
    x: first[0] + 50,
    y: first[1] + 100,
    width: first[2] - first[0] - 100,
    height: 88,
    size: 9,
    pitch: 11,
  };
  const end = view(lastPage);
  const approvalDefault: WoApprovalBox = {
    page: lastPage,
    x: end[0] + 46,
    y: end[1] + 160,
    width: 474,
    height: APPROVAL_HEIGHT,
    size: 10,
    signatureAt: 164,
    dateAt: 328,
  };

  // What was found stays where it was found; what was parked moves out of
  // its way, the times first, then the notes, then the signature row.
  const placed: WoRect[] = [times?.box, notes?.box, approval].filter(
    (box): box is NonNullable<typeof box> => Boolean(box),
  );
  const park = <T extends WoRect>(found: T | null | undefined, fallback: T): T => {
    if (found) return found;
    const parked = clearOf(fallback, placed, view(fallback.page));
    placed.push(parked);
    return parked;
  };

  return {
    overlay: {
      pages,
      times: park(times?.box, timesBoxDefault),
      notes: park(notes?.box, notesDefault),
      approval: park(approval, approvalDefault),
      covers: times?.covers ?? [],
    },
    found: {
      times: times?.found ?? null,
      notes: notes?.found ?? null,
      approval: approval !== null,
      copies,
    },
  };
}
