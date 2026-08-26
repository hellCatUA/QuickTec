# One name, two answers

What somebody sees when they open `quicktec.417group.org` without the VPN.

Today: nothing. The name resolves, from anywhere in the world, to the server's
address on the VPN — an address with no route to it from the public internet.
The browser does not fail, it simply waits, and then says something unhelpful
about the site taking too long to respond. A tech in a parking lot has no way to
tell that from the app being broken.

After this, the same name means two different things depending on which side of
the VPN is asking:

| Asking from | Answer | What opens |
| --- | --- | --- |
| the public internet | Cloudflare | a page saying the VPN is needed |
| the VPN | this server | QuickTec |

Two things worth being clear about before starting, because they are the reason
to do it this way:

- **Nothing is exposed.** No ports are opened, no forwarding is set up, and the
  public IP of the building is not written down anywhere. Cloudflare serves the
  notice page from its own machines and never talks to this one.
- **It removes an exposure rather than adding one.** The server's VPN address is
  in public DNS right now, for anybody who thinks to look. At the end of this it
  is not: it lives in one file on the server, and that file is not in git.

---

## What it is made of

```
deploy/split-dns/     a dnsmasq container that answers for the name, on the VPN only
deploy/vpn-notice/    the static page Cloudflare serves to everybody else
```

---

## 1. Before you start

**Get the server's VPN address.** On the OMV host:

```bash
docker exec tailscale tailscale ip -4          # → 100.x.y.z
```

**Check nothing already holds port 53.**

```bash
ss -lnup | grep ':53 '
ss -lntp | grep ':53 '
```

`systemd-resolved` on `127.0.0.53` and `127.0.0.54` is fine, and is what a
Debian box normally shows. Those are addresses of their own; this binds
`127.0.0.1`, and the two coexist — dnsmasq starts and answers with resolved
still holding both. Anything listening on `127.0.0.1:53` itself, or on the
tailnet address, is a real conflict and has to be dealt with first. (If you
would rather not touch it, drop the `interface=lo` line from `dnsmasq.conf` and
the healthcheck from the compose file; only local testing loses out.)

**MagicDNS.** The documentation says it is optional and not required by the
other DNS settings, but split DNS not applying with it switched off is a
long-standing complaint. Try step 3 as you are; if the name still resolves to
the public answer on a connected device, turn MagicDNS on and try again. Read
the next section before blaming it, though — a browser doing its own DNS looks
exactly the same from the outside.

---

## 2. The resolver

```bash
cd /docker/apps/quicktec/deploy/split-dns
cp records.conf.example records.conf
```

Put the address from step 1 into `records.conf`:

```
address=/quicktec.417group.org/100.x.y.z
```

Do this **before** the first `up`. Docker creates a directory in place of a bind
mount whose source is missing, and dnsmasq then starts perfectly happily while
answering nothing at all.

```bash
docker compose up -d
docker compose logs -f dns          # expect: "reading /etc/dnsmasq.d/records.conf"
```

Prove it. A server install has no `dig` — it is in `dnsutils`, not a package
called `dig` — and does not need one, because the container carries a resolver
client of its own:

```bash
docker compose ps                                     # → healthy

docker exec quicktec-dns nslookup quicktec.417group.org 127.0.0.1
docker exec quicktec-dns nslookup quicktec.417group.org 100.x.y.z
docker exec quicktec-dns nslookup example.com 127.0.0.1
```

`healthy` is itself the first of those lookups: the healthcheck asks the running
dnsmasq the one question it exists to answer, so a container that reports
healthy is a container that is answering.

The third line matters more than it looks. The VPN only routes the one domain
here, so a resolver that fails everything else works fine for months and then
breaks something unrelated in a way nobody traces back to this container.

If `dig` is wanted anyway — `apt install -y dnsutils`, then the same three as
`dig +short NAME @SERVER`.

---

## 3. Point the VPN at it

Only once step 2 answers. Sending the name at a resolver that is not running
takes it away from everybody on the VPN at once.

In the VPN admin console, under **DNS → Nameservers**:

1. **Add nameserver → Custom**, and give it `100.x.y.z` — the address from
   step 1.
2. Turn on **Restrict to domain** (split DNS) and give it
   `quicktec.417group.org`.

**Custom, not one of the presets.** The same dropdown offers Cloudflare, Google
and the rest as one-click entries, and picking one saves cleanly, shows the
Split DNS badge, and reads exactly like a working configuration. What it
actually does is send this one name to a *public* resolver — the answer the
split exists to avoid — so it looks right and changes nothing, and it will go on
looking right after the public record moves and the split stops being harmless.
A preset cannot be edited into a custom address either; delete it and add it
again from the Custom option.

That is the whole change. Every other name a device looks up still goes wherever
it was already going; only this one is sent here, and only while the VPN is on.

