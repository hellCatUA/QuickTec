import "dotenv/config";
import { createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import { calendarSlug } from "@/lib/calendar/caldav";
import { db } from "@/lib/db";
import { profileHistory } from "@/lib/profile-history";

/**
 * Drives the whole OpenID Connect handshake against a stand-in NextCloud.
 *
 * This exists because sign-in failed three times in a row in production, in
 * three different places, and nothing covered any of them: the browser suites
 * sign in with a cookie, and no unit test can reach a redirect, a discovery
 * document or an ID token. So the stand-in behaves like the real thing —
 * including the redirect NextCloud answers its spec-suggested discovery URL
 * with — and this signs real RS256 tokens and walks the full round trip.
 *
 * The four cases are the four ways it went wrong, or could:
 *   - everything in the ID token, which is the happy path
 *   - email and groups only in userinfo, which Auth.js never reads by itself
 *   - groups nowhere
 *   - no email anywhere
 *
 * Needs the app running on BASE_URL, with NEXTCLOUD_ISSUER pointing here and
 * AUTH_URL set to the public address — a real hostname, because `next start`
 * canonicalises a loopback address to `localhost` and the redirect URI check
 * would then compare two spellings of the same thing. The stand-in also
 * answers the few DAV requests a sign-in makes to share somebody's calendar,
 * so the app needs a CalDAV account too:
 *
 *   NEXTCLOUD_ISSUER=http://127.0.0.1:9999 \
 *   NEXTCLOUD_CLIENT_ID=dev-client NEXTCLOUD_CLIENT_SECRET=dev-secret \
 *   CALDAV_USERNAME=417-sys CALDAV_PASSWORD=app-password \
 *   AUTH_URL=https://quicktec.417group.org npm start
 *
 *   AUTH_URL=https://quicktec.417group.org npm run verify:auth
 *
 * The other suites want the app on a loopback AUTH_URL, since an https one
 * switches Auth.js to secure cookies that a plain-HTTP test cannot set. Run
 * this one against its own instance.
 */

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const NC_PORT = Number(process.env.FAKE_NEXTCLOUD_PORT ?? 9999);
const NC = `http://127.0.0.1:${NC_PORT}`;
const CLIENT_ID = process.env.NEXTCLOUD_CLIENT_ID ?? "dev-client";
/** Where the app sends the browser afterwards: its own public origin. */
const PUBLIC = (process.env.AUTH_URL ?? BASE).replace(/\/+$/, "");
let failures = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label}\n      got ${actual}${ok ? "" : `  want ${expected}`}`,
  );
}

// --- the stand-in -----------------------------------------------------------

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const jwk = createPublicKey(publicKey).export({ format: "jwk" });
const KID = "quicktec-test-key";

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function signIdToken(claims: Record<string, unknown>): string {
  const header = base64url(
    JSON.stringify({ alg: "RS256", typ: "JWT", kid: KID }),
  );
  const now = Math.floor(Date.now() / 1000);
  const payload = base64url(
    JSON.stringify({
      iss: NC,
      aud: CLIENT_ID,
      iat: now,
      exp: now + 300,
      ...claims,
    }),
  );
  const signature = sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), privateKey);
  return `${header}.${payload}.${base64url(signature)}`;
}

/** What the stand-in will answer with, swapped per case. */
let idTokenClaims: Record<string, unknown> = {};
let userInfoClaims: Record<string, unknown> | null = null;
const requested: string[] = [];

/** The CalDAV account the app shares calendars from. */
const CALDAV_USER = process.env.CALDAV_USERNAME || "417-sys";
/** DAV requests the app has made, in order. */
const dav: { method: string; url: string; body: string }[] = [];
/** Who the stand-in has been asked to share a calendar with, and kept. */
const davShares = new Set<string>();

/**
 * Enough of NextCloud's DAV for a calendar shared at sign-in: every user
 * exists, a share is kept, and the calendar says who it is shared with.
 */
function answerDav(method: string, url: string, body: string, res: ServerResponse) {
  dav.push({ method, url, body });
  if (method === "PROPFIND" && url.startsWith("/remote.php/dav/principals/users/")) {
    res
      .writeHead(207)
      .end(
        `<d:multistatus xmlns:d="DAV:"><d:response><d:href>${url}</d:href></d:response></d:multistatus>`,
      );
    return;
  }
  if (method === "PROPFIND") {
    const users = [...davShares]
      .map(
        (name) =>
          `<oc:user><d:href>principal:principals/users/${name}</d:href><oc:access><oc:read/></oc:access></oc:user>`,
      )
      .join("");
    res
      .writeHead(207)
      .end(
        `<d:multistatus xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns"><d:response><d:href>${url}/</d:href><d:propstat><d:prop><oc:invite>${users}</oc:invite></d:prop></d:propstat></d:response></d:multistatus>`,
      );
    return;
  }
  if (method === "POST") {
    const name = /principal:principals\/users\/([^<]+)</.exec(body)?.[1];
    if (name) davShares.add(name);
    res.writeHead(200).end();
    return;
  }
  res.writeHead(404).end();
}

