/**
 * What a formatting button does to the text in the box.
 *
 * Kept away from React and the DOM on purpose. Everything that can go wrong in
 * a toolbar goes wrong here — a marker stripped one character short, a bullet
 * stacked on a bullet, a selection that lands in the punctuation instead of the
 * word — and none of it needs a browser to catch. The component below this does
 * two things only: read the selection out of a textarea, and put an `Edit` back
 * in.
 *
 * Every function returns a replacement rather than a whole new string, because
 * the component applies it through the browser's own insert command. That is
 * what keeps ⌘Z working: writing `textarea.value` directly throws the undo
 * history away, and a toolbar people cannot undo is a toolbar people work
 * around.
 *
 * Nothing here writes syntax the scope parser cannot read. That rule is what
 * decides which buttons exist at all — a button for something the renderer
 * ignores is worse than no button, because it looks like it worked.
 */

/** Replace `[from, to)` with `insert`, then put the selection where it says. */
export type Edit = {
  from: number;
  to: number;
  insert: string;
  /** Offsets into the text *after* the replacement. */
  selectionStart: number;
  selectionEnd: number;
};

export type InlineMark = "bold" | "italic" | "highlight" | "strike" | "code";
export type BlockKind =
  | "checklist"
  | "bullet"
  | "numbered"
  | "heading"
  | "quote";

const MARKERS: Record<InlineMark, string> = {
  bold: "**",
  italic: "*",
  highlight: "==",
  strike: "~~",
  code: "`",
};

/** For tests and for the fallback path where the insert command is refused. */
export function applyEdit(text: string, edit: Edit): string {
  return text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
}

/**
 * Whether `marker` really starts at `at`, rather than a longer run of the same
 * character.
 *
 * Italic is one star and bold is two, so without this, pressing italic on a
 * word already in bold peels one star off each side and silently turns it
 * italic. The parser reads `**` first too, so this matches what gets rendered.
 */
function markerAt(text: string, at: number, marker: string): boolean {
  if (at < 0 || text.slice(at, at + marker.length) !== marker) return false;
  if (marker !== "*") return true;
  return text[at - 1] !== "*" && text[at + 1] !== "*";
}

/**
 * Pulls a selection back off whitespace and off a line's own block marker.
 *
 * Shift+Home, a triple click and select-all all take the whole line, marker
 * included, and wrapping that gives `**- [ ] Fit the bracket**` — which the
 * parser reads as a paragraph, so the line silently stops being something the
 * crew can tick. Trailing spaces go the same way: markers with a space inside
 * them do not render at all.
 */
function narrow(text: string, start: number, end: number) {
  while (start < end && /\s/.test(text[start])) start++;
  while (end > start && /\s/.test(text[end - 1])) end--;

  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  const lineBreak = text.indexOf("\n", lineStart);
  const line = text.slice(
    lineStart,
    lineBreak === -1 ? text.length : lineBreak,
  );

  for (const { pattern } of BLOCK_PATTERNS) {
    const match = pattern.exec(line);
    if (!match) continue;
    const bodyStart = lineStart + match[0].length;
    if (start < bodyStart) start = Math.min(bodyStart, end);
    break;
  }

  return { start, end };
}

/**
 * Bold, italic, highlight, strike, code — on if it is off, off if it is on.
 *
 * Three cases, and the second is the one that makes it feel right: after
 * wrapping, the selection sits on the word rather than on the word plus its
 * markers, so pressing the same button again takes it straight back off.
 */
export function toggleInline(
  text: string,
  from: number,
  to: number,
  mark: InlineMark,
): Edit {
  const marker = MARKERS[mark];
  const { start, end } = narrow(text, from, to);
  const selected = text.slice(start, end);

  // The markers are inside the selection: "**word**" picked whole.
  if (
    selected.length >= marker.length * 2 &&
    markerAt(selected, 0, marker) &&
    markerAt(selected, selected.length - marker.length, marker)
  ) {
    const inner = selected.slice(marker.length, selected.length - marker.length);
    return {
      from: start,
      to: end,
      insert: inner,
      selectionStart: start,
      selectionEnd: start + inner.length,
    };
  }

  // The markers are just outside it: "word" picked out of "**word**".
  if (
    markerAt(text, start - marker.length, marker) &&
    markerAt(text, end, marker)
  ) {
    return {
      from: start - marker.length,
      to: end + marker.length,
      insert: selected,
      selectionStart: start - marker.length,
      selectionEnd: start - marker.length + selected.length,
    };
  }

  // Nothing selected: leave the caret between the markers so typing carries on
  // inside them.
  return {
    from: start,
    to: end,
    insert: `${marker}${selected}${marker}`,
    selectionStart: start + marker.length,
    selectionEnd: start + marker.length + selected.length,
  };
}

/** A link, with the caret left where the next thing is typed. */
export function insertLink(text: string, start: number, end: number): Edit {
  const selected = text.slice(start, end);

  return {
    from: start,
    to: end,
    insert: `[${selected}]()`,
    // With a label already, the address is what is missing; without one, the
    // label is.
    selectionStart: selected ? start + selected.length + 3 : start + 1,
    selectionEnd: selected ? start + selected.length + 3 : start + 1,
  };
}

