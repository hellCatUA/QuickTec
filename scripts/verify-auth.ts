import "dotenv/config";
import { createServer } from "node:http";

/**
 * Checks the OpenID Connect handshake against a stand-in NextCloud.
 *
 * This exists because of a failure that could not be caught any other way: the
 * installed Auth.js builds the discovery URL itself, as
 * `<issuer>/.well-known/openid-configuration`, and silently ignores the
 * provider's `wellKnown`. NextCloud serves the document from the OIDC app's own
 * path and answers that address with a 301, which the OIDC client refuses to
 * follow. Sign-in failed with `error=Configuration` and nothing else — no
 * unit test touches this path, and the browser suites sign in with a cookie
 * rather than through the provider.
 *
 * So the stand-in reproduces the redirect exactly, and this asserts that the
 * request lands on the right URL and the sign-in redirect comes out correct.
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
let failures = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label}\n      got ${actual}${ok ? "" : `  want ${expected}`}`,
  );
}

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

    res.writeHead(404).end();
  });

  return new Promise<() => void>((resolve) => {
    server.listen(NC_PORT, "127.0.0.1", () => resolve(() => server.close()));
  });
}

async function main() {
  const stop = await startFakeNextCloud();

  const csrfResponse = await fetch(`${BASE}/api/auth/csrf`);
  const { csrfToken } = (await csrfResponse.json()) as { csrfToken: string };
  const cookies = csrfResponse.headers.getSetCookie().join("; ");

  const signIn = await fetch(`${BASE}/api/auth/signin/nextcloud`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookies,
    },
    body: new URLSearchParams({ csrfToken, callbackUrl: "/dashboard" }),
  });

  check("sign-in redirects rather than erroring", signIn.status, 302);

  const location = signIn.headers.get("location") ?? "";
  if (location.includes("/signin")) {
    console.log(`      the app bounced back to ${location}`);
  }
  const target = new URL(location.startsWith("http") ? location : `${BASE}${location}`);

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
    `${target.origin}${target.pathname}`,
    `${NC}/index.php/apps/oidc/authorize`,
  );

  const params = target.searchParams;
  check("an authorization code is asked for", params.get("response_type"), "code");
  check(
    "the redirect URI is the one to register in NextCloud",
    params.get("redirect_uri"),
    `${(process.env.AUTH_URL ?? BASE).replace(/\/+$/, "")}/api/auth/callback/nextcloud`,
  );
  check(
    "groups are requested — without the roles scope every sign-in is refused",
    params.get("scope"),
    "openid profile email roles",
  );
  check("PKCE is used", params.get("code_challenge_method"), "S256");
  check(
    "a code challenge is actually present",
    (params.get("code_challenge") ?? "").length > 20,
    true,
  );
  check("state is carried", (params.get("state") ?? "").length > 20, true);

  stop();
  console.log(
    `\n${failures === 0 ? "ALL AUTH CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
