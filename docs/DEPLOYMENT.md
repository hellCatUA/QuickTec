# Deploying QuickTec

Step by step, from an empty directory to a working NextCloud sign-in.

Written against this stack, because it is the one QuickTec was built for:

| Container | Networking | Reached at |
| --- | --- | --- |
| `tailscale` | `network_mode: host` | provides `tailscale0` on the host |
| `npm` (Nginx Proxy Manager) | `network_mode: host` | listens on the host's `:80` and `:443` |
| `nextcloud` | bridge, published to loopback | `127.0.0.1:4080` |
| `quicktec-app` | bridge, published to loopback | `127.0.0.1:3100` |

Two consequences worth knowing before you start, because they explain most of
what follows:

- **NPM runs in the host network namespace.** Its `127.0.0.1` *is* the host's
  loopback, so it proxies to QuickTec at `http://127.0.0.1:3100` with nothing
  published to the LAN. This is why `APP_BIND` stays at its default.
- **QuickTec runs on a bridge network.** Its `127.0.0.1` is its own. It has to
  reach NextCloud by name, over the proxy, for two things: the OIDC token
  exchange and the calendar push. Step 8 deals with that.

And one thing to check before anything else: **NPM in host mode already holds
port 3000.** Its admin API listens there, so the default `APP_PORT` collides
with it. Step 3 picks a free port instead.

---

## 1. DNS and Tailscale

QuickTec is not exposed to the internet. `quicktec.417group.org` should resolve
to the OMV box's tailnet address (`100.x.y.z`), exactly like `cloud`:

```bash
tailscale ip -4          # on the OMV host, inside the tailscale container:
docker exec tailscale tailscale ip -4
```

Create the record in the `417group.org` zone pointing at that address. Because
the name never resolves from the public internet, the certificate in step 5 has
to use a **DNS challenge**, not HTTP.

Check from a laptop on the tailnet:

```bash
dig +short quicktec.417group.org      # → 100.x.y.z
```

A public record pointing at a tailnet address gets you running, but it has two
costs: the address is published to anybody who looks, and somebody who opens the
app without the VPN waits out a connection timeout and is told nothing useful.
[docs/SPLIT-DNS.md](SPLIT-DNS.md) replaces it with a public record that serves a
"turn the VPN on" page and a resolver that answers the same name properly from
inside — no ports opened, and the address no longer in public DNS. Worth doing
once the stack is up; nothing else in this guide depends on it.

---

## 2. Directories

Keep to the layout the other apps use: config beside the compose file, bulk
data on the pool where OMV's snapshots reach it.

```bash
mkdir -p /docker/apps/quicktec
cd /docker/apps/quicktec
git clone https://github.com/hellCatUA/QuickTec.git .

mkdir -p data/postgres                   # beside the checkout, wherever it is
mkdir -p /tank/data/quicktec/uploads     # on the pool, deliberately elsewhere
```

**The uploads directory must belong to uid 1001.** The app image runs as a
fixed unprivileged user (`nextjs`, 1001:1001) rather than the linuxserver
`PUID`/`PGID` convention, so:

```bash
chown -R 1001:1001 /tank/data/quicktec/uploads
ls -ld /tank/data/quicktec/uploads       # expect: drwxr-xr-x ... 1001 1001
```

A bind mount takes the ownership of the host directory, replacing whatever the
image set up. That means this is not something the image can fix for you, and
nothing about it looks wrong until the first file is saved.

`.env.example` already points `UPLOADS_HOST_DIR` here, and compose refuses to
start without it rather than quietly mounting something else. If you move it,
the chown moves with it — it applies to whatever `.env` names, not to the path
written above:

```bash
cd /docker/apps/quicktec
chown -R 1001:1001 "$(grep '^UPLOADS_HOST_DIR=' .env | cut -d= -f2-)"
```

Postgres sorts its own ownership out on first start; you do not need to touch
`data/postgres`.

> Skipping the `chown` is the single most common first-run failure. Everything
> else works — signing in, planning jobs, clocking on — right up until somebody
> uploads a photo or adds a company's sign-off form, and then it fails with
> `EACCES: permission denied`. The app says so in words and the dashboard warns
> about it before anybody gets that far (step 9), but it is five seconds of
> work here and a call from a tech on site otherwise.

---

## 3. `.env`