/** Waits for something the app does after answering, like a background share. */
async function waitFor<T>(probe: () => T | undefined, ms = 5000): Promise<T | undefined> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const found = probe();
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return probe();
}

function startFakeNextCloud() {
  const server = createServer((req, res) => {
    const url = req.url ?? "";
    requested.push(url);

    if (url.startsWith("/remote.php/dav/")) {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () =>
        answerDav(req.method ?? "", url, Buffer.concat(chunks).toString("utf8"), res),
      );
      return;
    }

    // What a stock NextCloud does with the address the spec suggests.
    if (url === "/.well-known/openid-configuration") {
      res.writeHead(301, {
        location: `${NC}/index.php/.well-known/openid-configuration`,
        "content-type": "text/html",
      });
      res.end("<html>301</html>");
      return;
    }

    if (url.endsWith("/openid-configuration")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          issuer: NC,
          authorization_endpoint: `${NC}/index.php/apps/oidc/authorize`,
          token_endpoint: `${NC}/index.php/apps/oidc/token`,
          userinfo_endpoint: `${NC}/index.php/apps/oidc/userinfo`,
          jwks_uri: `${NC}/index.php/apps/oidc/jwks`,
          scopes_supported: ["openid", "profile", "email", "roles"],
          response_types_supported: ["code"],
          id_token_signing_alg_values_supported: ["RS256"],
          code_challenge_methods_supported: ["S256"],
        }),
      );
      return;
    }

    if (url.endsWith("/jwks")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ keys: [{ ...jwk, kid: KID, alg: "RS256", use: "sig" }] }));
      return;
    }

    if (url.endsWith("/token")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          access_token: "test-access-token",
          token_type: "Bearer",
          expires_in: 3600,
          id_token: signIdToken(idTokenClaims),
        }),
      );
      return;
    }

    if (url.endsWith("/userinfo")) {
      if (!userInfoClaims) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(userInfoClaims));
      return;
    }

    res.writeHead(404).end();
  });

  return new Promise<() => void>((resolve) => {
    server.listen(NC_PORT, "127.0.0.1", () => resolve(() => server.close()));
  });
}

// --- driving the flow -------------------------------------------------------

function mergeCookies(jar: Map<string, string>, response: Response) {
  for (const raw of response.headers.getSetCookie()) {
    const [pair] = raw.split(";");
    const index = pair.indexOf("=");
    if (index > 0) jar.set(pair.slice(0, index).trim(), pair.slice(index + 1));
  }
}

