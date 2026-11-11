# QuickTec — working notes for Claude

README.md covers what the app is, its permissions and its suites;
docs/DEPLOYMENT.md covers the server. This file is what those do not say: how
the owner likes to work, how this code is written, and how to get a fresh
cloud container to the point where the suites run.

## Working with the owner

- Write to them in **Ukrainian**. Code, comments, commit messages and the docs
  in this repository stay in English.
- Work on the branch the session names, push only there, and open a pull
  request only when asked.
- They deploy it themselves, on their own server with Docker Compose
  (docs/DEPLOYMENT.md). Give them complete blocks to paste, say plainly whether
  a database migration is involved, and do not assume a step ran.
- After a large change they usually want a second, independent review by an
  agent. Offer one; start it when they say yes.
- What they have parked for later is listed in docs/ui-audit/README.md under
  "Open — waiting on the owner" and "Other open threads". Ask before acting on
  any of it.

## How this code is written

- Comments say why, in full sentences, and usually what went wrong before the
  code took its current shape. Keep that up: a fix carries the story of the
  bug it fixes, next to the line that fixes it.
- Who may do what is decided on the server, every time, through `can`,
  `permissionScope` (src/lib/session.ts), `canOnJob`, `canOnProject` and
  `jobScopeWhere` (src/lib/scope.ts). Hiding a button is never the check.
- A time is shown on the site's clock — the site's zone, else the company's
  default — as `MM-DD-YYYY h:mm AM` (`usDateTimeInZone`).
- Every screen has to work at 320 px wide, which is any phone with its text set
  larger, and in both themes. Aim for 44 px tap targets — the default button is
  `min-h-11` because techs press them with gloves on.
- On screen, a value is a word: roles, statuses and outcomes in title case from
  their label maps (`ROLE_LABEL`, `LIFECYCLE_META`, `OUTCOME_META`), never the
  enum.
- Scripts that write to a database refuse to run without
  `QUICKTEC_ALLOW_DESTRUCTIVE_VERIFY=1`, or, for the UI-audit ones, without the
  audit database in `DATABASE_URL`.
- The production build must not need a database (README, "Development"): run
  `npm run build:offline` after touching the root layout or anything it imports.

## A cloud container from scratch

PostgreSQL 16 is in the image but not running, and nothing survives a
container being replaced except what is pushed. A worker restart stops
Postgres and every server; bring them back the same way.

```bash
# Postgres on 5433, socket in /tmp, trust authentication. initdb only once.
su postgres -c "/usr/lib/postgresql/16/bin/initdb -D /var/lib/postgresql/qtdata -A trust"
su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /var/lib/postgresql/qtdata -o '-p 5433 -k /tmp' -l /var/lib/postgresql/qtdata/log.txt start"
psql -h /tmp -p 5433 -U postgres -c "create role quicktec superuser login"
createdb -h /tmp -p 5433 -U postgres -O quicktec quicktec
```

`.env` (git-ignored) for development — no real NextCloud is needed:

```bash
DATABASE_URL=postgresql://quicktec@localhost:5433/quicktec?schema=public
AUTH_URL=http://127.0.0.1:3000
AUTH_SECRET=...                       # openssl rand -base64 32
NEXTCLOUD_ISSUER=http://127.0.0.1:9/nc
NEXTCLOUD_CLIENT_ID=dev-client
NEXTCLOUD_CLIENT_SECRET=dev-secret
CALDAV_USERNAME=
CALDAV_PASSWORD=
UPLOADS_DIR=/absolute/path/to/repo/data/uploads
```

Then:

```bash
npm install
npx prisma migrate deploy && npm run db:seed
npm run build:offline                  # several minutes
sh scripts/dev-serve.sh &              # the build on :3000, against .env
sh scripts/ui-audit/suites.sh          # every suite in order; summary in .audit/logs/suites.txt
```

- The browser suites need `CHROMIUM_PATH=/opt/pw-browsers/chromium` (suites.sh
  sets it). Never run `playwright install`.
- `npm run verify` deletes the job the browser suites drive: run
  `npm run fixtures` after it (suites.sh does).
- `verify:profiles` can fail one history check on a database created minutes
  earlier; run it again before believing it.
- `verify:auth` needs a server of its own with a public `AUTH_URL` and the
  stand-in NextCloud as issuer. The commands are in the header of
  scripts/verify-auth.ts; with the standalone build that means stopping the
  :3000 server and starting `.next/standalone/server.js` with those variables.
- `cd` in one shell call carries into the next. Use absolute paths, or
  `cd /path/to/repo && …` in the same call.

## Looking at the interface

`scripts/ui-audit/` walks every screen as each role, at phone to desktop width,
in both themes, on its own database (`quicktec_audit`) and its own server
(:3100), and writes screenshots and a report under `.audit/` (git-ignored). The
last audit, what it fixed and what is still open, and the commands to run it
again: docs/ui-audit/README.md.

## Elsewhere

- The domain move to the new NextCloud and address was run from a step-by-step
  guide in the owner's Claude Docs:
  https://claude.ai/artifact/XSZNHktCDotuVejvAPNpj5
- docs/FORM-BLANKS.md — preparing a paying company's blank so it fills itself
  (naming its PDF fields after the catalogue).
