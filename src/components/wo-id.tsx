/**
 * A work order number, in one piece wherever it fits in one.
 *
 * Every hyphen in "2611-SBX-POS-0001" is somewhere a browser may break the
 * line, and broken it reads as two numbers — in the one string on the page
 * that people copy down and read out over the phone. So it moves to a line of
 * its own as a whole, the way a word does.
 *
 * Not `nowrap`, though: a project ID can be twenty characters, and a number
 * of thirty on a 320px phone ran under the menu beside the title and off the
 * screen. Longer than the whole line, it breaks — which is the lesser harm.
 */
export function WoId({ children }: { children: string }) {
  return (
    <span className="tabular inline-block max-w-full [overflow-wrap:anywhere]">
      {children}
    </span>
  );
}