```bash
cp .env.example .env
openssl rand -base64 32        # AUTH_SECRET  — any characters are fine here
openssl rand -hex 24           # POSTGRES_PASSWORD — hex, for the reason below
nano .env
```

Pick the host port first. Nginx Proxy Manager in host mode runs its own admin
API on **3000**, so the default collides with it:

```bash
ss -ltnp | grep -E ':(80|81|443|3000)\s'
```

If 3000 is taken — it will be — set `APP_PORT=3100` (or anything free). Only
the host side moves; the container still listens on 3000, and 3100 is what goes
into NPM in step 5.

> The symptom of getting this wrong is confusing: `curl 127.0.0.1:3000/api/health`
> answers `{"error":{"code":404,"message":"Not Found - /api/health"}}`. That is
> NPM's API replying, not QuickTec. QuickTec's own 404 is an HTML page.

Fill in what you can now and come back for the NextCloud values in step 7:

```ini
# Database. Only ever used between the two containers, and written down once —
# compose builds the connection string from these three.
POSTGRES_USER=quicktec
POSTGRES_PASSWORD=<openssl rand -hex 24>
POSTGRES_DB=quicktec

# Auth
AUTH_URL=https://quicktec.417group.org
AUTH_SECRET=<openssl output>

# NextCloud OIDC — filled in at step 7
NEXTCLOUD_ISSUER=https://cloud.417group.org
NEXTCLOUD_WELL_KNOWN=
NEXTCLOUD_CLIENT_ID=
NEXTCLOUD_CLIENT_SECRET=

# Calendar sync — filled in at step 9, optional
CALDAV_USERNAME=417-sys
CALDAV_PASSWORD=

# Storage
# UPLOADS_DIR is the path inside the container and never changes.
# UPLOADS_HOST_DIR is where those files really live. It must belong to
# 1001:1001 (step 2), and compose will not start without it.
UPLOADS_DIR=/data/uploads
POSTGRES_DIR=./data/postgres
UPLOADS_HOST_DIR=/tank/data/quicktec/uploads

# Runtime
TZ=America/Los_Angeles
NODE_ENV=production
APP_PORT=3100
# How long a schema change waits for a table the old app is still holding
# before giving up and saying so. Raise it on a slow disk.
MIGRATE_LOCK_TIMEOUT=15s
```

**Leave `DATABASE_URL` commented out.** `docker-compose.yml` derives it from
the three variables above, so the password exists in exactly one place. Set it
only to reach a Postgres that compose does not run — an external server, or a
local one in development — in which case it wins over the derived value.

**Do not use `openssl rand -base64` for the database password.** Base64 output
contains `/`, and a `/` inside a connection string ends the host part, so
`postgresql://quicktec:ab/cd@db:5432/quicktec` is read as host `quicktec`, port
`ab` and fails with:

```
Error: P1013: The provided database string is invalid.
invalid port number in database URL.
```

`openssl rand -hex 24` gives 96 bits of entropy using only `0-9a-f`, which
needs no escaping anywhere. (`AUTH_SECRET` is never parsed as a URL, so base64
is fine there.)

To see what compose actually resolved, with the secrets masked:

```bash
docker compose config | grep -m1 DATABASE_URL | sed -E 's/[A-Za-z0-9]/x/g'
```

Every letter and digit becomes `x`, so only the punctuation shows — which is
exactly where the problem always is. A healthy line looks like

```
      xxxxxxxx_xxx: xxxxxxxxxx://xxxxxxxx:xxxxxxxx@xx:xxxx/xxxxxxxx?xxxxxx=xxxxxx
```

An extra `/`, a quote, or a trailing space stands out immediately.

Leave `APP_BIND` unset. It defaults to `127.0.0.1`, which is what NPM needs and
nothing else can reach.

---

## 4. Start the stack

```bash
docker compose up -d --build
docker compose ps
```

Three services, in this order:

1. `quicktec-db` — Postgres 17, healthchecked
2. `quicktec-migrate` — applies migrations and the idempotent seed, then
   **exits 0**. `Exited (0)` is success, not a crash
3. `quicktec-app` — waits for the migrator to finish, then serves on
   `APP_PORT`

```bash
docker compose logs migrate      # should end with the seed summary
curl -s http://127.0.0.1:3100/api/health
# {"ok":true,"at":"2026-07-28T…"}
```

