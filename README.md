# QuickTec

Field service time tracking and reporting for a small team of technicians.
Self-hosted, English UI, sign-in through NextCloud.

Techs clock in on a job, see their earnings tick up live, fill in the report as
they work, and clock out through a guided checkout. Supervisors and managers see
the same jobs with the money attached, approve what needs approving, and export
the client-facing report, the full job archive, and the weekly pay journal.

---

## Status

**All seven phases are complete.** What works today:

- NextCloud OpenID Connect sign-in, with roles read from NextCloud groups
- Three-layer permission model (base role, relationships, permission + scope)
- Editable permission matrix
- Company settings, user management, direct-supervisor assignment
- Clients, customers and sites, with tappable addresses
- Projects: client project ID, general scope, membership, deliverable defaults,
  dispatch contacts, and their own work order counter
- Job creation with automatic internal work order numbering, tech assignment,
  automatic pay rate resolution and revisit scheduling
- Scope-filtered job list and the job working page
- Time clock: clock in/out with five-minute snapping, an early/later picker,
  multiple breaks per visit, and earnings ticking in real time
- Planned fields read-only by default, with fill-in for blanks and a
  Suggest change flow for the rest
- Scope of work in Markdown with tickable checklists, points of contact,
  dispatch numbers, and per-tech Work Performed that autosaves
- Deliverables: photo upload with HEIC conversion, EXIF capture and a
  bottom-right stamp, kept against whoever uploaded them
- Reimbursements for materials, parking, tolls and hotels with receipts
- Signature capture for the MOD and the tech
- Guided checkout: missing-work review, outcome, release code, signatures,
  final review and the clock-out picker — plus a prepare mode that collects
  everything while the manager is still on site
- Exports: the client-facing text report, a ZIP of the whole job, and the
  company's own PDF work order
- Pay rates by tech, project and client, with per-job overrides
- Mileage tracker with trip categories and odometer photos
- Weekly payroll approved by the direct supervisor, with per-job overrides and
  Received/REDUCED recorded for both the week and each job
- Pay journal spreadsheet, weekly or monthly, and per-tech statistics
- Crew management on a live job: add a tech, move the lead, take somebody off
  before they have started, all on the job's timeline
- Approvals inbox: change requests, ad-hoc jobs, reports to review and payroll
  weeks, each scoped to what the person can actually decide
- Per-site history: every job at a location, who went, when, and whether it
  took a second trip
- One-way NextCloud calendar sync: one calendar per tech, owned by a system
  account and shared with them and their supervisor
- Dark/light theme (dark by default), responsive phone/tablet/desktop shell
- Installable PWA with an offline notice and a connection indicator
- Docker Compose deployment

Everything the app can do is reachable from the UI.

---

## Architecture

| Layer | Choice | Why |
| --- | --- | --- |
| App | Next.js 16 (App Router), React 19, TypeScript | Server Components keep the first paint fast on a weak mobile signal |
| Database | PostgreSQL 17 + Prisma 7 | One dependency, real transactions for clock in/out and payroll |
| Auth | Auth.js v5, generic OIDC provider | NextCloud is the identity source; no passwords stored here |
| Styling | Tailwind CSS 4 | Theme tokens in CSS, no runtime cost |
| Images | sharp | HEIC→JPEG, resize and watermarking on upload |
| Deployment | Docker Compose | Fits an OMV box behind Nginx Proxy Manager and Tailscale |

### Deliberate decisions

**Session identity is in the JWT; authorisation is not.** The token carries only
a user id. Role and permissions are re-read from Postgres on every request, so
removing someone from a NextCloud group or deactivating their account takes
effect on their next tap rather than whenever the token expires.

**No auth middleware.** Route protection lives in the `(app)` layout and in each
Server Action, both of which run on Node and can reach the database. Edge
middleware would only be able to check that *a* token exists, which is not the
question worth answering.

**Migrations run in their own container.** The `migrate` service applies
migrations and the seed, then exits; the app waits for it to succeed. The
runtime image stays small and never ships the Prisma CLI.

**Job vs. assignment vs. visit.** A `Job` is the shared work order. A
`JobAssignment` is one tech on that job — their own external Assignment ID, pay
rate, signature and Work Performed. A `Visit` is one clock-in/clock-out pair, so
revisits and multi-day jobs need no special cases.

Client-facing totals come from the whole job (earliest clock-in, latest
clock-out, across everyone). Pay comes from each tech's own visits, minus their
own unpaid breaks.

---

## Permissions

Every permission carries a **scope** saying how far it reaches. Scopes nest:

