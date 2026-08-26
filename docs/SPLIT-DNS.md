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

`systemd-resolved` on `127.0.0.53` is fine — that is a different address from
the `127.0.0.1` this binds. Anything listening on `127.0.0.1:53` or on the
tailnet address is not, and has to be dealt with first. (If you would rather not
touch it, drop the `interface=lo` line from `dnsmasq.conf` and the healthcheck
from the compose file; only local testing loses out.)

**Turn MagicDNS on** in the VPN admin console if it is not already, under DNS.
The split-DNS routing in step 3 does not apply without it — the setting saves,
looks right, and does nothing.

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

Prove it from the host:

```bash
dig +short quicktec.417group.org @127.0.0.1        # → 100.x.y.z
dig +short quicktec.417group.org @100.x.y.z        # → 100.x.y.z, the way a client will ask
dig +short example.com @127.0.0.1                  # → a real answer, not SERVFAIL
```

The third one matters more than it looks. The VPN only routes the one domain
here, so a resolver that fails everything else works fine for months and then
breaks something unrelated in a way nobody traces back to this container.

---

## 3. Point the VPN at it

In the VPN admin console, under **DNS → Nameservers**:

1. Add a nameserver, `100.x.y.z` — the address from step 1.
2. Turn on **Restrict to domain** (split DNS) and give it
   `quicktec.417group.org`.

That is the whole change. Every other name a device looks up still goes wherever
it was already going; only this one is sent here, and only while the VPN is on.

If the tailnet has a hand-written ACL rather than the default allow-all, it needs
to let devices reach port 53 on that node, TCP and UDP.

Check from a laptop **with the VPN on**:

```bash
dig +short quicktec.417group.org     # → 100.x.y.z
```

On macOS `dig` talks straight to the network's resolver and ignores the split
entirely, so it will keep showing the public answer no matter how well this
works. Ask the system instead:

```bash
dscacheutil -q host -a name quicktec.417group.org
```

---

## 4. The public answer

The page lives in `deploy/vpn-notice/`. It is three files and no build step:
`index.html`, an identical `404.html` so a bookmarked deep link lands on the same
explanation, and `_headers`.

In the Cloudflare dashboard:

1. **Workers & Pages → Create → Pages.** Upload the contents of
   `deploy/vpn-notice/` directly, or connect this repository and set the build
   output directory to `deploy/vpn-notice` with no build command.
2. On the project, **Custom domains → Set up a custom domain** →
   `quicktec.417group.org`.
3. Cloudflare will notice the existing record pointing at `100.x.y.z` and offer
   to replace it. Let it. **That record going away is the point of the exercise**
   — after this the address is not published anywhere.

Check from a device **with the VPN off** — mobile data on a phone is the honest
test:

```
https://quicktec.417group.org        → the notice page
https://quicktec.417group.org/jobs   → the same notice page
```

Give it a minute the first time; the old record may still be cached from before.

### What must never go on that page

Anyone can read it. It carries no address, no internal hostname, and no mention
of which VPN product is in use — a person who needs the VPN already has it or
knows who to ask, and a person who does not need to learn anything from a page
they cannot use. The comment at the top of `index.html` says so, and
`scripts/verify-domain.ts` checks that `404.html` has not drifted away from it.

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
| Still the notice page with the VPN on | MagicDNS off; the split not saved; the device's DNS cache, which clears by toggling the VPN off and on |
| `SERVFAIL` with the VPN on | `docker compose ps` — and check `records.conf` is a *file*, not a directory Docker made |
| The container restarts in a loop | Something else has port 53: `ss -lnup \| grep ':53 '` |
| `dig` disagrees with the browser, on a Mac | `dig` bypasses the split. Use `dscacheutil -q host -a name …` |
| Cloudflare error rather than the notice page | The custom domain is not attached to the Pages project yet |
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
