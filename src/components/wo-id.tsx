/**
 * A work order number, in one piece.
 *
 * Every hyphen in "2611-SBX-POS-0001" is somewhere a browser may break the
 * line, and broken it reads as two numbers — in the one string on the page
 * that people copy down and read out over the phone.
 */
export function WoId({ children }: { children: string }) {
  return <span className="tabular whitespace-nowrap">{children}</span>;
}