```
OWN  ⊂  REPORTS  ⊂  PROJECT  ⊂  ALL
```

- **OWN** — only the user's own records
- **REPORTS** — OWN, plus every tech whose direct supervisor they are
- **PROJECT** — REPORTS, plus everything in projects where they are PM or supervisor
- **ALL** — no restriction

Three layers combine into an answer:

1. **Base role** — `ADMINISTRATOR`, `MANAGER`, `SUPERVISOR`, `TECH`,
   `ACCOUNTANT`, mapped from NextCloud groups on every login.
2. **Relationships** — `User.directSupervisorId` (who approves and pays this
   tech, on every project) and `ProjectMember.role` (who runs this project).
3. **Permission + scope** — the editable matrix at `/settings/roles`, plus
   per-user `PermissionOverride` rows for exceptions.

Two rules worth knowing:

- **Payroll follows the direct supervisor, never the project.** A supervisor
  approves pay for the techs who report to them, wherever those techs worked
  that week. Manager approval is possible as a fallback and is flagged as such
  so the supervisor can see who paid their tech.
- **Empty planned fields can be filled by anyone assigned; populated ones
  cannot.** Changing a field that already has a value requires
  `job.edit_planned_fields`, otherwise it becomes a change request for a
  supervisor to approve. Both paths are written to the audit log.

### NextCloud groups

| Group | Role |
| --- | --- |
| `quicktec-admin` | Administrator — integrations, users, backups |
| `quicktec-manager` | Manager — the business side of everything |
| `quicktec-supervisor` | Supervisor — their team and their projects |
| `quicktec-tech` | Tech |
| `quicktec-accountant` | Accountant — read-only across all money |

A user in **none** of these groups is refused entry. When someone is in several,
Manager wins, then Administrator, Supervisor, Accountant, Tech.

---

## Deployment

