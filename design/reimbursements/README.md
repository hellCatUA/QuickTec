# Job expenses on the Pay screen

Three ways to show a job's reimbursements as a statement instead of the green
`+$86.40 travel` chips. **C is built**, with B's per-kind icons — `src/app/
(app)/pay/week-view.tsx`. A and B are kept as what was weighed against it.

Published at https://claude.ai/artifact/MjLqCvTpnn1UByTEtbMCCB

| File | Artboard |
| --- | --- |
| `Today.dc.html` | What it did before, one expense and five |
| `Main.dc.html` | **A** — the expenses as their own small receipt inside the card |
| `Ledger.dc.html` | **B** — expenses as more of the card's own icon rows (its icons were kept) |
| `Statement.dc.html` | **C** — headline becomes the job total, a tear-off strip itemises it · **built** |

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
- Any of them can carry a note. **Still not shown** — nothing on Pay has room
  for it, and it was left out of all three options deliberately.

Expenses read in a fixed order — travel, parking, tolls, hotel, materials —
which is the order payroll already buckets them in, so a statement and a
payroll line agree.

## The decision that was made

A and B leave the card's big number meaning labour, as it does today, and add
the expenses under it. C makes it the job total instead, which is the honest
statement reading — and then `/pay`'s Earned card has to lead with the total
too, or the job cards stop adding up to it.

C was chosen, carrying B's per-kind icons into the strip. The card's amount is
now what the job paid, and the strip under it says what that was made of —
labour first, then every expense.

Two knock-ons, both taken: the hours and the rate moved off the clock row onto
the strip's labour line rather than being said twice three rows apart, and
every other figure on Pay had to follow the same reading — the week and month
headline, the week blocks, the day rows. The headline card is labelled **Total**
rather than Earned, because a hotel bill handed back is not something anybody
earned.

A job with nothing claimed keeps the plain card: a one-line statement whose
only line repeats the heading is worse than no statement.

Still on chips, and not part of what was agreed: the job cards on
`/payroll/<id>`, which show the same expenses to whoever is approving the week.

The figures in the mockups are invented to load the format; they are not from
the database.

## Working on them

The canvas published from these is assembled by the `design` skill's helper
and is not in git (2.5 MB of editor bundle). Edit the `.dc.html` files,
re-seed, and republish to the same artifact.