If `migrate` exited non-zero, the app will not start at all — that is
deliberate, so it never serves traffic against a schema it does not match.

---

## 5. Nginx Proxy Manager

**Hosts → Proxy Hosts → Add Proxy Host**

*Details tab*

| Field | Value |
| --- | --- |
| Domain Names | `quicktec.417group.org` |
| Scheme | `http` |
| Forward Hostname / IP | `127.0.0.1` |
| Forward Port | `3100` — your `APP_PORT` |
| Cache Assets | off — Next.js sets its own cache headers |
| Block Common Exploits | on |
| Websockets Support | on |

`127.0.0.1` works because NPM is in the host network namespace. If you ever
move NPM to a bridge network, this becomes the host's LAN address and
`APP_BIND` in `.env` has to change to match.

*SSL tab*

- Request a new certificate, **Use a DNS Challenge**, pick your DNS provider
  and paste its API token
- Force SSL: on
- HTTP/2: on
- HSTS: optional, and only if every other name on this domain is HTTPS too

*Advanced tab* — paste this. Photo uploads are the reason:

```nginx
client_max_body_size 32m;
proxy_read_timeout 300s;
proxy_send_timeout 300s;
proxy_request_buffering off;
```

The app accepts uploads up to 25 MB per request and a tech on one bar of signal
can take minutes to push thirty photos. Nginx's 1 MB default cuts them off with
a `413` that looks, from the phone, like the app is broken.

Now open `https://quicktec.417group.org` from a device on the tailnet. You
should get the sign-in page, saying it is not configured yet — that is step 7.

---

## 6. NextCloud: groups and accounts

**Users → Groups → add** these five. The names are matched exactly, in
lowercase:

| Group | Role in QuickTec |
| --- | --- |
| `quicktec-manager` | Manager — runs the business side of every job |
| `quicktec-admin` | Administrator — integrations, users, backups |
| `quicktec-supervisor` | Supervisor — their crew and their projects |
| `quicktec-tech` | Tech |
| `quicktec-accountant` | Accountant |

Type the names exactly as written, with the hyphen and no spaces: NextCloud
derives the group **id** from what you type, and the id is what arrives in the
token. Case does not matter — QuickTec lowercases before matching — but
`QuickTec Tech` becomes the id `QuickTec Tech` and will not match anything.

Put every person who needs QuickTec into exactly one of them. Somebody in none
of these groups **cannot sign in at all** — that is the intended behaviour, not
an error to work around. Somebody in several gets the highest: Manager, then
Administrator, Supervisor, Accountant, Tech.

Roles are re-read on every sign-in, so moving somebody between groups takes
effect the next time they sign in. Nothing to change in QuickTec.

While you are here, create the calendar system account for step 9:

- **Users → New user**: username `417-sys`, a name like `417 System`, a strong
  password. It needs no group and no quota beyond the calendars.

---

## 7. NextCloud: the OIDC client

**Apps → search "OIDC" → install "OpenID Connect provider"** (app id `oidc`,
published by Nextcloud). This makes NextCloud the identity *provider*. Do not
confuse it with "OpenID Connect user backend", which is the opposite direction.

**Settings → Administration → Security → OpenID Connect provider → Add client**

| Field | Value |
| --- | --- |
| Name | `QuickTec` |
| Redirect URI | `https://quicktec.417group.org/api/auth/callback/nextcloud` |
| Signing algorithm | `RS256` |
| Type | Confidential |

The redirect URI has to match character for character, including the scheme and
the absence of a trailing slash. `/api/auth/callback/nextcloud` is fixed —
`nextcloud` there is the internal provider id, not your hostname.

Copy the generated **Client Identifier** and **Secret** into `.env`:

```ini
NEXTCLOUD_ISSUER=https://cloud.417group.org
NEXTCLOUD_CLIENT_ID=<client identifier>
NEXTCLOUD_CLIENT_SECRET=<secret>
```

Leave `NEXTCLOUD_WELL_KNOWN` empty. QuickTec looks for discovery at
`<issuer>/index.php/apps/oidc/openid-configuration`, which is where this app
serves it. Only set the variable if yours is somewhere else — check with:

```bash
curl -s https://cloud.417group.org/index.php/apps/oidc/openid-configuration | head
```