Full walkthrough — DNS, directories, compose, Nginx Proxy Manager, the
NextCloud OIDC client and calendar sync — in
**[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**. It is written against a host
running Tailscale, Nginx Proxy Manager and NextCloud in the host network
namespace, which is the arrangement QuickTec was built for.

The short version:

```bash
git clone <this repo> quicktec && cd quicktec
cp .env.example .env
openssl rand -base64 32          # paste into AUTH_SECRET
$EDITOR .env
chown -R 1001:1001 <uploads dir> # the app runs as uid 1001
docker compose up -d --build
```

| Variable | Notes |
| --- | --- |
| `POSTGRES_PASSWORD` | Use `openssl rand -hex 24` — it ends up in a connection string, where `/` breaks parsing |
| `DATABASE_URL` | Derived from the `POSTGRES_*` variables by compose. Set it only for a database compose does not run |
| `AUTH_URL` | Public URL, e.g. `https://quicktec.417group.org` |
| `AUTH_SECRET` | 32+ random bytes |
| `NEXTCLOUD_ISSUER` | Your NextCloud base URL |
| `NEXTCLOUD_WELL_KNOWN` | Only if discovery is not at `<issuer>/index.php/apps/oidc/openid-configuration` |
| `NEXTCLOUD_CLIENT_ID` / `_SECRET` | From the OIDC provider app |
| `CALDAV_USERNAME` / `_PASSWORD` | Optional. The system account that owns the tech calendars — use an **app password**. Leave blank to turn sync off |
| `POSTGRES_DIR` / `UPLOADS_HOST_DIR` | Where the two data directories live on the host |
| `APP_BIND` | Defaults to `127.0.0.1`. Set to the LAN IP if NPM runs on another host |
| `TZ` | `America/Los_Angeles` |

If any of the auth variables are missing, the sign-in page says so instead of
showing a button that quietly does nothing.

In NextCloud, install the **OpenID Connect provider** app (`oidc`) and add a
client with the redirect URI
`https://quicktec.417group.org/api/auth/callback/nextcloud`, RS256, confidential.
QuickTec asks for `openid profile email roles`; the `roles` scope is what
carries group membership, and without it every sign-in is refused.

---

## Data & backups

| Path | Contents |
| --- | --- |
| `$POSTGRES_DIR` (default `./data/postgres`) | Database |
| `$UPLOADS_HOST_DIR` (default `./data/uploads`) | Photos, signatures, generated exports |

Uploads are **not** served straight from the volume. Every read goes through
`/api/files/<id>`, which applies the same job-scope check as the page linking
to it — mapping the directory into Nginx would let anyone with a URL read
another crew's site photos.

Both are bind mounts, so OMV's own snapshot and backup jobs cover them. Stop the
stack or use `pg_dump` for a consistent database copy:

```bash
docker compose exec db pg_dump -U quicktec quicktec | gzip > backup-$(date +%F).sql.gz
```

---

## Development

Requires Node 22 and a PostgreSQL instance.

```bash
npm install
cp .env.example .env        # uncomment DATABASE_URL, point it at your Postgres
npx prisma migrate dev
npx prisma db seed
npm run dev
```

| Command | Purpose |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` | `prisma generate` + production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:migrate` | Create and apply a migration |
| `npm run db:seed` | Seed role grants and company row (idempotent) |
| `npm run verify` | Integration check for numbering, dates, time, money and scope |
| `npm run verify:ui` | Drives the time clock and checkout in a real browser |
| `npm run verify:pay` | Drives payroll approval and payment in a real browser |
| `npm run verify:approvals` | Drives the approvals inbox, site history and crew changes in a real browser |
| `npm run db:studio` | Prisma Studio |

The seed never rewrites a permission the database already knows about, so a
manager's tuning survives every deploy. It does seed defaults for permissions a
release has newly added, and deletes grants for ones it has retired.

`npm run verify` is destructive — it wipes jobs and counters to test numbering —
so it refuses to start without `QUICKTEC_ALLOW_DESTRUCTIVE_VERIFY=1`.

The browser suites need the app already running and a Chromium that matches the
installed Playwright; set `CHROMIUM_PATH` if it is not where Playwright expects
it. `verify:approvals` also parks unrelated jobs that are mid-flow so the inbox
count is deterministic, so it belongs on a development database too.

CalDAV is exercised against a throwaway HTTP server started inside
`npm run verify`, which records the `MKCALENDAR`, `PUT` and `DELETE` traffic —
so the client is tested without a NextCloud to point at.

---

## Roadmap

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Auth, roles & permissions, company settings, theme, PWA shell, deployment | **Done** |
| 2 | Clients, customers, sites, projects; job creation and INT WO numbering | **Done** |
| 3 | Job page, read-only fields with change requests, time clock, breaks, live earnings | **Done** |
| 4 | Deliverables, photo pipeline, signatures, guided checkout | **Done** |
| 5 | Text report, ZIP archive, internal PDF work order | **Done** |
| 6 | Pay rates, mileage, pay journal, payroll | **Done** |
| 7 | Timelines, site history, approvals inbox, CalDAV calendar sync | **Done** |

### Domain rules

**Internal work order ID** — `YYYY-MM-PRJID-NNNN`

- `PRJID` is the client's project ID, or `0000` when the job has no project
- Jobs without a project use a global counter that resets each January
- Jobs in a project use that project's own counter, which never resets
- Revisits append `-R1`, `-R2`, …, and the month is the revisit's month:

```
Original   INT WO 2026-07-PRJ12-0042    Assignment ID 887766
Revisit 1  INT WO 2026-08-PRJ12-0042-R1 Assignment ID R-887766
Revisit 2  INT WO 2026-09-PRJ12-0042-R2 Assignment ID R-887766
```

`R-` is added only when the client reuses the original Assignment ID. A genuinely
new Assignment ID is stored as-is and does not change our internal number.

**Time** — stored in UTC, displayed in the site's time zone (default
`America/Los_Angeles`). Totals are reported as `2.00 hrs`, always two decimals.

Clock in/out snaps to the rounding interval once, at the press; pay is then
computed from the snapped time with no second rounding. The snap is **not**
"nearest" — the window is `[target − 3 min, target + 2 min)` at five-minute
steps, which rounds 09:57 up to 10:00 where nearest would give 09:55. The half
minute of bias is deliberate and favours the tech.

Two totals come out of the same visits and must not be confused. The **client**
is billed for the span the crew was on site — earliest clock-in to latest
clock-out across everyone, breaks included. A **tech** is paid for their own
visits minus their own unpaid breaks. A tech who leaves early is still covered
by the supervisor who stayed on.

Because the snap rounds up, a fresh clock-in is often a minute or two in the
future. The card says "Clock starts 10:05" for that stretch rather than showing
a counter frozen at zero, which reads as a failed tap.

**Photos** — everything becomes JPEG, capped at 2400px on the long edge. HEIC
from an iPhone is decoded by libvips where the build supports it and by a
pure-JS libheif otherwise, because that format is the entire input path and
cannot be allowed to fail on a platform quirk. EXIF is read before conversion
strips it: the timestamp and GPS fix are the only evidence a photo was taken on
site. The stamp goes bottom-right:

```
2026-07-28-887766-SBUX-#24541
```

**Exports** — three, with different audiences.