function cookieHeader(jar: Map<string, string>): string {
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

/**
 * Runs a full sign-in the way a person does — through /api/auth/start, which
 * is where an unauthenticated visit lands — and returns where the app finally
 * sent the browser.
 */
async function signInRoundTrip(
  options: { reauth?: boolean } = {},
): Promise<{ location: string; authorize: URL }> {
  const jar = new Map<string, string>();

  const start = await fetch(
    `${BASE}/api/auth/start${options.reauth ? "?reauth=1" : ""}`,
    { redirect: "manual" },
  );
  mergeCookies(jar, start);

  const authorize = new URL(start.headers.get("location") ?? "");

  // Stand in for the user approving at NextCloud: come back with a code and
  // the state the app just issued.
  const callback = await fetch(
    `${BASE}/api/auth/callback/nextcloud?code=test-code&state=${encodeURIComponent(
      authorize.searchParams.get("state") ?? "",
    )}`,
    { redirect: "manual", headers: { Cookie: cookieHeader(jar) } },
  );

  return { location: callback.headers.get("location") ?? "", authorize };
}

async function main() {
  const stop = await startFakeNextCloud();
  const emails = [
    "oidc-idtoken@417group.org",
    "oidc-userinfo@417group.org",
    "oidc-nogroup@417group.org",
  ];
  const linkedEmail = "oidc-linked@417group.org";
  const unlinkedEmail = "oidc-unlinked@417group.org";
  const takenEmail = "oidc-taken@417group.org";
  const everyone = [...emails, linkedEmail, unlinkedEmail, takenEmail];
  await db.user.deleteMany({ where: { email: { in: everyone } } });

  // --- the authorization request ------------------------------------------
  idTokenClaims = {
    sub: "u-idtoken",
    email: emails[0],
    name: "Ivy IdToken",
    roles: ["quicktec-manager"],
  };
  userInfoClaims = null;

  const first = await signInRoundTrip();

  check(
    "discovery is fetched from the OIDC app's own path",
    requested.includes("/index.php/apps/oidc/openid-configuration"),
    true,
  );
  check(
    "the spec address, which NextCloud only redirects, is not used",
    requested.includes("/.well-known/openid-configuration"),
    false,
  );
  check(
    "the browser is sent to the advertised authorization endpoint",
    `${first.authorize.origin}${first.authorize.pathname}`,
    `${NC}/index.php/apps/oidc/authorize`,
  );
  check(
    "the redirect URI is the one to register in NextCloud",
    first.authorize.searchParams.get("redirect_uri"),
    `${PUBLIC}/api/auth/callback/nextcloud`,
  );
  check(
    "groups are requested — without the roles scope every sign-in is refused",
    first.authorize.searchParams.get("scope"),
    "openid profile email roles",
  );
  check("PKCE is used", first.authorize.searchParams.get("code_challenge_method"), "S256");
  check(
    "state is carried",
    (first.authorize.searchParams.get("state") ?? "").length > 20,
    true,
  );

  // NextCloud is no longer the only way in, so /signin asks which kind of
  // account this is rather than handing straight over. A client's coordinator
  // has no NextCloud account and never will.
  const signinPage = await fetch(`${BASE}/signin`, { redirect: "manual" });
  const signinHtml = await signinPage.text();
  check("an unauthenticated visit is asked which account they have",
    signinPage.status, 200);
  check(
    "answering yes hands over to NextCloud",
    signinHtml.includes('href="/api/auth/start"'),
    true,
  );
  check(
    "and answering no offers a password instead",
    signinHtml.includes("/signin?method=password"),
    true,
  );

  // Answering it still ends up in the flow, with nothing else in between.
  const chose = await fetch(`${BASE}/signin?method=sso`, { redirect: "manual" });
  check(
    "choosing SSO is sent straight into the flow",
    chose.headers.get("location"),
    "/api/auth/start",
  );
  check(
    "a normal sign-in does not force a password prompt",
    first.authorize.searchParams.get("prompt"),
    null,
  );

  // After signing out it does, otherwise signing out on a shared phone and
  // back in silently returns the same account.
  const afterSignOut = await fetch(`${BASE}/signin?method=sso&reauth=1`, {
    redirect: "manual",
  });
  check(
    "signing out routes back through the flow",
    afterSignOut.headers.get("location"),
    "/api/auth/start?reauth=1",
  );

  // --- claims in the ID token, the straightforward case --------------------
  check("a complete ID token signs the user in", first.location, `${PUBLIC}/dashboard`);

  const fromIdToken = await db.user.findUnique({ where: { email: emails[0] } });
  check("the account is provisioned", fromIdToken?.name, "Ivy IdToken");
  check("with the role from their group", fromIdToken?.baseRole, "MANAGER");
  // What NextCloud started them with is on their history from the first line.
  for (const [field, action, value] of [
    ["name", "Preferred name added", "Ivy IdToken"],
    ["email", "Work email added", emails[0]],
    ["role", "Role added", "Manager"],
  ] as const) {
    const entry = (await profileHistory(fromIdToken!.id, field))[0];
    check(
      `a new account's history starts with: ${action}`,
      `${entry?.action} · ${entry?.to} · ${entry?.by} · ${entry?.source}`,
      `${action} · ${value} · System · Auto-Import: NC`,
    );
  }

  // --- a name corrected in QuickTec ----------------------------------------
  // NextCloud is asked for the name on every sign-in and it is written
  // straight over the top. A correction made here would therefore last until
  // that person next signed in and then quietly revert, days later, with
  // nothing on screen to say it had gone — which is worse than not being able
  // to correct it at all.
  await db.user.update({
    where: { id: fromIdToken!.id },
    data: { name: "Ivy Kovalenko", nameOverridden: true },
  });

  await signInRoundTrip();
  check(
    "a name set here survives the next sign-in",
    (await db.user.findUnique({ where: { email: emails[0] } }))?.name,
    "Ivy Kovalenko",
  );

  // Clearing it hands the name back, which is how somebody undoes a
  // correction they no longer want.
  await db.user.update({
    where: { id: fromIdToken!.id },
    data: { nameOverridden: false },
  });

  await signInRoundTrip();
  check(
    "and handing it back lets NextCloud write it again",
    (await db.user.findUnique({ where: { email: emails[0] } }))?.name,
    "Ivy IdToken",
  );

  // --- their calendar, at sign-in -------------------------------------------
  // Until somebody signs in through a NextCloud, QuickTec can only guess their
  // username there from their address — and after a move to a new NextCloud,
  // that is everybody at once. Signing in is where it learns the real one,
  // and the calendar it keeps for them is shared under it.
  const ivysCalendar = `/remote.php/dav/calendars/${CALDAV_USER}/${calendarSlug(emails[0])}`;
  await db.user.update({
    where: { id: fromIdToken!.id },
    data: { calendarUrl: `${NC}${ivysCalendar}` },
  });
  dav.length = 0;
  await signInRoundTrip();
  const sharedAtSignIn = await waitFor(() =>
    dav.find((entry) => entry.method === "POST" && entry.url === ivysCalendar),
  );
  check(
    "signing in shares their calendar under their NextCloud username (needs CALDAV_USERNAME and CALDAV_PASSWORD on the app)",
    sharedAtSignIn?.body.includes("principal:principals/users/u-idtoken"),
    true,
  );

  dav.length = 0;
  await signInRoundTrip();
  await waitFor(() => dav.find((entry) => entry.method === "PROPFIND" && entry.url === ivysCalendar));
  await new Promise((resolve) => setTimeout(resolve, 300));
  check(
    "and only checks it, without sharing again, when they sign in once more",
    dav.filter((entry) => entry.method === "POST").length,
    0,
  );
  await db.user.update({ where: { id: fromIdToken!.id }, data: { calendarUrl: null } });

  // --- an address alone does not move an account ----------------------------
  // NextCloud lets two users carry the same address, and an administrator can
  // type any address on anybody. Following the address from one NextCloud
  // user to another would hand over whatever account it reached.
  const owner = await db.user.create({
    data: {
      email: linkedEmail,
      name: "Lin Linked",
      nextcloudSub: "u-original",
      baseRole: "TECH",
      passwordFallback: true,
      passwordHash: "scrypt$placeholder",
    },
  });

  idTokenClaims = {
    sub: "u-impostor",
    email: linkedEmail,
    name: "Ima Impostor",
    roles: ["quicktec-tech"],
  };
  userInfoClaims = null;
  const impostor = await signInRoundTrip();
  check(
    "another NextCloud user with the same address is turned away",
    new URL(impostor.location).searchParams.get("error"),
    "EmailInUse",
  );
  const afterImpostor = await db.user.findUniqueOrThrow({ where: { id: owner.id } });
  check(
    "and the account stays its owner's",
    `${afterImpostor.nextcloudSub} · ${afterImpostor.name}`,
    "u-original · Lin Linked",
  );

  // Nor may they lock its owner out by turning up with no group: the spare
  // key that strips is the one on the account a sign-in would let them into.
  idTokenClaims = { sub: "u-impostor", email: linkedEmail, name: "Ima Impostor" };
  userInfoClaims = { sub: "u-impostor", email: linkedEmail, groups: ["users"] };
  await signInRoundTrip();
  const afterNoGroup = await db.user.findUniqueOrThrow({ where: { id: owner.id } });
  check(
    "an impostor with no group does not take the owner's password away",
    `${afterNoGroup.passwordFallback} · ${afterNoGroup.passwordHash !== null}`,
    "true · true",
  );

  idTokenClaims = {
    sub: "u-original",
    email: linkedEmail,
    name: "Lin Linked",
    roles: ["quicktec-tech"],
  };
  userInfoClaims = null;
  check(
    "while the owner signs in as before",
    (await signInRoundTrip()).location,
    `${PUBLIC}/dashboard`,
  );

  // A move to a new NextCloud clears every link, and the first sign-in joins
  // each account on its address again. That must go on working.
  const unlinked = await db.user.create({
    data: { email: unlinkedEmail, name: "Una Unlinked", baseRole: "TECH" },
  });
  idTokenClaims = {
    sub: "u-unlinked",
    email: unlinkedEmail,
    name: "Una Unlinked",
    roles: ["quicktec-tech"],
  };
  const joined = await signInRoundTrip();
  check(
    "an account linked to nobody is joined on its address at the first sign-in",
    `${joined.location} · ${(await db.user.findUniqueOrThrow({ where: { id: unlinked.id } })).nextcloudSub}`,
    `${PUBLIC}/dashboard · u-unlinked`,
  );

  // Their NextCloud address changed to one another account here has: said,
  // where it used to fail on the unique address with nothing on screen.
  await db.user.create({
    data: { email: takenEmail, name: "Tia Taken", baseRole: "TECH" },
  });
  idTokenClaims = {
    sub: "u-unlinked",
    email: takenEmail,
    name: "Una Unlinked",
    roles: ["quicktec-tech"],
  };
  const movedOnto = await signInRoundTrip();
  check(
    "a NextCloud address moved onto another account's is refused with a reason",
    new URL(movedOnto.location).searchParams.get("error"),
    "EmailInUse",
  );
  check(
    "and neither account changes",
    `${(await db.user.findUniqueOrThrow({ where: { id: unlinked.id } })).email} · ${
      (await db.user.findUniqueOrThrow({ where: { email: takenEmail } })).nextcloudSub
    }`,
    `${unlinkedEmail} · null`,
  );

  const inUsePage = await (await fetch(`${BASE}/signin?error=EmailInUse`)).text();
  check(
    "the sign-in page says the address is another account's",
    inUsePage.includes("already belongs to another QuickTec account"),
    true,
  );

  // --- claims only in userinfo ---------------------------------------------
  // Auth.js treats the ID token as the whole profile and never asks userinfo,
  // so this is the case that refused entry on a real install.
  idTokenClaims = { sub: "u-userinfo" };
  userInfoClaims = {
    sub: "u-userinfo",
    email: emails[1],
    name: "Uma UserInfo",
    groups: ["quicktec-supervisor"],
  };

  const second = await signInRoundTrip();
  check(
    "email and groups found in userinfo sign the user in",
    second.location,
    `${PUBLIC}/dashboard`,
  );

  const fromUserInfo = await db.user.findUnique({ where: { email: emails[1] } });
  check("that account is provisioned too", fromUserInfo?.name, "Uma UserInfo");
  check("with its own role", fromUserInfo?.baseRole, "SUPERVISOR");

  // --- no group anywhere ----------------------------------------------------
  idTokenClaims = { sub: "u-nogroup", email: emails[2], name: "Nora NoGroup" };
  userInfoClaims = { sub: "u-nogroup", email: emails[2], groups: ["users"] };

  const third = await signInRoundTrip();
  check(
    "somebody in no quicktec-* group is turned away",
    new URL(third.location).searchParams.get("error"),
    "NoGroup",
  );
  check(
    "and no account is created for them",
    await db.user.count({ where: { email: emails[2] } }),
    0,
  );

  // --- no email anywhere ----------------------------------------------------
  // Distinguished from the group refusal on purpose: they are fixed in
  // different places, and one used to be reported as the other.
  idTokenClaims = { sub: "u-noemail", name: "Ned NoEmail", roles: ["quicktec-tech"] };
  userInfoClaims = { sub: "u-noemail", roles: ["quicktec-tech"] };

  const fourth = await signInRoundTrip();
  check(
    "an account with no email is told exactly that",
    new URL(fourth.location).searchParams.get("error"),
    "NoEmail",
  );

  // --- re-authentication ----------------------------------------------------
  idTokenClaims = {
    sub: "u-idtoken",
    email: emails[0],
    name: "Ivy IdToken",
    roles: ["quicktec-manager"],
  };
  userInfoClaims = null;

  const reauth = await signInRoundTrip({ reauth: true });
  check(
    "coming back after a sign-out asks NextCloud for credentials again",
    reauth.authorize.searchParams.get("prompt"),
    "login",
  );
  check(
    "and still signs in once they are given",
    reauth.location,
    `${PUBLIC}/dashboard`,
  );

  stop();
  await db.user.deleteMany({ where: { email: { in: everyone } } });
  await db.$disconnect();

  console.log(
    `\n${failures === 0 ? "ALL AUTH CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
