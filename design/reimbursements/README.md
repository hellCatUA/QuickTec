# Job expenses on the Pay screen — proposed

Three ways to show a job's reimbursements as a statement instead of the green
`+$86.40 travel` chips. Not built — these are for agreeing the shape first.

Published at https://claude.ai/artifact/MjLqCvTpnn1UByTEtbMCCB

| File | Artboard |
| --- | --- |
| `Today.dc.html` | What it does now, one expense and five |
| `Main.dc.html` | **A** — the expenses as their own small receipt inside the card |
| `Ledger.dc.html` | **B** — expenses as more of the card's own icon rows |
| `Statement.dc.html` | **C** — headline becomes the job total, a tear-off strip itemises it |

Every artboard shows a job with one expense and a job with five, because five
is where the chips fall over and where any replacement has to still read.

## What the data actually carries

Worth having in front of you when choosing, because the chips show one fifth
of it:

- Four `ReimbursementType`s — `MATERIAL`, `PARKING`, `TOLL`, `HOTEL` — plus
  Travel, which is not a `Reimbursement` row at all: it rides on the
  `JobAssignment` as a flat allowance.
- `PARKING`, `TOLL` and `HOTEL` always have a receipt photo attached;
  `MATERIAL` and Travel never do.
- `MATERIAL` and `HOTEL` carry a name the tech typed ("Cat 6A 3Ft", "Holiday
  Inn"); `PARKING` and `TOLL` have none, and export under the type itself.
- Any of them can carry a note. None of the options below show it yet — that
  is an open question.

## The one real decision

A and B leave the card's big number meaning labour, as it does today, and add
the expenses under it. C makes it the job total instead, which is the honest
statement reading — and then `/pay`'s Earned card has to lead with the total
too, or the job cards stop adding up to it.

The figures in the mockups are invented to load the format; they are not from
the database.

## Working on them

The canvas published from these is assembled by the `design` skill's helper
and is not in git (2.5 MB of editor bundle). Edit the `.dc.html` files,
re-seed, and republish to the same artifact.
