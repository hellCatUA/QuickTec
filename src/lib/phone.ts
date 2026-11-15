/**
 * How a phone number is written.
 *
 * Dispatch numbers arrive from a dozen places — typed on a phone, pasted from
 * an email, copied off a work order — and they arrived in a dozen shapes.
 * 5551234567 and (555) 123-4567 are the same number and should not look like
 * two, least of all in a list somebody is scanning for the one to dial.
 *
 * Only the shapes worth recognising are reformatted. Anything else is left
 * exactly as it was typed: an extension, an international number, a note in
 * the field. Guessing at those would be worse than leaving them alone.
 */

/** Just the digits, so two spellings of one number compare equal. */
export function phoneDigits(value: string): string {
  return value.replace(/\D/g, "");
}

/**
 * 5551234567 becomes 555-123-4567, and a leading country code survives:
 * 15551234567 becomes 1-555-123-4567.
 */
export function formatPhone(value: string | null | undefined): string {
  if (!value) return "";

  const trimmed = value.trim();
  const digits = phoneDigits(trimmed);

  // An extension, a written note, anything with letters in it: not ours to
  // reshape. The test is on the original, because "x203" is meaningful and
  // its digits alone are not.
  if (/[a-z]/i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("+")) return trimmed;

  if (digits.length === 10) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return `1-${digits.slice(1, 4)}-${digits.slice(4, 7)}-${digits.slice(7)}`;
  }

  return trimmed;
}

/**
 * What to put in the field as somebody types: the dashes go in with the
 * digits — 555, 555-1, 555-123-4, 555-123-4567 — and a leading 1, which no
 * area code starts with, is set apart as the country code.
 *
 * It used to wait for the whole number. Nothing happened before the seventh
 * digit, and from the seventh to the ninth the digits were handed to
 * formatPhone, which knows only whole numbers — so even dashes typed by hand
 * came back out, and the number got its shape only at the tenth digit.
 *
 * Never a dash with nothing after it: backspace at the end always takes a
 * digit. Anything with letters or a plus, and anything too long to be one of
 * ours, is left exactly as typed.
 */
export function formatPhoneAsTyped(value: string): string {
  if (/[a-z+]/i.test(value)) return value;

  const digits = phoneDigits(value);
  if (!digits) return "";

  const country = digits.startsWith("1") ? "1" : "";
  const rest = digits.slice(country.length);
  if (rest.length > 10) return value;

  return [country, rest.slice(0, 3), rest.slice(3, 6), rest.slice(6)]
    .filter(Boolean)
    .join("-");
}

/**
 * Where the caret belongs in a reformatted number: just after the same digit
 * it was after before. Dashes come and go under it as the number is edited,
 * so a position counted in characters lands somewhere else.
 */
export function caretAfterDigits(formatted: string, digitsBefore: number): number {
  if (digitsBefore <= 0) return 0;
  let seen = 0;
  for (let index = 0; index < formatted.length; index++) {
    if (/\d/.test(formatted[index]) && ++seen === digitsBefore) return index + 1;
  }
  return formatted.length;
}

/** What a tel: link should dial — punctuation is for people, not for phones. */
export function telHref(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("+")) return `tel:${trimmed.replace(/[^\d+]/g, "")}`;
  return `tel:${phoneDigits(trimmed)}`;
}