If the tailnet has a hand-written ACL rather than the default allow-all, it needs
to let devices reach port 53 on that node, TCP and UDP.

Check from a laptop **with the VPN on**. On Linux this needs nothing installed,
and asks the system rather than a particular server — which is the question that
actually matters here:

```bash
getent hosts quicktec.417group.org     # → 100.x.y.z
```

On macOS `dig` talks straight to the network's resolver and ignores the split
entirely, so it will keep showing the public answer no matter how well this
works. Ask the system instead:

```bash
dscacheutil -q host -a name quicktec.417group.org
```

### Browsers that do their own DNS

Read this one before switching the public record over, because it is the failure
that arrives late and looks like something else.

Firefox ships with DNS over HTTPS on by default in some regions. It does not ask
the operating system anything — it asks Cloudflare directly over HTTPS, which
means the VPN's split never enters into it. Today that is harmless: the public
answer *is* the right one. From the moment the public answer becomes the notice
page, Firefox shows that notice to somebody who is connected, and keeps showing
it, because the page's own check is resolved the same way.

Chrome, Edge and Safari use the system resolver here and are not affected —
Chrome only upgrades to DoH when the system resolver is one it recognises, and
the VPN's is not.

The fix is per-domain rather than switching the feature off. In `about:config`:

```
network.trr.excluded-domains        417group.org
```

It is a comma-separated list, so append rather than replace, and add `ts.net`
alongside if MagicDNS names are wanted too. Everything else still goes over DoH.
On a managed machine the same thing can be set once in a `policies.json`.

This is almost certainly also the explanation for Firefox misbehaving whenever
MagicDNS was switched on: `*.ts.net` resolves nowhere on the public internet, so
Cloudflare answers "no such name" and Firefox believes it. There is nothing to
fix on the VPN's side, and switching MagicDNS off treats the symptom.

---

## 4. The public answer

The page lives in `deploy/vpn-notice/`. It is three files and no build step —
`public/index.html`, an identical `public/404.html` so a bookmarked deep link
lands on the same explanation, and `public/_headers` — plus a `wrangler.jsonc`
that says what to do with them.

Cloudflare folded Pages into Workers, so there is no "create a Pages project"
any more. A static site is a Worker that serves assets and has no script of its
own, which is what the config describes. Everything under `public/` is published
to the internet; the config stays outside it deliberately.

It says almost nothing, on purpose. The company mark carries it: the logo
already draws a laptop, the company, and the network behind it, so the link is
cut where the VPN should be and the picture says the rest. Underneath that is a
heading, one sentence and a button. The mark is traced into the page as vector
paths in `currentColor`, so it follows the theme and needs no second copy for
light mode, and the whole page is one request with nothing loaded from anywhere.

### Deploying it from this repository

**Workers & Pages → Create → Import a repository**, and pick this one. The
wizard asks for rather more than a static site needs; most of it is left empty.

| Field | Value |
| --- | --- |
| Project name | `quicktec-vpn-notice` |
| Build command | *(empty)* |
| Deploy command | `npx wrangler deploy` |
| Builds for non-production branches | off |
| **Protect with Cloudflare Access** | **off** |
| Advanced settings → Path | `deploy/vpn-notice` |
| Advanced settings → Non-production branch deploy command | *(empty)* |
| API token | Create new token |
| Variables | *(none)* |

**Access has to stay off.** It is the right answer for an internal tool and the
wrong one here: it would put a login in front of the page whose entire job is to
be readable by somebody who cannot log in yet.

`Path` is the one that matters — it tells the build where `wrangler.jsonc` is.
Without it the deploy runs at the repository root, finds no config, and fails.

The deploy succeeds and the Worker serves nothing, because a new Worker is
published with every URL switched off — the overview says "No URLs enabled" and
that is the finished state, not a step still running.

Go to **Domains → Worker URL** and turn on the **Production**
`…workers.dev` toggle. Open that address and check the page there first: it is a
real deploy on a throwaway hostname, so nothing has changed for anybody yet.

The API token in the wizard is for later, not for this. It is what lets
Cloudflare rebuild on a push to the repository; the first deploy happens without
it. Add one under the project's build settings if automatic rebuilds are wanted,
or leave it — for three files that change twice a year, deploying by hand is a
defensible answer.

### Or without the repository

Nothing here needs a git connection, and a static page that changes twice a year
does not obviously want a deploy running on every push to the app. The
alternative is **Workers & Pages → Create → Upload assets**, dropping the three
files from `deploy/vpn-notice/public/` — or, from a checkout:

```bash
cd deploy/vpn-notice && npx wrangler deploy
```

### Pointing the name at it

This is the switch, and the only step here that changes anything for anybody.
Do it once step 3 is answering from the server, not before.

Cloudflare will not take a hostname that already has a record on it, and does
not offer to replace one:

> Hostname 'quicktec.417group.org' already has externally managed DNS records
> (A, CNAME, etc). Delete them first or try a different hostname.

