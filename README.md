# QuickTec

Field service time tracking and reporting for a small team of technicians.
Self-hosted, English UI, sign-in through NextCloud.

Techs clock in on a job, see their earnings tick up live, fill in the report as
they work, and clock out through a guided checkout. Supervisors and managers see
the same jobs with the money attached, approve what needs approving, and export
the client-facing report, the full job archive, and the weekly pay journal.

---

## Status

**Phase 1 of 7 is complete.** What works today:

- NextCloud OpenID Connect sign-in, with roles read from NextCloud groups
- Three-layer permission model (base role, relationships, permission + scope)
- Editable permission matrix
- Company settings, user management, direct-supervisor assignment
- Dark/light theme (dark by default), responsive phone/tablet/desktop shell
- Installable PWA with an offline notice and a connection indicator
- Postgres schema for the whole domain, applied by migration
- Docker Compose deployment

Everything the app can currently do is reachable from the UI. Jobs, time
tracking, deliverables, exports and payroll land in later phases — see
[Roadmap](#roadmap).

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

### 1. NextCloud

Install the **OpenID Connect provider** app (`oidc`), then add a client:

- **Name:** QuickTec
- **Redirect URI:** `https://quicktec.417group.org/api/auth/callback/nextcloud`
- **Signing algorithm:** RS256
- **Scopes:** `openid`, `profile`, `email`, `roles`

The `roles` scope is what carries group membership. Copy the generated client ID
and secret. Create the five `quicktec-*` groups and put your users in them.

### 2. Configure

```bash
git clone <this repo> quicktec && cd quicktec
cp .env.example .env
openssl rand -base64 32   # paste into AUTH_SECRET
$EDITOR .env
```

| Variable | Notes |
| --- | --- |
| `DATABASE_URL` | Host is `db`, the compose service name |
| `AUTH_URL` | Public URL, e.g. `https://quicktec.417group.org` |
| `AUTH_SECRET` | 32+ random bytes |
| `NEXTCLOUD_ISSUER` | Your NextCloud base URL |
| `NEXTCLOUD_WELL_KNOWN` | Only if discovery is not at `<issuer>/index.php/apps/oidc/openid-configuration` |
| `NEXTCLOUD_CLIENT_ID` / `_SECRET` | From step 1 |
| `APP_BIND` | Defaults to `127.0.0.1`. Set to the LAN IP if NPM runs on another host |
| `TZ` | `America/Los_Angeles` |

If any of these are missing, the sign-in page says so instead of showing a
button that quietly does nothing.

### 3. Start

```bash
docker compose up -d --build
docker compose logs -f app
```

`db` starts, `migrate` applies migrations and the idempotent seed and exits,
then `app` comes up on port 3000.

### 4. Nginx Proxy Manager

Add a proxy host for `quicktec.417group.org` → `http://<omv-ip>:3000`, with
**Websockets support** and **Block common exploits** on, and a Let's Encrypt
certificate. NPM's default `X-Forwarded-*` headers are what the app expects;
`AUTH_TRUST_HOST` is already set in compose.

Because the subdomain resolves only inside Tailscale, use a DNS challenge for
the certificate.

### 5. First sign-in

The first person to sign in gets an account with the role from their NextCloud
group. Sign in as a member of `quicktec-manager`, then:

1. `/settings/company` — company name, logo, mileage rate, pay lag
2. `/settings/users` — give every tech a direct supervisor
3. `/settings/roles` — adjust the permission matrix if the defaults do not fit

The dashboard shows these as a checklist until they are done.

---

## Data & backups

| Path | Contents |
| --- | --- |
| `./data/postgres` | Database |
| `./data/uploads` | Photos, signatures, generated exports |

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
cp .env.example .env        # point DATABASE_URL at your local Postgres
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
| `npm run db:studio` | Prisma Studio |

The seed only writes role grants when the table is empty, so it never overwrites
a matrix a manager has tuned.

---

## Roadmap

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Auth, roles & permissions, company settings, theme, PWA shell, deployment | **Done** |
| 2 | Clients, customers, sites, projects; job creation and INT WO numbering | Next |
| 3 | Job page, read-only fields with change requests, time clock, breaks, live earnings | |
| 4 | Deliverables, photo pipeline, signatures, guided checkout, autosave | |
| 5 | Text report, ZIP archive, internal PDF work order | |
| 6 | Pay rates, mileage, reimbursements, pay journal, payroll | |
| 7 | Timelines, approvals inbox, statistics, CalDAV calendar sync | |

### Domain rules already fixed in the schema

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
`America/Los_Angeles`). Clock in/out snaps to 5 minutes once, at the press; pay
is then computed from the snapped time with no second rounding. Totals are
reported as `2.00 hrs`, always two decimals.

**Money** — USD. Rate lookup runs job override → tech + project → tech + client →
tech default. Travel reimbursement is set per job or project only, never as a
tech default. Unpaid breaks reduce pay but not the client-facing onsite time.
