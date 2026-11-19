import type { PDFFont } from "pdf-lib";

/**
 * Text going onto somebody else's PDF, in the shape the standard fonts allow.
 *
 * Kept apart from the filler so the work-order overlay can use it in the
 * browser as well: that screen draws its own preview on the phone, and the
 * filler imports the disk and sharp, which a browser has neither of.
 */

/**
 * The punctuation Word puts in, set back to what a typewriter would have. The
 * font could draw most of it; straight is what the rest of the form uses.
 */
const TYPOGRAPHIC: [RegExp, string][] = [
  [/[\u2018\u2019\u201B\u201A\u2032]/g, "'"],
  [/[\u201C\u201D\u201E\u2033]/g, '"'],
  // Dashes, hyphens and the minus sign: "−42 dBm" printed "42 dBm".
  [/[\u2010\u2011\u2012\u2013\u2014\u2212]/g, "-"],
  [/\u2026/g, "..."],
  // Every width of space, the narrow one a phone puts before "AM" among them:
  // dropped, it ran the time into it.
  [/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, " "],
  // A soft hyphen marks where a word may break, and printed as a hyphen.
  [/\u00AD/g, ""],
  [/[\u2022\u25CF]/g, "-"],
  [/\t/g, " "],
];

/** Beyond Latin-1, the few the standard fonts draw: Windows-1252's extras. */
const WIN_ANSI_EXTRA = "ŒœŠšŸŽž†‡‰‹›€™";

const drawable = (character: string) =>
  /^[\n\r\x20-\x7E\xA0-\xFF]$/.test(character) || WIN_ANSI_EXTRA.includes(character);

/**
 * Letters with no accent to take off, spelled in Latin letters: Polish and
 * its neighbours, and Ukrainian by the national system, with the Russian
 * letters it has no need of.
 */
const SPELLED: Record<string, string> = {
  Ł: "L", ł: "l", Đ: "D", đ: "d", Ħ: "H", ħ: "h", ı: "i", Ŀ: "L", ŀ: "l",
  Ŋ: "N", ŋ: "n", Ŧ: "T", ŧ: "t", ĸ: "k", ſ: "s",
  А: "A", Б: "B", В: "V", Г: "H", Ґ: "G", Д: "D", Е: "E", Є: "Ie", Ж: "Zh",
  З: "Z", И: "Y", І: "I", Ї: "I", Й: "I", К: "K", Л: "L", М: "M", Н: "N",
  О: "O", П: "P", Р: "R", С: "S", Т: "T", У: "U", Ф: "F", Х: "Kh", Ц: "Ts",
  Ч: "Ch", Ш: "Sh", Щ: "Shch", Ь: "", Ю: "Iu", Я: "Ia", Ё: "Io", Ы: "Y",
  Э: "E", Ъ: "",
  // Serbian, Macedonian and Belarusian: "Јован Ђорђевић" lost its J and its
  // Đs and printed "ovan orevy".
  Ј: "J", Ђ: "Dj", Ћ: "C", Љ: "Lj", Њ: "Nj", Џ: "Dz", Ѓ: "Gj", Ќ: "Kj", Ѕ: "Dz", Ў: "U",
  ј: "j", ђ: "dj", ћ: "c", љ: "lj", њ: "nj", џ: "dz", ѓ: "gj", ќ: "kj", ѕ: "dz", ў: "u",
  а: "a", б: "b", в: "v", г: "h", ґ: "g", д: "d", е: "e", є: "ie", ж: "zh",
  з: "z", и: "y", і: "i", ї: "i", й: "i", к: "k", л: "l", м: "m", н: "n",
  о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts",
  ч: "ch", ш: "sh", щ: "shch", ь: "", ю: "iu", я: "ia", ё: "io", ы: "y",
  э: "e", ъ: "",
};

/**
 * Superscripts the font has not got (it has ¹ ² ³), written after a caret:
 * "10⁻⁶" printed "106", a different number.
 */
const SUPERSCRIPT: Record<string, string> = {
  "⁰": "0", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9",
  "⁺": "+", "⁻": "-", "⁼": "=", "⁽": "(", "⁾": ")", "ⁿ": "n",
};

