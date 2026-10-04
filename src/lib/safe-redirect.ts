/**
 * Where to send somebody after they sign in, if where they asked is inside
 * this app.
 *
 * The test this replaces was `startsWith("/") && !startsWith("//")`, which
 * reads like it keeps people on the site and does not. The browser parses a
 * URL before it goes anywhere, and the parser turns `\` into `/` and throws
 * tabs and newlines away — so `/\evil.com`, `/\t/evil.com` and `/.//evil.com`
 * all passed that test and all landed on evil.com. On a sign-in form that is
 * the whole phishing kit: a real link to the real site, a real password typed
 * into it, and then a page that is not ours asking for it again.
 *
 * So the question is put to the same parser the browser will use, and what is
 * handed back is the parser's answer rather than the string that was asked
 * about. What was checked is then exactly what is followed.
 *
 * No dependencies on purpose: the sign-in action, the SSO start route and any
 * client that wants it can all import this.
 */

/** Never served. Only an origin to resolve against and compare with. */
const PROBE_ORIGIN = "http://redirect-probe.invalid";

/** Longer than any path this app has, shorter than anything worth parsing. */
const MAX_LENGTH = 2000;

export function safeRedirect(raw: unknown, fallback = "/dashboard"): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_LENGTH) {
    return fallback;
  }

  let url: URL;
  try {
    url = new URL(raw, PROBE_ORIGIN);
  } catch {
    return fallback;
  }

  // Anything with its own scheme or host resolved somewhere else.
  if (url.origin !== PROBE_ORIGIN) return fallback;

  // Dot segments are resolved by now, so `/.//evil.com` arrives here as a
  // path of `//evil.com` — which, handed back, is a protocol-relative URL.
  if (url.pathname.startsWith("//")) return fallback;

  return `${url.pathname}${url.search}${url.hash}`;
}
