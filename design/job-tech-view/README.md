# Job page — Technician View

Published: https://claude.ai/artifact/CnwgZ5oLiVyPpYVEScAZvY

Agreed but **not in the code yet**. Three tabs:

```
Details  ·  Notes  ·  Deliverables ③
```

## What was decided

- **Assignment Details → Details.**
- **Points of contact merges into Details**, sitting under the details themselves,
  with Dispatch info folded in with it. That is what takes the switcher from four
  names to three, and it is why the tab bar no longer has to scroll.
- **Work Performed → Notes.** The card inside keeps the name `Work performed`,
  because that is what the exports call it; the tab is the label on the drawer.
- Reimbursements, which had no home among the original four names, land under
  Deliverables: a claim is the same gesture as a deliverable, a thing plus the
  photo that proves it.

### Why `Notes` and not `Report`

`Report` is already taken in this app — the client-facing report, the Exports
card, the `Report .txt` button — so a tab called Report that is not the report is
a trap. `Work` says nothing on a page where every tab is work. `Notes` is the
shortest name that is still accurate about the action: the tech writes free text.
Runner-up if `Notes` reads too casual for text that reaches the client report:
`Summary`.

## The measurement everything rests on

Taken from the running app, tech account, 390×844:

```
page scrollHeight: 4222  = 5.0 phone screens

  226  title, badges, clock
  862  Assignment details      <- the biggest single card
  189  Dispatch info
  107  Scope of work
  331  Points of contact
  247  Work performed
  339  Time & schedule
  125  Crew
  552  Deliverables
  191  Reimbursements
  561  Exports
  127  Timeline
```

On a job with **no photos**, nothing filled in and one person on the crew. A real
job with ten deliverable sections of photos is several times this. Reproduce with
a Playwright page at that viewport and `document.body.scrollHeight`.

The number that matters is not 4,222 but **1,152**: Exports, Timeline, Crew and
Time & schedule, none of which a technician opens on site, and all of which leave
before a single tab is drawn. Tabs over the whole page would only hide five
screens behind three taps.

## Two things the tabs must not break

- **The clock never goes behind a tab.** It is the one thing that is
  time-critical.
- **The tab bar carries what is outstanding** (`Deliverables ③`), and the clock
  card says *3 required still missing before you can close* and jumps straight
  there. Without that, tabs actively hide the reason you cannot leave.

## Artboards

| File | What it is |
| --- | --- |
| `Main.dc.html` | The agreed design. Tabs are clickable |
| `Map.dc.html` | What lives on which tab, what is pinned, what leaves |
| `Before.dc.html` | Where the 4,222px goes today |
| `Desktop.dc.html` | The same three tabs at 1100px |
| `Literal.dc.html` | Not chosen — four tabs unmerged, including where they strain |
| `Stages.dc.html` | Not chosen — Arrive / On site / Wrap up instead of topics |

The small blue `was its own tab` markers on `Main` are review annotations, not
shipping UI.

## Style

Lifted from `src/app/globals.css` and `src/components/ui/*`: card `oklch(0.21
0.014 260)` on `oklch(0.17 0.012 260)`, border `oklch(0.31 0.016 260)`, card
radius 14px, badge 8px, button 10px, card title 14px/600, uppercase labels
11px/500, primary `oklch(0.66 0.16 235)`. Buttons keep the 44px minimum tap
target the app already enforces.

## Re-seeding

Edit the `.dc.html` files, then:

```sh
SKILL=<design skill base dir>
node "$SKILL/seed-canvas.mjs" --template "$SKILL/payload.template.html" \
  --out job-technician-view.html --title "Job — Technician View" \
  --artboard Main.dc.html --artboard Map.dc.html --artboard Before.dc.html \
  --artboard Desktop.dc.html --artboard Literal.dc.html --artboard Stages.dc.html \
  --canvas canvas.json
```

The seeded `job-technician-view.html` is ~2.5 MB and git-ignored; the artboards
beside it are the source.