// Checklist before bullet: "- [ ] x" is also a bullet, and reading it as one
// would leave the box behind when somebody switches the line to plain bullets.
const BLOCK_PATTERNS: { kind: BlockKind; pattern: RegExp }[] = [
  { kind: "checklist", pattern: /^(\s*)[-*+][ \t]+\[[ xX]\][ \t]?/ },
  { kind: "bullet", pattern: /^(\s*)[-*+][ \t]+/ },
  { kind: "numbered", pattern: /^(\s*)\d+[.)][ \t]+/ },
  { kind: "heading", pattern: /^(\s*)#{1,6}[ \t]+/ },
  { kind: "quote", pattern: /^(\s*)>[ \t]?/ },
];

/** Which kind of line this already is, if any. */
export function blockKindOf(line: string): BlockKind | null {
  for (const { kind, pattern } of BLOCK_PATTERNS) {
    if (pattern.test(line)) return kind;
  }
  return null;
}

/** The line without whatever block marker it carries. Indent is kept. */
function stripBlock(line: string): string {
  for (const { pattern } of BLOCK_PATTERNS) {
    const match = pattern.exec(line);
    if (match) return match[1] + line.slice(match[0].length);
  }
  return line;
}

function indentOf(line: string): string {
  return /^(\s*)/.exec(line)?.[1] ?? "";
}

function prefixFor(kind: BlockKind, position: number): string {
  switch (kind) {
    case "checklist":
      return "- [ ] ";
    case "bullet":
      return "- ";
    case "numbered":
      return `${position + 1}. `;
    case "heading":
      return "## ";
    case "quote":
      return "> ";
  }
}

/** The lines the selection touches, even partly. */
function lineRange(text: string, start: number, end: number) {
  const from = text.lastIndexOf("\n", start - 1) + 1;
  const next = text.indexOf("\n", end);
  return { from, to: next === -1 ? text.length : next };
}

/**
 * Checklist, bullets, numbering, heading, quote — over every line the selection
 * touches.
 *
 * Kinds replace each other rather than stacking: a bullet line asked to become
 * a checklist becomes `- [ ] `, never `- - [ ] `. Asking for the kind the lines
 * already are takes the marker off, which is the only way back out without
 * editing punctuation by hand.
 *
 * Toggling a checklist off drops the box, not the tick: ticks are stored
 * against the job, keyed by the line's own words, so they survive the round
 * trip if the line comes back.
 */
export function toggleBlock(
  text: string,
  start: number,
  end: number,
  kind: BlockKind,
): Edit {
  const { from, to } = lineRange(text, start, end);
  const lines = text.slice(from, to).split("\n");

  const written = lines.filter((line) => line.trim() !== "");
  // All blank counts as "put one on": pressing checklist in an empty box is
  // asking for the first line of a checklist.
  const alreadyThis =
    written.length > 0 && written.every((line) => blockKindOf(line) === kind);

  let position = 0;
  const next = lines.map((line) => {
    const bare = stripBlock(line);
    if (alreadyThis) return bare;
    if (bare.trim() === "" && lines.length > 1) return bare;

    const body = bare.slice(indentOf(bare).length);
    return `${indentOf(bare)}${prefixFor(kind, position++)}${body}`;
  });

  const insert = next.join("\n");

  // A caret rather than a selection keeps being a caret, at the end of its own
  // line; a selection grows to hold everything the press changed, so the same
  // button undoes it.
  if (start === end) {
    const which = text.slice(from, start).split("\n").length - 1;
    const caret = from + next.slice(0, which + 1).join("\n").length;
    return { from, to, insert, selectionStart: caret, selectionEnd: caret };
  }

  return {
    from,
    to,
    insert,
    selectionStart: from,
    selectionEnd: from + insert.length,
  };
}

/**
 * What Enter should do inside a list.
 *
 * The part somebody who has never written Markdown actually notices: after the
 * first line they never touch the bar again, because the next box is already
 * there. Enter on a line holding nothing but its marker takes the marker off
 * instead, which is how you get back out without deleting punctuation.
 *
 * Returns null when the caret is not in a list, and Enter does its ordinary
 * job.
 */
export function continueList(text: string, caret: number): Edit | null {
  const from = text.lastIndexOf("\n", caret - 1) + 1;
  const line = text.slice(from, caret);

  const kind = blockKindOf(line);
  if (kind === null || kind === "heading") return null;

  const bare = stripBlock(line);
  if (bare.trim() === "") {
    // Nothing but the marker: leave the list, keeping the line.
    return {
      from,
      to: caret,
      insert: bare,
      selectionStart: from + bare.length,
      selectionEnd: from + bare.length,
    };
  }

  const indent = indentOf(line);
  const numbered = /^\s*(\d+)[.)]/.exec(line);
  // Carried on unticked, always: the next thing to do has not been done.
  const marker = numbered
    ? `${Number(numbered[1]) + 1}. `
    : prefixFor(kind, 0);

  const insert = `\n${indent}${marker}`;
  return {
    from: caret,
    to: caret,
    insert,
    selectionStart: caret + insert.length,
    selectionEnd: caret + insert.length,
  };
}
