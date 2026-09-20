/**
 * Capitalising a person's name while somebody types it.
 *
 * Names arrive from a phone keyboard at the end of a job, one-handed, and come
 * out as "jane o'brien" or "JANE O'BRIEN" depending on whose thumb and which
 * autocorrect. Neither is what goes on a client's report.
 *
 * The rule is deliberately small: raise the first letter of each word and
 * leave every other letter exactly as typed. Full title case — lowering the
 * rest — would be the obvious way to do this and it is wrong, because it turns
 * McDonald into Mcdonald, DeSoto into Desoto and O'Brien into O'brien, and a
 * name spelled the way its owner spells it is worth more than a tidy one.
 * Somebody who types in capitals gets their capitals.
 *
 * Applied on every keystroke, like the phone formatter beside it, so what is
 * on screen is what will be stored — rather than tidied up on save, where the
 * change happens after the person has stopped looking.
 */

/**
 * Word boundaries a name actually has.
 *
 * Space, and the two punctuation marks that join name parts: the hyphen in
 * Mary-Jane and the apostrophe in O'Brien. A full stop is not one — "Jr." must
 * not make the next letter jump — and neither is a comma.
 */
const AFTER = /(^|[\s\-'’])(\p{L})/gu;

export function capitaliseName(value: string): string {
  return value.replace(
    AFTER,
    (_match, before: string, letter: string) =>
      `${before}${letter.toLocaleUpperCase()}`,
  );
}