QuickTec requests the scopes `openid profile email roles`. The **`roles` scope
is what carries group membership** — without it every sign-in is refused with
"not in any quicktec-* group", because the token arrives with no groups in it.

Restart the app so it picks the values up:

```bash
docker compose up -d app
docker compose logs -f app
```

The sign-in page should now show a working **Sign in with NextCloud** button
instead of the configuration warning.

---

## 8. Letting the app reach NextCloud

The token exchange in step 7 happens **server to server**: the QuickTec
container itself calls `https://cloud.417group.org`. So does the calendar push
in step 9. On a bridge network that name often does not resolve, because it
lives inside Tailscale and Docker hands containers a public resolver.

Test it:

```bash
docker compose exec app node -e \
  "fetch('https://cloud.417group.org/status.php').then(r=>r.text()).then(console.log).catch(e=>console.log('FAILED:',e.message))"
```

If that prints NextCloud's status JSON, you are done — skip to step 9. If it
fails to resolve or connect, point the name at the host, where NPM is already
listening with the right certificate. Create
`/docker/apps/quicktec/docker-compose.override.yml`:

```yaml
services:
  app:
    extra_hosts:
      # cloud.417group.org lives inside Tailscale, which this container's DNS
      # cannot see. NPM listens on the host and serves the right certificate
      # by SNI, so the name resolves to the host gateway instead.
      - "cloud.417group.org:host-gateway"
```

```bash
docker compose up -d app
```

Then run the test again. The override file is not tracked by git, so it
survives `git pull`.

> Do not be tempted to set `NEXTCLOUD_ISSUER` to `http://127.0.0.1:4080`. The
> issuer in the token has to match the issuer you asked, and the browser has to
> reach the same URL — an internal address breaks both.

---

## 9. First sign-in and setup

Sign in as a member of `quicktec-manager`. The first account to arrive is
created automatically with the role from its group.

The dashboard shows a checklist until these are done:

1. **`/settings/company`** — company name, logo, mileage rate, pay lag, time
   rounding. The logo appears on the internal work order
2. **`/settings/users`** — give every tech a **direct supervisor**. This is the
   person who approves and pays their week, so payroll is stuck until it is set
3. **`/settings/roles`** — the permission matrix, if the defaults do not fit

**If the checklist mentions the uploads volume, stop and fix that first.** It
means the container cannot write to it, so no photo, signature or export will
save. Go back to step 2, `chown` it, and reload the dashboard — the warning
goes away on its own, with no restart.

Worth proving rather than assuming, because it is the one thing on this page
that fails silently until a tech is standing on site:

```bash
docker compose exec app sh -c 'touch /data/uploads/.probe && rm /data/uploads/.probe && echo writable'
```

`writable` is the whole answer. `Permission denied` after a chown almost always
means the chown and `UPLOADS_HOST_DIR` are pointing at different directories —
ask the running container what it actually has mounted:

```bash
docker inspect quicktec-app \
  --format '{{range .Mounts}}{{.Source}} -> {{.Destination}}{{"\n"}}{{end}}'
```

The line ending `-> /data/uploads` is the directory that needs to belong to
1001, whatever the guide or your notes say.

Changing `UPLOADS_HOST_DIR` changes a bind mount, so the container has to be
recreated rather than restarted:

```bash
docker compose up -d app
```

Then turn on calendar sync. In NextCloud, sign in as `417-sys` →
**Settings → Security → Devices & sessions → Create new app password**, name it
`quicktec`, and copy the generated password.

```ini
CALDAV_USERNAME=417-sys
CALDAV_PASSWORD=<app password, not the login password>
```

```bash
docker compose up -d app
```

Go to **`/settings/integrations`** and press **Check connection** first: one
request to the system account's calendar list, which separates "QuickTec cannot
reach NextCloud" from "there is nothing to push" before you go looking for
either.

Then press **Sync calendars now** — it creates one calendar per tech, named
`417-SYS: QuickTec (name@417group.org)`, shares each read-only with the tech and
their direct supervisor, and pushes every job scheduled in the last month, along
with anything touched since and anything already in a calendar. **Rebuild from
every job** next to it reaches work older than that; use it once after turning
sync on, and any time a calendar has come up empty.

Sync is one-way. An event edited or deleted in NextCloud comes back on the next
push, so nobody is misled into thinking a change there meant anything.

