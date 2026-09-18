# New job — form rebuild

Published: https://claude.ai/artifact/4B3NVbVx1CNLB374SHv8fm

Nothing here is in the code yet.

## Measured, not guessed

Taken from the running app at 390×844, planner account:

```
page scrollHeight: 4699  = 5.6 phone screens

 1099  Assignment details
 1005  Deliverables
  457  Schedule
  455  Paperwork
  429  Pay
  308  Scope of work
  235  Assign techs
  175  Dispatch
  107  Miscellaneous
```

Nine cards, all expanded, required and optional undifferentiated. Only five
fields are genuinely required.

## The data-loss bug, reproduced

Filled five fields, left the site unpicked, pressed Create. The server refused,
and afterwards:

```
Assignment ID   A-12345                          -> gone
Ticket #        TK-99887                         -> gone
INC #           INC0042                          -> gone
Scope of work   Swap the failed switch at rack 3 -> gone
Title           Repro job                        -> kept
```

**Cause.** React resets a `<form action={…}>` after the action runs. The fields
that survive are the ones held in React state; the ones that vanish are plain
`<input>`s with nothing behind them — `externalAssignmentId`, `ticketNumber`,
`incNumber`, `scopeOfWork`, and every extra ticket row. Not random, and not
fixed by moving cards around.

**Also found:** the Customer picker is not in the submitted zod schema at all
(`src/app/(app)/jobs/schema.ts`). It filters the site list, and the job's
customer comes from `site.customerId` in the create action. It looks like data
entry and is a search box.

## Artboards

| File | What it is |
| --- | --- |
| `Main.dc.html` | The form at rest, sections closed. Interactive |
| `Sections.dc.html` | Every section opened, so the fields can be approved |
| `DraftFlow.dc.html` | Coming back, saving, and a refused Create |
| `Before.dc.html` | Today's 4,699px and the reproduced bug |
| `Draft.dc.html` | Why C was chosen over A and B |

Desktop comes after this is agreed.

## Proposed shape

- **Start from** — one segmented choice, a project or blank. Picking a project
  fills paying company, rep company, break policy, deliverable rules and pay,
  each row labelled with where it came from.
- **The job** — only what is required: site and title. The customer picker is
  gone; searching by customer name still finds the site.
- **Everything else folded** — Numbers, Schedule & crew, Scope of work,
  Paperwork, Deliverables, Pay & dispatch. Each closed row says what is already
  in it, so nothing has to be opened to be checked.
- **A footer that never scrolls away** — when the draft last saved, what is
  still missing, and Create.

## Settled: option C

A `JobDraft` row per person, saved as you type, promoted to a Job on Create.
The INT WO number is shown as a preview and only taken from the counter when
the job is created, so an abandoned draft leaves no gap in the sequence.

Three states are designed on `DraftFlow.dc.html`: coming back to an unfinished
draft, the footer while it saves, and a refused Create where nothing is lost.
"Start fresh" keeps the old draft until Create is pressed — it is not thrown
away behind your back.

Still open, and decided my way unless you say otherwise: the rep company is
taken from the project and can be changed per job, like the paying company.

## Why C, for the record

Where does a draft live? `allocateIntWo` *consumes* a counter — the project's
`intWoCounter` or the global yearly one — so a number given to a draft that is
then abandoned leaves a hole in the sequence that reaches client paperwork.
`Job.intWoId` is `NOT NULL` and unique today.

- **A.** A real Job, numbered at first keystroke. Simplest; burns numbers; puts
  half-filled jobs into every list, the dashboard, calendars, exports, payroll.
- **B.** A real Job, numbered on Create. No gaps, but `intWoId` must become
  nullable — altering a NOT NULL column under a unique index on live data.
- **C.** Not a Job yet: a `JobDraft` row, per person, promoted on Create.
  **Chosen.** Nothing lost, no number burned, no migration on `intWoId`,
  blast radius of one new table. A draft is yours, not shared.

## Re-seeding

```sh
SKILL=<design skill base dir>
node "$SKILL/seed-canvas.mjs" --template "$SKILL/payload.template.html" \
  --out new-job-form.html --title "New job — form rebuild" \
  --artboard Main.dc.html --artboard Sections.dc.html --artboard DraftFlow.dc.html \
  --artboard Before.dc.html --artboard Draft.dc.html --canvas canvas.json
```