The **text report** follows a fixed template that gets pasted into an email to
the subcontractor, so its labels and their order are not ours to change. Two
conventions for an absent value: `-` for a required field that was deliberately
bypassed or never obtained, `N/a` for one that was optional. A site with no
manager on duty reads `No MOD`, which is a fact rather than a gap. Nothing
internal appears — no hotel claims, no INC number, no internal status, no pay.

The **ZIP** is named `YYYY-MM-DD-AssignmentID.zip` for the date the crew
arrived, and lays out as:

```
Pre-Install/<tech>/IMG_0001.jpg
Post Install/<tech>/…
Signatures/MOD-Dana Reyes-Signature.png
Receipts/…
<Company> INT WO/2026-07-PRJ12-0042.pdf
887766-Report.txt
```

Photos sit under their section and then under whoever took them, so a two-tech
job is not an unsorted pile. It streams rather than buffering — thirty full-size
photos should not sit in memory while a phone pulls them over Tailscale.

The **internal PDF work order** is rendered on demand, never stored. Generated
at scheduling it shows the plan; pulled after checkout it carries the times, the
narrative and the signatures. There is no stale copy to wonder about, and being
internal it may show the INC number, hotel claims and internal status.

**Checkout** is a run-through, not a button. Each step commits as it is
completed, so a tech who loses signal after capturing the MOD's signature does
not have to find that person again. The same wizard in *prepare* mode stops
short of the clock-out, which is what you want when the manager is available
now but the work runs on for another hour. A job missing a required deliverable
cannot be closed without someone holding the override, and the override is
recorded.

**Money** — USD. Rate lookup runs job override → tech + project → tech + client →
tech default → non-billable. Unpaid breaks reduce pay but not the client-facing
onsite time.

Pay weeks run Monday to Sunday and are approved by the tech's **direct
supervisor** — the person who actually pays them — whatever projects the week's
work fell under. A manager may step in, which is recorded and notified rather
than hidden. A week is filed under the month its Monday falls in, so a week
straddling September and October is counted once, in September.

Received pay is recorded twice on purpose: once for the week and once for each
job. A short week is only actionable if you can see which job was cut. Both drop
to **REDUCED** automatically when the amount is under what was expected.

Rebuilding a week recomputes hours and reimbursements from the time records but
leaves overrides, received amounts and notes alone — those are decisions someone
made, not figures to recalculate. Money is handled in integer cents throughout.

Dates in URLs (`?week=2026-06-15`) are calendar dates in the company zone, not
UTC instants. Read with the plain `Date` constructor they land a day early on
the west coast, which puts the whole week off by one.

Two separate things fund travel:

- **Travel reimbursement** is money the customer allocates for a particular job
  or project. It is paid, appears in the pay journal, and has no tech-level
  default because it never belongs to a person.
- **Mileage** is a write-off record for the tech's own 1099 deductions, and a
  signal to supervisors that a tech has actually set off. It is logged per leg
  of driving with odometer readings and photos, needs no approval, and does not
  enter payroll.

**Crew** — a job's crew can change while it is running, which is how a revisit
and a tech's ad-hoc job get anybody on them at all: both are created empty. A
tech raising an ad-hoc job is put on it automatically, since they cannot assign
anyone and are standing in front of the work.

Adding someone resolves their rate the same way creation does and copies it onto
the assignment, so re-rating a project later cannot rewrite work that already
happened. Somebody who has clocked in or uploaded anything cannot be taken off —
their hours are the payroll record. Reassigning past that point means adding the
replacement, not erasing the original. Every change lands on the job's timeline.

**Calendar sync** — one calendar per tech, named
`417-SYS: QuickTec (name@417group.org)`, all owned by a single system account
that shares each one read-only with the tech and their direct supervisor. One
account holding everything is what makes provisioning possible without asking
five people for credentials.

Sync is **one-way, app → NextCloud**. An event edited or deleted over there is
restored on the next push, so nobody is misled into thinking a change in their
phone's calendar meant anything. It runs in the background after a change that
matters — crew, schedule, estimate, clock-out — and there is a button on
`/settings/integrations` for a manual sweep.

An event runs for the job's **estimate** until the tech clocks out, then for the
real time; a job scheduled without an estimate gets two hours, because a
zero-length event is invisible in most clients. Each event is fingerprinted, so
a sweep that changes nothing uploads nothing. Taking a tech off a job deletes
their copy.

Use a NextCloud **app password** for `CALDAV_PASSWORD`. The whole feature is
optional: leave the credentials blank and the app behaves exactly as before,
with the settings page saying so.
