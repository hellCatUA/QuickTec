# Preparing a company's blank so it fills itself

A representing company's sign-off sheet is set up once: every box on it is
pointed at a fact about the job, and from then on the sheet comes out filled.
That setup is normally done on screen — Directory → Representing companies →
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

### Job

| Key | What it is |
| --- | --- |
| `job.assignmentId` | The representing company's assignment ID |
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
| `client.name` | Representing company — who dispatched the job |
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
| `contact.pm` | Rep Company PM/PC |
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
