import "dotenv/config";
import { createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { createServer } from "node:http";
import { db } from "@/lib/db";

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
 * would then compare two spellings of the same thing:
 *
 *   NEXTCLOUD_ISSUER=http://127.0.0.1:9999 \
 *   NEXTCLOUD_CLIENT_ID=dev-client NEXTCLOUD_CLIENT_SECRET=dev-secret \
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

function startFakeNextCloud() {
  const server = createServer((req, res) => {
    const url = req.url ?? "";
    requested.push(url);

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

/** Runs a full sign-in and returns where the app finally sent the browser. */
async function signInRoundTrip(): Promise<{ location: string; authorize: URL }> {
  const jar = new Map<string, string>();

  const csrfResponse = await fetch(`${BASE}/api/auth/csrf`);
  mergeCookies(jar, csrfResponse);
  const { csrfToken } = (await csrfResponse.json()) as { csrfToken: string };

  const start = await fetch(`${BASE}/api/auth/signin/nextcloud`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookieHeader(jar),
    },
    body: new URLSearchParams({ csrfToken, callbackUrl: "/dashboard" }),
  });
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
  await db.user.deleteMany({ where: { email: { in: emails } } });

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

  // --- claims in the ID token, the straightforward case --------------------
  check("a complete ID token signs the user in", first.location, `${PUBLIC}/dashboard`);

  const fromIdToken = await db.user.findUnique({ where: { email: emails[0] } });
  check("the account is provisioned", fromIdToken?.name, "Ivy IdToken");
  check("with the role from their group", fromIdToken?.baseRole, "MANAGER");

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

  stop();
  await db.user.deleteMany({ where: { email: { in: emails } } });
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
