import * as React from "react";

/**
 * The two glyphs no icon set has.
 *
 * Both say two things at once, and either half alone loses the point: a
 * person with authority, and a plan with money in it. Drawn to lucide's
 * proportions — 24-unit box, 2-unit stroke, round caps — so they sit in a row
 * with the imported ones without announcing themselves.
 */

type Props = React.SVGProps<SVGSVGElement>;

const BASE = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.9,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

/** A person in a tie: the Manager Portal, which is authority over a job. */
export function ManagerIcon(props: Props) {
  return (
    <svg {...BASE} {...props}>
      <circle cx="12" cy="5.5" r="3.5" />
      <path d="M5 21v-1.2A5.8 5.8 0 0 1 10.8 14h2.4a5.8 5.8 0 0 1 5.8 5.8V21" />
      <path d="M9.8 14.3 12 16.5l2.2-2.2" />
      <path d="M12 16.6 11.1 19.6 12 20.7l.9-1.1z" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** A calendar holding a dollar: when the job runs, and what it pays. */
export function ScheduleBudgetIcon(props: Props) {
  return (
    <svg {...BASE} {...props}>
      <rect x="3" y="4.5" width="18" height="16.5" rx="2.5" />
      <path d="M3 9.5h18" />
      <path d="M8 2.5v4" />
      <path d="M16 2.5v4" />
      <path d="M12 12.2v6.6" />
      <path d="M14 13.9c-.5-.6-1.2-.9-2-.9-1.1 0-2 .6-2 1.4 0 1.9 4 1 4 2.9 0 .8-.9 1.4-2 1.4-.8 0-1.5-.3-2-.9" />
    </svg>
  );
}