Leaving `CALDAV_PASSWORD` blank turns the whole feature off cleanly; the page
says so and nothing else changes.

---

## 10. Installing on a phone

Safari on iPhone, on the tailnet: open `https://quicktec.417group.org`, then
**Share → Add to Home Screen**. It runs full-screen with its own icon, keeps
the session, and shows an offline notice rather than Safari's error page when
the signal goes.

Tailscale has to be connected for the app to load. It is worth telling the
crew that plainly — the failure looks like the app is down.

---

## Updating

```bash
cd /docker/apps/quicktec
git pull
docker compose stop app          # see below — this line matters
docker compose up -d --build
```

**Why `stop app` first.** `docker compose up` starts the migrator *alongside*
the running app, not instead of it. A release that changes a table has to take
an exclusive lock on it, and a single open transaction from the old app is
enough to block that — after which every other query on that table queues
behind the waiting migration, so the old app freezes too and never lets go.
The deploy then sits there until somebody notices.

Stopping the app first costs about twenty seconds of downtime and removes the
whole problem. If you forget, the migration now gives up after
`MIGRATE_LOCK_TIMEOUT` (15s by default), tells you what happened, and leaves
the database exactly as it was — the old app keeps serving and you can retry.

`migrate` runs on every deploy: it applies any new migrations and seeds
defaults for permissions the release has added. It never rewrites a permission
the database already knows about, so tuning in `/settings/roles` survives.

Check it landed:

```bash
docker compose logs migrate | tail -20
```

---

## Backups

| Path | Contents |
| --- | --- |
| `<checkout>/data/postgres` | Database |
| `/tank/data/quicktec/uploads` | Photos, signatures, receipts, generated exports |
| `/docker/apps/quicktec/.env` | Secrets — back this up somewhere else |

Both data paths are bind mounts, so OMV's own snapshot and rsync jobs cover
them. For a consistent database copy without stopping the stack:

```bash
docker compose exec -T db pg_dump -U quicktec quicktec \
  | gzip > /tank/backups/quicktec-$(date +%F).sql.gz
```

Restoring:

```bash
gunzip -c quicktec-2026-07-28.sql.gz \
  | docker compose exec -T db psql -U quicktec -d quicktec
```

Uploads are **not** served from the filesystem — every read goes through
`/api/files/<id>`, which applies the same job-scope check as the page linking
to it. Do not map that directory into Nginx as a static path; it would let
anyone with a URL read another crew's site photos.

---

## Troubleshooting

**`P1013: invalid port number in database URL`**
Something in the connection string is not URL-safe — almost always a `/` in the
password, from `openssl rand -base64`. Look at the resolved value with the
masking command above before changing anything: if `DATABASE_URL` is still set
explicitly in `.env`, that is what is being used, not the derived one.

```bash
grep -n '^DATABASE_URL' .env      # comment it out to use the derived value
printenv DATABASE_URL             # a shell export beats .env — unset it
```

Then, while the database is still empty:

```bash
docker compose down
rm -rf "$POSTGRES_DIR"/*          # confirm the path: docker compose config
openssl rand -hex 24              # into POSTGRES_PASSWORD
docker compose up -d --build
```

Postgres only reads `POSTGRES_PASSWORD` when it initialises an empty data
directory. Changing it later without clearing that directory leaves the old
password in place and the app cannot connect.

**`Bind for 127.0.0.1:3000 failed: port is already allocated`**
NPM's admin API. Move `APP_PORT` (step 3) and update the proxy host.

**`curl` on the app port answers `{"error":{"code":404,…}}`**
Same cause: that is NPM's API, not QuickTec. `ss -ltnp | grep :3000` shows who
actually holds the port.

**Sign-in fails immediately with `error=Configuration`**
The server could not complete its own half of the exchange. The page now runs
the discovery request itself and says which part failed; `docker compose logs
app | grep '\[auth\]'` prints the cause underneath. Discovery is fetched from
the OIDC app's own path rather than `/.well-known/openid-configuration`, which
NextCloud answers with a redirect that a metadata request may not follow — set
`NEXTCLOUD_WELL_KNOWN` if your install publishes it somewhere else again.

