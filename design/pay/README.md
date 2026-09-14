# Pay and Payroll — proposed screens

Mockups for splitting **Pay** (what a person earned; everyone, own money only)
from **Payroll** (what the company owes; managers and administrators). Not
built yet — these are for agreeing the shape before any of it is written.

Each `.dc.html` is one screen; `canvas.json` places them on two pages and
carries the notes. Colours, radii, card and badge anatomy are lifted from
`src/app/globals.css` and `src/components/ui/` rather than invented, so what is
drawn here is what the app can actually render.

| File | Screen |
| --- | --- |
| `Main.dc.html` | Pay, landing on the open week: stats, then the week's jobs |
| `Weeks.dc.html` | The week blocks, grouped under month headers |
| `Monthly.dc.html` | Monthly view: the month's stats, its weeks listed inside |
| `WeekDays.dc.html` | One week, day by day |
| `Payroll.dc.html` | A payroll week across everybody in it |
| `PayrollPerson.dc.html` | One person's week: the lines, and the decisions |
| `Supervisor.dc.html` | Direct Supervisor, restricted to who can approve pay |

## What they assume

Three decisions are drawn in rather than described, and each is arguable:

- **Pay is computed live from the time records**, the way `/pay/stats` already
  works — it never waits for a payroll run. That is what stops the page being
  empty until somebody presses a button.
- **Payroll opens on a week, not a person.** The question a manager arrives
  with is who they owe this week, and one Build covers everybody in it.
- **Somebody with no pay rate is called out**, in red, instead of quietly
  totalling to $0.00. A rate that resolves to non-billable is a gap, not a fact.

## Working on them

The canvas published from these is assembled by the `design` skill's helper and
is not in git (2.5 MB of editor bundle). Edit the `.dc.html` files, re-seed, and
republish to the same artifact.