/** At the start of a word these five are spelled with a Y: "Yevhen", not "Ievhen". */
const SPELLED_FIRST: Record<string, string> = {
  Є: "Ye", Ї: "Yi", Й: "Y", Ю: "Yu", Я: "Ya", Ё: "Yo",
  є: "ye", ї: "yi", й: "y", ю: "yu", я: "ya", ё: "yo",
};

const isLetter = (character: string | undefined) =>
  character !== undefined && /\p{L}/u.test(character);

const isUpper = (character: string | undefined) =>
  character !== undefined && character !== character.toLowerCase();

/**
 * Text going onto a PDF in a standard font, in the letters that font has.
 *
 * The fonts built into every PDF reader cover WinAnsi and nothing else, and
 * pdf-lib throws rather than substituting. Real data arrives with curly quotes
 * and en dashes from Word, and a form that fails to generate because somebody
 * pasted a smart apostrophe is not a form.
 *
 * Everything outside the font used to be dropped, which printed "Łukasz Żółć"
 * as "ukasz ó" and a name in Cyrillic as nothing at all. Now a letter loses
 * its accent where it has one to lose and is spelled in Latin letters where it
 * has not. What still cannot be drawn — an emoji, a control character pasted
 * from a spreadsheet — is left out: one such character, U+0092, used to pass
 * the old filter and make pdf-lib throw, and the form failed to generate.
 */
export function toWinAnsi(text: string): string {
  let typed = text
    .normalize("NFC")
    // An apostrophe inside a Ukrainian word is not spelled, and the letter
    // after it is spelled as inside a word: "Мар’яна" is "Mariana". A group,
    // not a look-behind: Safari before 16.4 cannot parse one, and the whole
    // screen would fail to load on an older iPhone.
    .replace(/(\p{Script=Cyrillic})['\u2019\u02BC](?=\p{Script=Cyrillic})/gu, "$1")
    // The national system's one pair: "Згурський" is "Zghurskyi".
    .replace(/([Зз])([Гг])/g, (_, z: string, g: string) =>
      `${z === "З" ? "Z" : "z"}${g === "Г" ? (z === "З" ? "GH" : "Gh") : "gh"}`,
    );
  for (const [pattern, replacement] of TYPOGRAPHIC) typed = typed.replace(pattern, replacement);

  const characters = Array.from(typed);
  let out = "";
  characters.forEach((character, index) => {
    if (drawable(character)) {
      out += character;
      return;
    }
    const raised = SUPERSCRIPT[character];
    if (raised !== undefined) {
      out += (SUPERSCRIPT[characters[index - 1]] !== undefined ? "" : "^") + raised;
      return;
    }
    const first = !isLetter(characters[index - 1]);
    const spelled = (first ? SPELLED_FIRST[character] : undefined) ?? SPELLED[character];
    if (spelled !== undefined) {
      // "ЩУКА" is "SHCHUKA", "Щука" is "Shchuka".
      const shouting =
        isUpper(character) && (isUpper(characters[index + 1]) || isUpper(characters[index - 1]));
      out += shouting ? spelled.toUpperCase() : spelled;
      return;
    }
    // Whatever is left loses its accents. A fraction comes apart round a
    // fraction slash, which is kept as a slash: "⅜" printed "38".
    out += Array.from(
      character
        .normalize("NFKD")
        .replace(/\p{M}/gu, "")
        .replace(/[\u2044\u2215]/g, "/"),
    )
      .filter(drawable)
      .join("");
  });
  return out;
}

/**
 * The letters that print as something else, and what they print as, so the
 * screen can say so before it is saved. Punctuation set straight and spaces
 * are not worth a warning; a name spelled differently is.
 */
export function lettersPrintedDifferently(text: string): { from: string; to: string }[] {
  const changed = new Map<string, string>();
  for (const character of Array.from(text.normalize("NFC"))) {
    // Spaces, lone accents and control characters: nothing anybody would
    // recognise in a list of what changed.
    if (changed.has(character) || /[\s\p{M}\p{C}]/u.test(character)) continue;
    if (TYPOGRAPHIC.some(([pattern]) => new RegExp(pattern.source).test(character))) continue;
    const printed = toWinAnsi(character);
    if (printed !== character) changed.set(character, printed);
  }
  return [...changed].map(([from, to]) => ({ from, to }));
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
