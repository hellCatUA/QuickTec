import type { PDFFont } from "pdf-lib";

/**
 * Text going onto somebody else's PDF, in the shape the standard fonts allow.
 *
 * Kept apart from the filler so the work-order overlay can use it in the
 * browser as well: that screen draws its own preview on the phone, and the
 * filler imports the disk and sharp, which a browser has neither of.
 */

/**
 * Drops what a standard PDF font cannot draw.
 *
 * The fonts built into every PDF reader cover WinAnsi and nothing else, and
 * pdf-lib throws rather than substituting. Real data arrives with curly quotes
 * and en dashes from Word, and a form that fails to generate because somebody
 * pasted a smart apostrophe is not a form.
 */
export function toWinAnsi(text: string): string {
  return (
    text
      .replace(/[‘’‛]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[–—]/g, "-")
      .replace(/…/g, "...")
      .replace(/ /g, " ")
      .replace(/[•●]/g, "-")
      // Anything left outside Latin-1 would throw on draw. A character we
      // cannot render is better shown as a gap somebody can see than as a
      // failure to produce the form at all.
      .replace(/[^\x09\x0A\x0D\x20-\xFF]/g, "")
  );
}

/** Greedy wrap, breaking inside a word only when the word alone will not fit. */
export function wrapText(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string[] {
  const lines: string[] = [];

  for (const paragraph of text.split(/\r?\n/)) {
    if (paragraph.trim() === "") {
      lines.push("");
      continue;
    }

    let current = "";
    for (const word of paragraph.split(/\s+/)) {
      if (word === "") continue;
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        current = candidate;
        continue;
      }

      if (current) lines.push(current);

      if (font.widthOfTextAtSize(word, size) <= maxWidth) {
        current = word;
        continue;
      }

      // A single word wider than the box — a long URL or a tracking number.
      let chunk = "";
      for (const character of word) {
        if (font.widthOfTextAtSize(chunk + character, size) > maxWidth) {
          lines.push(chunk);
          chunk = character;
        } else {
          chunk += character;
        }
      }
      current = chunk;
    }

    lines.push(current);
  }

  return lines;
}

/**
 * The largest size, down to a floor, at which one line of text fits a width.
 * A time or a name that does not fit is drawn smaller, never cut: a cut-off
 * "12:45 P" on a signed document is worse than a small one.
 */
export function sizeToFit(
  text: string,
  font: PDFFont,
  size: number,
  width: number,
  floor = 5,
): number {
  let fitted = size;
  while (fitted > floor && font.widthOfTextAtSize(text, fitted) > width) {
    fitted -= 0.25;
  }
  return Math.max(floor, fitted);
}