**The sign-in page says "Not configured yet"**
One of `NEXTCLOUD_ISSUER`, `NEXTCLOUD_CLIENT_ID`, `NEXTCLOUD_CLIENT_SECRET` is
empty in the app's environment. `docker compose config` shows what compose
actually resolved — a variable missing from `.env` silently becomes empty.

**"Your NextCloud account is not in any quicktec-* group"**
Either the account really is in none of them, or the groups are not reaching
the token. The usual cause is a group **id** that does not match — check it in
NextCloud's user admin, where the id is shown next to the display name, and
compare it to the table above. QuickTec accepts the claim under either `roles`
or `groups`, and a space or comma separated string as well as a list, so the
shape is rarely the problem. If the ids are right, update the `oidc` app: older
versions did not emit groups at all.

**`redirect_uri_mismatch` or an error page from NextCloud after the redirect**
The registered redirect URI is not exactly
`https://quicktec.417group.org/api/auth/callback/nextcloud`. A trailing slash
or `http` instead of `https` is enough.

**Signed in, then bounced straight back to the sign-in page**
`AUTH_URL` does not match the address in the browser, or `AUTH_SECRET` changed
— every existing session cookie becomes unreadable when it does.

**`invalid_request` mentioning `code_challenge`**
An old `oidc` app without PKCE support. Update the app from the App Store.

**Photo uploads fail, or stall and then fail**
`client_max_body_size` in the NPM Advanced tab (step 5), or the uploads
directory is not owned by 1001:1001 (step 2). `docker compose logs app` tells
the two apart: a `413` never reaches the app, an `EACCES` does.

**Every photo is refused, whatever it is**
Look at **Photo pipeline** on `/settings/integrations` first. It puts a picture
through the real pipeline on every load and names what broke, which separates
the three causes that look identical from the field:

- *The image library did not load* — sharp's native binary is built for a
  different architecture than the container runs on. Rebuild the image on the
  machine that will run it, or build with the matching `--platform`.
- *The HEIC fallback decoder did not load* — photos from an iPhone cannot be
  decoded. Rebuild; the dependency is in `package.json`.
- *The stamp will be an empty box* — the font at `assets/fonts` was not copied
  into the image. Photos still store, without their provenance label.

The upload itself now distinguishes a file that is not a picture from a server
that could not process one, and logs the real error either way:

```bash
docker compose logs app | grep '\[upload\]'
```

**A page shows `ERROR` and an eight-digit number**
That is a Next.js error digest. Production hides the real error from the
browser on purpose and prints it in the server log under the same number:

```bash
docker compose logs app | grep -B5 -A30 <the number>
```

Uploads name their own cause on screen instead — a digest here means something
that has not been given a message yet, and the log is the only place with it.

**Calendar sync reports failures for every tech**
Run the step 8 reachability test. `server unreachable` means DNS or routing;
`HTTP 401` means the app password is wrong or you used the account password.

**`quicktec-migrate` hangs and the app stops responding**
The old app is holding a table the migration needs. Stop it and the migration
completes immediately:

```bash
docker compose stop app
docker compose logs -f migrate
docker compose up -d
```

To see who is holding what:

```bash
docker compose exec db psql -U quicktec -d quicktec -c "
SELECT pid, state, now()-xact_start AS age, pg_blocking_pids(pid) AS blocked_by,
       left(query,80) AS query
FROM pg_stat_activity WHERE datname='quicktec' ORDER BY xact_start;"
```

If nothing is blocking anything and it still hangs, two migrate runs are
racing for Prisma's advisory lock. Clear the stale holder:

```bash
docker compose exec db psql -U quicktec -d quicktec -c \
  "SELECT pg_terminate_backend(pid) FROM pg_locks
   WHERE locktype='advisory' AND objid=72707369;"
```

Nothing is half-applied in either case — each migration runs in its own
transaction.

**A migration failed and now every deploy refuses to start**
Prisma records the failed attempt and will not go past it. If the attempt
applied nothing — which is the case for a lock timeout — the migrator clears
that record itself on the next run. If it got partway, that is a real question
about the state of the database: read `docker compose logs migrate`, decide
whether the change is there, and then tell Prisma which it was with
`migrate resolve --rolled-back` or `--applied`.

**`quicktec-migrate` keeps restarting**
It should not restart — it is `restart: "no"` and exits 0 on success. A
non-zero exit is a migration failure; the log says which one. The app stays
down on purpose until it succeeds.
