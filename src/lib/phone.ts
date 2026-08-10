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
 * What to put in the field as somebody types.
 *
 * Formats only once there is enough to format, so the dashes appear under the
 * thumb rather than fighting it: nothing happens until the seventh digit, and
 * a number being deleted is not re-punctuated on every backspace.
 */
export function formatPhoneAsTyped(value: string): string {
  if (/[a-z+]/i.test(value)) return value;

  const digits = phoneDigits(value);
  if (digits.length < 7) return value;
  if (digits.length > 11) return value;

  return formatPhone(digits);
}

/** What a tel: link should dial — punctuation is for people, not for phones. */
export function telHref(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("+")) return `tel:${trimmed.replace(/[^\d+]/g, "")}`;
  return `tel:${phoneDigits(trimmed)}`;
}