So the old record goes first, and between it going and the custom domain being
attached the name resolves nowhere on the public internet. That is seconds if
the two are done back to back. Write down what is being deleted before deleting
it: an **A** record on `quicktec`, pointing at the tailnet address, **DNS only**
— grey cloud, never proxied. Putting that back is the way out if anything here
goes wrong.

1. **DNS → Records** on the `417group.org` zone. Delete the `quicktec` A record.
   Public resolution of the name stops at this moment.
2. **Workers & Pages → quicktec-vpn-notice → Domains → Add Domain** →
   `quicktec.417group.org`. Public resolution comes back, pointing at the
   notice, and Cloudflare writes its own record.

**That record going away is the point of the exercise** — from here the address
is not published anywhere.

Nobody on the VPN should notice any of it: their answer comes from the resolver
on the server and never went near public DNS. If somebody on the VPN *does* lose
the app while this is happening, that is step 3 being wrong rather than bad luck
— put the A record back and fix the split first.

Check from a device **with the VPN off** — mobile data on a phone is the honest
test:

```
https://quicktec.417group.org        → the notice page
https://quicktec.417group.org/jobs   → the same notice page
```

Give it a minute the first time; the old record may still be cached from before.

### What must never go on that page

Anyone can read it — everything under `public/` is on the open internet, and it
is also reachable at the `workers.dev` address whatever DNS says. It carries no
address, no internal hostname, and no mention of which VPN product is in use: a
person who needs the VPN already has it or knows who to ask, and a person who
does not need to learn anything from a page they cannot use. The comment at the
top of `index.html` says so, and `scripts/verify-domain.ts` enforces it — no VPN
product named, no tailnet address, and `404.html` still identical to the page it
copies.

---

## 5. The certificate

Nginx Proxy Manager holds a certificate for `quicktec.417group.org` and renews it
with a DNS challenge, by writing a TXT record at
`_acme-challenge.quicktec.417group.org`. That is a different name from the one
Cloudflare Pages now occupies and the two do not collide — but it is worth
proving rather than finding out in sixty days.

Force a renewal in NPM once the switch is done, and check it passes.

The certificate Pages serves for the public side is Cloudflare's own and is
nothing to do with this one. Two servers, two certificates, the same name, and
neither ever sees the other's traffic.

---

## 6. What did not change

- **The app.** `AUTH_URL`, the NPM proxy host, the compose file: all untouched.
  QuickTec is reached at the same address by the same people.
- **Devices on the office LAN but not on the VPN.** They ask the LAN's resolver,
  which asks the internet, which now says Cloudflare — so they get the notice
  page even with the server two rooms away. If that matters, point the router's
  DNS at the same container and they will be answered like everyone else.
- **The offline page inside the app.** Somebody who already has QuickTec
  installed and opens it without the VPN now reaches the Cloudflare page in a
  moment instead of waiting ten seconds for the app's own offline notice. Both
  say the same thing; the fast one wins.

---

## 7. When it misbehaves

| What you see | Where to look |
| --- | --- |
| Still the notice page with the VPN on, in Firefox only | DNS over HTTPS. See "Browsers that do their own DNS" above |
| Still the notice page with the VPN on, everywhere | The split not saved; MagicDNS off; the device's DNS cache, which clears by toggling the VPN off and on |
| `SERVFAIL` with the VPN on | `docker compose ps` — and check `records.conf` is a *file*, not a directory Docker made |
| The container restarts in a loop | Something else has port 53: `ss -lnup \| grep ':53 '` |
| `dig` disagrees with the browser, on a Mac | `dig` bypasses the split. Use `dscacheutil -q host -a name …` |
| The Worker deployed and serves nothing | Every URL is off on a new Worker. Domains → Worker URL → enable Production |
| The split saved but the answer never changes | The nameserver is a public preset rather than a Custom address. See step 3 |
| "already has externally managed DNS records" | Expected. Delete the `quicktec` A record first — see step 4 |
| Cloudflare error rather than the notice page | The custom domain is not attached to the Worker yet |
| Notice page appears *while* on the VPN | A cached copy. `_headers` sets `no-store`; check it was deployed with the site |
| Nothing resolves at all after a reboot | tailscale0 arrives after Docker. The container retries; give it a minute and check the logs |

---

## Later

**WireGuard instead.** The same container serves it — a WireGuard client config
takes `DNS = 100.x.y.z` (or whatever address it has on the new network), and
nothing else here changes.

**People who cannot have the VPN at all.** Client coordinators and
subcontractors signing in without a NextCloud account are never going to be
given access to the company network, and this page is a dead end for them rather
than an instruction. The answer for that is a Cloudflare Tunnel — an outbound
connection from this server to Cloudflare, gated by Cloudflare Access, still with
no port open and no address published. It can sit on a second hostname beside
this one without disturbing any of it.
