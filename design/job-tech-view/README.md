# Job page — Technician View

Published: https://claude.ai/artifact/CnwgZ5oLiVyPpYVEScAZvY

Three directions for the job page a technician sees while they are on the job.
Nothing here is in the code yet.

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

The number that matters is not 4,222 but 1,152: Exports, Timeline, Crew and
Time & schedule, none of which a technician opens on site, and all of which can
go before a single tab is drawn.

## Artboards

| File | What it is |
| --- | --- |
| `Before.dc.html` | Where the 4,222px goes, and which parts a tech actually reaches for |
| `Main.dc.html` | **B — recommended.** Tabs are clickable |
| `Literal.dc.html` | **A** — the four tabs exactly as named in the brief, including where they strain. Clickable |
| `Stages.dc.html` | **C** — the same switcher ordered by the job's flow rather than by document type |
| `Desktop.dc.html` | B at 1100px, to show it scales without a second design |

## The three directions

**A — Assignment Details · POC · Work Performed · Deliverables.** The brief as
written. Honest problems, drawn rather than argued: the four names do not fit one
row at 390px so the bar scrolls and Deliverables starts off-screen; POC is three
rows given a whole tab while the address it pairs with is on another; Scope of
work and Work performed are the same task one tab apart; and Time & schedule,
Crew, Dispatch, Exports and Timeline are none of the four names, so they pile
back up under the tabs and the page is long again.

**B — Details · Work · Deliverables · Expenses.** Cut first, split second.
Exports, Timeline, Crew and Time & schedule leave the technician's view; POC and
Dispatch merge into one "Who to call" beside the address; the twelve-field
Assignment details card becomes a short "Where" plus a collapsed "Job reference".
Two things the tabs do that a plain tab bar does not:

- the clock is never behind a tab — it is the one thing that is time-critical;
- the tab bar carries what is outstanding (`Deliverables ③`), and the clock card
  says *3 required still missing before you can close* and links straight to it.
  Without that, tabs actively hide the reason you cannot leave.

**C — Arrive · On site · Wrap up.** Same switcher, different question: tabs ask
"which topic", this asks "what now", and it moves itself as the clock starts and
checkout begins. Serials, return labels, sign-off and expenses all sit under
Wrap up, so nothing is offered before it can be answered. Steps stay tappable, so
it is not a wizard.

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
  --artboard Main.dc.html --artboard Before.dc.html --artboard Literal.dc.html \
  --artboard Stages.dc.html --artboard Desktop.dc.html --canvas canvas.json
```

The seeded `job-technician-view.html` is ~2.5 MB and git-ignored; the artboards
beside it are the source.
