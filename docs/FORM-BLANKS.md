# Preparing a company's blank so it fills itself

A paying company's sign-off sheet is set up once: every box on it is
pointed at a fact about the job, and from then on the sheet comes out filled.
That setup is normally done on screen — Directory → Paying companies →
the form → **Set up autofill**.

There is a shortcut. If the PDF's own form fields are **named after entries in
the catalogue below**, the boxes point themselves the moment the file is
uploaded, and the setup is nothing but a check.

This is worth doing when you are preparing a blank yourself in Acrobat,
LibreOffice Draw or anything else that can add form fields.

## The rule

A field named exactly `site.city` is bound to the site's city. Anything else is
left alone — a form whose author happened to call a field `City` is not touched,
because a box that pointed itself somewhere nobody chose is the one mistake that
reaches a customer.

For a form with a **table** — a line per visit — add `#` and the row number:

```
visit.date#1   visit.in#1   visit.out#1   visit.hours#1
visit.date#2   visit.in#2   visit.out#2   visit.hours#2
```

Rows start at 1. On a source that does not repeat the suffix is ignored.

Fields you do **not** want filled — the site contact's initials, a tick box only
they can answer — just give any other name. `Initials_1`, `SiteComplete_Yes`,
anything that is not a key below. They show up in the editor as boxes left for
whoever is on site.

**Always check the result.** The mapping screen says how many boxes arrived
pre-pointed and asks you to look at them before saving. That is not a formality:
this sheet goes to somebody else's customer, and a wrong value in a box is worse
than an empty one — the empty one gets written in by hand on site, the wrong one
gets signed.

## What a blank does not need

Fields are a convenience, not a requirement. A flat PDF with no fields at all
works: its boxes are placed by hand in the editor, or lifted off a copy you have
already filled in with a phone annotator (**Import its boxes**), which puts them
all in the right place in one go.

The filler never types into these fields anyway. It draws every value onto the
page and removes the form entirely, so the sheet cannot be edited after it is
signed, and nothing the blank was carrying from a previous job survives.

## The catalogue

The source of truth is `src/lib/forms/catalogue.ts`. Keys never change once a
company has a form mapped against them; new ones get added.

### Tech

| Key | What it is |
| --- | --- |
| `tech.names` | Everyone assigned, comma separated |
| `tech.lead` | The lead tech |
| `tech.initials` | Their initials — `Zhuly Gonzales` → `ZG` |
| `tech.count` | How many techs were on it — for a `# Techs` column |

### Job

| Key | What it is |
| --- | --- |
| `job.assignmentId` | The paying company's assignment ID |
| `job.ticket` | Ticket # |
| `job.intWoId` | Our own INT WO ID |
| `job.title` | Job title |
| `job.releaseCode` | Release code — empty when it was waived |
| `job.returnTracking` | Return tracking # |
| `job.scope` | Scope of work (long) |
| `job.summary` | Work summary (long) |
| `job.materials` | Materials used (long) |

### Companies

| Key | What it is |
| --- | --- |
| `client.name` | Paying company — who dispatched the job |
| `customer.name` | Customer — the brand whose site it is |
| `customer.code` | Their short code, e.g. `SBUX` |
| `project.name` | Project |
| `company.name` | Us |
| `company.phone` | Our phone |

### Site

| Key | What it is |
| --- | --- |
| `site.label` | `SBUX #24541` |
| `site.number` | Site number on its own |
| `site.name` | Site name |
| `site.address` | The whole address on one line |
| `site.address1` | Street |
| `site.address2` | Suite / unit |
| `site.city` | City |
| `site.state` | State |
| `site.zip` | ZIP |
| `site.cityStateZip` | `Covina, CA 91723` |

### Times

| Key | What it is |
| --- | --- |
| `time.date` | The date the work happened |
| `time.today` | The date the form is produced |
| `time.onsite` | First check-in |
| `time.offsite` | Last check-out |
| `time.total` | Total time, e.g. `3.83 hrs` |
| `time.scheduled` | The date it was scheduled for |
| `time.created` | The date the job came in — for a `Date Received` box |

### Per visit — repeats, takes `#N`

| Key | What it is |
| --- | --- |
| `visit.date#N` | Date of trip N |
| `visit.in#N` | Time in |
| `visit.out#N` | Time out |
| `visit.hours#N` | Hours on site |
| `visit.break#N` | Break taken |
| `visit.tech#N` | Who made that trip |

### Contacts

| Key | What it is |
| --- | --- |
| `contact.pm` | Paying company PM/PC |
| `contact.mod` | MOD name |
| `contact.noc` | NOC name |

### Signature

A field named with one of the two image keys becomes a signature box: the
captured signature is fitted into it, never stretched.

| Key | What it is |
| --- | --- |
| `signature.mod` | The customer's signature (image) |
| `signature.modName` | Their printed name |
| `signature.modDate` | The date they signed |
| `signature.tech` | The tech's signature (image) |
| `signature.techName` | The tech's printed name |

