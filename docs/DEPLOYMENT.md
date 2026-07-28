# Deploying QuickTec

Step by step, from an empty directory to a working NextCloud sign-in.

Written against this stack, because it is the one QuickTec was built for:

| Container | Networking | Reached at |
| --- | --- | --- |
| `tailscale` | `network_mode: host` | provides `tailscale0` on the host |
| `npm` (Nginx Proxy Manager) | `network_mode: host` | listens on the host's `:80` and `:443` |
| `nextcloud` | bridge, published to loopback | `127.0.0.1:4080` |
| `quicktec-app` | bridge, published to loopback | `127.0.0.1:3000` |

Two consequences worth knowing before you start, because they explain most of
what follows:

- **NPM runs in the host network namespace.** Its `127.0.0.1` *is* the host's
  loopback, so it proxies to QuickTec at `http://127.0.0.1:3000` with nothing
  published to the LAN. This is why `APP_BIND` stays at its default.
- **QuickTec runs on a bridge network.** Its `127.0.0.1` is its own. It has to
  reach NextCloud by name, over the proxy, for two things: the OIDC token
  exchange and the calendar push. Step 8 deals with that.

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

---

## 2. Directories

Keep to the layout the other apps use: config beside the compose file, bulk
data on the pool where OMV's snapshots reach it.

```bash
mkdir -p /docker/apps/quicktec
cd /docker/apps/quicktec
git clone https://github.com/hellCatUA/QuickTec.git .

mkdir -p /docker/apps/quicktec/data/postgres
mkdir -p /tank/data/quicktec/uploads
```

**The uploads directory must belong to uid 1001.** The app image runs as a
fixed unprivileged user (`nextjs`, 1001:1001) rather than the linuxserver
`PUID`/`PGID` convention, so:

```bash
chown -R 1001:1001 /tank/data/quicktec/uploads
```

Postgres sorts its own ownership out on first start; you do not need to touch
`data/postgres`.

> Skipping the `chown` is the single most common first-run failure. It shows up
> as `EACCES: permission denied` the first time somebody uploads a photo —
> everything else works, which makes it easy to misread.

---

## 3. `.env`

```bash
cp .env.example .env
openssl rand -base64 32        # paste into AUTH_SECRET
nano .env
```

Fill in what you can now and come back for the NextCloud values in step 7:

```ini
# Database — the password is only ever used between the two containers.
POSTGRES_USER=quicktec
POSTGRES_PASSWORD=<long random string>
POSTGRES_DB=quicktec
DATABASE_URL=postgresql://quicktec:<same password>@db:5432/quicktec?schema=public

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
UPLOADS_DIR=/data/uploads
POSTGRES_DIR=/docker/apps/quicktec/data/postgres
UPLOADS_HOST_DIR=/tank/data/quicktec/uploads

# Runtime
TZ=America/Los_Angeles
NODE_ENV=production
APP_PORT=3000
```

`DATABASE_URL` uses the host `db` — the compose service name — and must carry
the same password as `POSTGRES_PASSWORD`. The two are separate variables
because Postgres reads one and Prisma reads the other.

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
3. `quicktec-app` — waits for the migrator to finish, then serves on port 3000

```bash
docker compose logs migrate      # should end with the seed summary
curl -s http://127.0.0.1:3000/api/health
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
| Forward Port | `3000` |
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

Go to **`/settings/integrations`**. It should show the system account as
configured. Press **Sync calendars now** — it creates one calendar per tech,
named `417-SYS: QuickTec (name@417group.org)`, shares each read-only with the
tech and their direct supervisor, and pushes every job scheduled in the last
week or later.

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
docker compose up -d --build
```

`migrate` runs again on every deploy: it applies any new migrations and seeds
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
| `/docker/apps/quicktec/data/postgres` | Database |
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

**Calendar sync reports failures for every tech**
Run the step 8 reachability test. `server unreachable` means DNS or routing;
`HTTP 401` means the app password is wrong or you used the account password.

**`quicktec-migrate` keeps restarting**
It should not restart — it is `restart: "no"` and exits 0 on success. A
non-zero exit is a migration failure; the log says which one. The app stays
down on purpose until it succeeds.