### Fixed text

`static` puts the same words on every copy — a licence number, a standing note.
The words themselves are typed into the mapping screen, not into the PDF.

## When a company has no sheet: their work order as the sign-off

Some paying companies never send a sign-off sheet, and the job still has to
come back with something the customer signed. What every WorkMarket job does
have is its work order, and that already has the places: an arrival and a
departure time, a box for notes, and a row for the customer's printed name,
signature and date. **Use WM WO as a Sign-Off** writes the job onto those.

Nothing here needs setting up per company. The work order is read when it is
signed, on that job:

- **Which pages.** WorkMarket prints it three times — the resource copy the
  customer signs, the customer's copy, the instructions. Only the first copy is
  written on, up to the page before the one headed exactly `CUSTOMER COPY`
  (in the top quarter of the page: a sentence starting with those words is
  not a heading); the whole file is kept. Where the copies were told apart
  wrongly, **Use every page** opens the rest of the document to the boxes.
- **The times.** Either `ARRIVAL TIME` / `DEPARTURE TIME` over blank lines
  ending in `AM/PM` — written on the lines as `9:05 AM`, with the dates as
  well when the job ran over more than one day — or `Check-In:` /
  `Check-Out:` with WorkMarket's own times printed after them. Those are
  painted over in white and ours written in their place with the date,
  `09-29-2026 9:05 AM`, because the date is the half WorkMarket most often has
  wrong. Painted, not removed: the old text is still inside the file under the
  white, where a reader's select-all would find it. What is painted is
  outlined in red on the screen and can be switched off: only the time after
  each label, within the box the labels sit in, and a wrapped last word
  directly under `Check-Out:` — never a second column on the same lines or a
  line of its own such as `Total: 4.30 hrs`.
- **The notes.** The ruled lines under `Notes`, one line of writing per rule
  — under the first `Notes` with lines, so a "Notes" in the description is
  passed over. Where the box starts at the foot of a page and carries on over
  the page, the part with more lines is used. Lines drawn as one path are read
  line by line. Where there are no lines to measure, the spacing is a guess
  that can be set a tenth of a point at a time. A note too long for the lines
  is set smaller and closer together; past 6 pt it is cut, ending `...
  (continued in the job report)`.
- **The signature row.** On the line above `Customer Name (Printed)`,
  `Customer Signature` and `Date`: the name of whoever signed for the customer
  at checkout, their signature, and the day they signed. The signature is the
  ink alone — the pad's white taken away and the picture cut to the strokes —
  so it is drawn at a readable size and covers nothing printed under it.
- **Words set wide.** A label whose words arrive from the file one at a time —
  `ARRIVAL` and `TIME`, `Customer` and `Signature` — is put back together
  before it is looked for.
- **Letters.** The standard PDF font has no Ł, Ż or Cyrillic. Accents it has
  not got are taken off (`Łukasz Żółć` prints `Lukasz Zólc`) and Ukrainian is
  spelled in Latin letters by the national system (`Олександр` prints
  `Oleksandr`); the screen says what will print. A one-line value too long
  even at 5 pt is cut short with `...`, and the screen says so.

What it cannot find is still offered as a box, parked where that part usually
sits and clear of the others, to be dragged into place — a work order that is
not WorkMarket's works too, by hand. Every box is checked on the page before
anything is saved, and any value can be typed over there.

On a phone it goes one place at a time: the page fills the screen, turned and
zoomed to the place in front, with **Back**, **Edit** and **Next** under it.
Nothing on the page moves until Edit is pressed. Next applies the place and
moves on, and waits on a place that was not found until its box has been
moved; after the third, **Approve** saves the whole document. On a computer
the three sit beside the page, each with **Show** and **Apply**, and the file
is saved once all three are applied. Either way, saving goes straight back to
the job, which says what was saved and anything worth knowing about it — no
signature, notes cut short.

A file pdf.js and pdf-lib read differently (damaged, so that they count its
pages differently) is refused before anything is placed on it, and again on
the server: a box placed on one page could be written on another.

Only once the job is closed — the last clock-out, or later. The work order
carries the departure time and the customer's word that the work is done, so
before that it is refused, on the job page and on the server. The checkout
offers it the moment the last person clocks out (the company's own sheet
beside it when one is on the job and still empty), and the Sign-off block keeps
it for afterwards.

The result is saved with the work orders as `<their file name>-Signed.pdf`,
the original beside it, and goes in the company's WO folder of the export.
Signing again replaces it — one signed copy per work order, held by the
database, so two saves at the same moment still leave one. Where it was put on
the page and what was typed are kept with it, so signing again starts from
there.

`npm run verify:wo` checks all of this against work orders drawn to the
measurements of two real ones, which stay out of the repository because they
carry customers' details.
