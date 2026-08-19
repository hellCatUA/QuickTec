import { Auth } from "@auth/core";
import NextAuth, {
  CredentialsSignin,
  customFetch,
  type NextAuthConfig,
} from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { db } from "@/lib/db";
import { extractGroups, resolveBaseRole } from "@/lib/nextcloud-groups";
import {
  hashPassword,
  lockRemaining,
  lockoutUntil,
  needsRehash,
  verifyPassword,
} from "@/lib/password";

/**
 * Sign-in rejection reasons surfaced on /signin.
 * Auth.js only lets us pass a string back, so these are matched by name.
 */
export const SIGNIN_ERRORS = {
  NoGroup:
    "Your NextCloud account is not in any quicktec-* group, or NextCloud is not sharing group membership with QuickTec. An administrator can tell which from the server log.",
  NoEmail:
    "Your NextCloud account has no email address, so QuickTec cannot identify you. Add one in NextCloud and sign in again.",
  NoSubject:
    "NextCloud did not identify the account in the token it returned. This is a configuration problem, not something you can fix by retrying.",
  Inactive: "This account has been deactivated in QuickTec.",
  LocalAccount:
    "An account with this address already signs in with a QuickTec password. An administrator has to join the two before SSO will work for it.",
  SsoAccount:
    "This email belongs to a company account. Sign in with SSO instead.",
} as const;

// The trailing slash matters: it is compared against the `issuer` in the
// discovery document, and `https://cloud.example.org/` does not equal
// `https://cloud.example.org`. A mismatch fails as error=Configuration with
// nothing on screen to suggest a stray character is the cause.
const issuer = (process.env.NEXTCLOUD_ISSUER ?? "").trim().replace(/\/+$/, "");

/** Where the OIDC provider app publishes its discovery document. */
export function discoveryUrl(): string {
  return (
    process.env.NEXTCLOUD_WELL_KNOWN?.trim() ||
    `${issuer}/index.php/apps/oidc/openid-configuration`
  );
}

/**
 * The redirect URI this server will send, which is the string that has to be
 * registered in NextCloud character for character. Derived rather than written
 * down twice, so it cannot drift from what Auth.js actually uses.
 */
export function callbackUri(): string {
  const base = (process.env.AUTH_URL ?? "").trim().replace(/\/+$/, "");
  return `${base}/api/auth/callback/nextcloud`;
}

const SPEC_WELL_KNOWN = "/.well-known/openid-configuration";

/**
 * A real hash of a password nobody has.
 *
 * Verified against when the address is unknown, so that answering "no" costs
 * the same whether or not the account exists. Without it the response time is
 * a membership test.
 */
const DECOY_HASH =
  "scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$" +
  "Ym90aGluZ3Rvc2VlaGVyZWJvdGhpbmd0b3NlZWhlcmVib3RoaW5ndG9zZWVoZXJlYm90aA==";

/**
 * Sends the discovery request where NextCloud actually keeps the document.
 *
 * Auth.js builds that URL itself, as `<issuer>/.well-known/openid-configuration`,
 * and ignores the provider's `wellKnown` — it is normalised and then never
 * read. NextCloud answers that address with a 301 to its `/index.php/` form,
 * and the OIDC client fetches metadata with `redirect: "manual"` and demands a
 * 200, so the redirect is a hard failure rather than a detour. It surfaces as
 * `error=Configuration` with nothing on screen to say a URL was involved.
 *
 * `customFetch` is the supported way in: Auth.js passes it to both the sign-in
 * and callback discovery calls, so one rewrite covers the whole flow.
 */
async function discoveryFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const requested =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;

  if (requested.endsWith(SPEC_WELL_KNOWN)) {
    return fetch(discoveryUrl(), init);
  }
  return fetch(input, init);
}

/**
 * Fetches the userinfo document.
 *
 * Auth.js treats the ID token as the whole profile for an OIDC provider and
 * never calls userinfo, but NextCloud installs differ in which of the two
 * carries the email address and the group membership. Rather than making the
 * operator work out which one they have, this is tried when the ID token came
 * back short — one extra request, and only on the path that would otherwise
 * refuse the sign-in.
 */
async function fetchUserInfo(
  accessToken: string,
): Promise<Record<string, unknown> | null> {
  try {
    const discovery = await fetch(discoveryUrl(), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    if (!discovery.ok) return null;

    const { userinfo_endpoint: endpoint } = (await discovery.json()) as {
      userinfo_endpoint?: string;
    };
    if (!endpoint) return null;

    const response = await fetch(endpoint, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      console.error(`[auth] userinfo returned HTTP ${response.status}`);
      return null;
    }

    return (await response.json()) as Record<string, unknown>;
  } catch (error) {
    console.error("[auth] could not read userinfo:", error);
    return null;
  }
}

export const authConfig: NextAuthConfig = {
  // Behind Nginx Proxy Manager on a VPN-only subdomain, so the host
  // header has to be trusted for callback URLs to come out right.
  trustHost: true,

  // JWT keeps middleware working on the edge runtime. It carries identity only
  // — role and permissions are always re-read from Postgres per request, so a
  // role change in NextCloud or a deactivation takes effect immediately
  // instead of waiting for the token to expire.
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 7 },

  pages: {
    signIn: "/signin",
    error: "/signin",
  },

  logger: {
    /**
     * Auth.js logs a name, a one-line message and a documentation link. For a
     * provider failure all of the useful information — which URL, which status
     * — is in the cause, which the default logger does not unwrap.
     */
    error(error) {
      console.error(`[auth] ${error.name}: ${error.message}`);
      const cause = (error as { cause?: unknown }).cause;
      if (cause instanceof Error) {
        console.error(`[auth] cause: ${cause.name}: ${cause.message}`);
        if (cause.cause) console.error("[auth] underlying:", cause.cause);
      } else if (cause) {
        console.error("[auth] cause:", cause);
      }
    },
  },

  providers: [
    /**
     * The people who are not in NextCloud.
     *
     * Everything about being turned away is deliberately uniform: a wrong
     * password, an unknown address, an SSO account typed into the wrong form
     * and a deactivated account all come back as the same sentence, because
     * the difference between them is exactly what somebody working through a
     * list of addresses wants to learn. The one exception is a locked account,
     * which is said plainly — otherwise the person waits out fifteen minutes
     * without knowing they are waiting.
     */
    Credentials({
      id: "password",
      name: "QuickTec password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = String(credentials?.email ?? "")
          .trim()
          .toLowerCase();
        const password = String(credentials?.password ?? "");
        if (!email || !password) return null;

        const user = await db.user.findUnique({
          where: { email },
          select: {
            id: true,
            name: true,
            email: true,
            active: true,
            signInMethod: true,
            passwordHash: true,
            failedSignIns: true,
            lockedUntil: true,
          },
        });

        // Still spend the time hashing when there is no account. Answering an
        // unknown address in a millisecond and a known one in a hundred is a
        // list of who works here.
        if (!user || user.signInMethod !== "LOCAL" || !user.active) {
          await verifyPassword(password, DECOY_HASH);
          return null;
        }

        const locked = lockRemaining(user.lockedUntil);
        if (locked > 0) {
          throw new CredentialsSignin(`Locked:${locked}`);
        }

        // A lock that has run out clears what put it there. Otherwise the
        // eighth wrong answer is followed by a permanent one-strike policy:
        // the counter stays at eight, so the next single typo locks them out
        // again, and again, with nothing to reset it but an administrator.
        const priorFailures = user.lockedUntil ? 0 : user.failedSignIns;

        if (!(await verifyPassword(password, user.passwordHash))) {
          const failures = priorFailures + 1;
          await db.user.update({
            where: { id: user.id },
            data: { failedSignIns: failures, lockedUntil: lockoutUntil(failures) },
          });
          return null;
        }

        // Their password is good, so it is in hand for the one moment it can
        // be re-hashed with today's parameters.
        const rehash = needsRehash(user.passwordHash)
          ? await hashPassword(password)
          : undefined;

        await db.user.update({
          where: { id: user.id },
          data: {
            failedSignIns: 0,
            lockedUntil: null,
            lastLoginAt: new Date(),
            ...(rehash ? { passwordHash: rehash } : {}),
          },
        });

        return { id: user.id, name: user.name, email: user.email };
      },
    }),

    {
      id: "nextcloud",
      name: "NextCloud",
      type: "oidc",
      issuer,
      // Kept for the day Auth.js honours it again, but discoveryFetch is what
      // actually gets the request to the right place today. Both read the same
      // value, so they cannot disagree.
      wellKnown: discoveryUrl(),
      [customFetch]: discoveryFetch,
      clientId: process.env.NEXTCLOUD_CLIENT_ID,
      clientSecret: process.env.NEXTCLOUD_CLIENT_SECRET,
      // `roles` is what carries group membership.
      authorization: { params: { scope: "openid profile email roles" } },
      checks: ["pkce", "state"],
      profile(profile) {
        return {
          id: String(profile.sub),
          name:
            (profile.name as string) ??
            (profile.preferred_username as string) ??
            (profile.email as string),
          email: profile.email as string,
          image: (profile.picture as string) ?? null,
        };
      },
    },
  ],

  callbacks: {
    /**
     * Provisioning happens here rather than through an adapter, because the
     * decision is not "does this user exist" but "is this user allowed in at
     * all", which depends on their NextCloud groups.
     */
    async signIn({ profile, account }) {
      // This callback is shared by every provider, and the password one has
      // already done its own deciding in `authorize` — there is no ID token
      // here to read a subject or a group out of. Without this, signing in
      // with a password was refused as "the token carries no subject".
      if (account?.provider !== "nextcloud") return true;

      const claims: Record<string, unknown> = { ...profile };
      const fromIdToken = Object.keys(claims);

      // One request, not two: the same document answers both questions, and
      // asking for it is only worth it when something is actually missing.
      const incomplete = !claims.email || extractGroups(claims).length === 0;
      let userInfoClaims: string[] = [];

      if (incomplete && typeof account?.access_token === "string") {
        const extra = await fetchUserInfo(account.access_token);
        if (extra) {
          userInfoClaims = Object.keys(extra);
          for (const [claim, value] of Object.entries(extra)) {
            claims[claim] ??= value;
          }
        }
      }

      /** Everything a refusal needs to be actionable, in one place. */
      function explain(problem: string) {
        console.error(
          `[auth] refused ${claims.email ?? claims.sub ?? "unknown user"}: ${problem}\n` +
            `[auth]   ID token claims: ${fromIdToken.join(", ") || "none"}\n` +
            `[auth]   userinfo claims: ${userInfoClaims.join(", ") || "not consulted or empty"}`,
        );
      }

      const sub = typeof claims.sub === "string" ? claims.sub : null;
      if (!sub) {
        explain("the token carries no subject");
        return `/signin?error=NoSubject`;
      }

      // Email is the identity everything else hangs off: the calendar name,
      // the pay journal, matching an account provisioned earlier. A NextCloud
      // account without one cannot be let in, but it is worth saying so
      // exactly rather than blaming their group membership.
      const rawEmail = typeof claims.email === "string" ? claims.email : "";
      if (!rawEmail) {
        explain("no email address in the token or in userinfo");
        return `/signin?error=NoEmail`;
      }

      const groups = extractGroups(claims);
      const role = resolveBaseRole(groups);
      if (!role) {
        explain(
          `no quicktec-* group among: ${groups.length > 0 ? groups.join(", ") : "none"}`,
        );
        return `/signin?error=NoGroup`;
      }

      const email = rawEmail.toLowerCase();
      const name =
        (claims.name as string) ||
        (claims.preferred_username as string) ||
        email;

      const existing = await db.user.findFirst({
        where: { OR: [{ nextcloudSub: sub }, { email }] },
        select: { id: true, active: true, signInMethod: true, nextcloudSub: true },
      });

      if (existing && !existing.active) return `/signin?error=Inactive`;

      // An outside account carrying the same address is not this person until
      // somebody says so. Matching on email alone would let anybody who can
      // get a NextCloud account with the right address inherit a local one,
      // and an administrator switching them to SSO is the deliberate act that
      // should join the two.
      if (existing && existing.signInMethod === "LOCAL" && !existing.nextcloudSub) {
        explain("an outside account already uses this address");
        return `/signin?error=LocalAccount`;
      }

      if (existing) {
        await db.user.update({
          where: { id: existing.id },
          data: {
            nextcloudSub: sub,
            email,
            name,
            avatarUrl: (claims.picture as string) ?? undefined,
            baseRole: role,
            lastLoginAt: new Date(),
          },
        });
      } else {
        await db.user.create({
          data: {
            nextcloudSub: sub,
            email,
            name,
            avatarUrl: (claims.picture as string) ?? undefined,
            baseRole: role,
            lastLoginAt: new Date(),
          },
        });
      }

      return true;
    },

    async jwt({ token, user, profile }) {
      // The password provider has no profile: it hands back the row it just
      // checked, and that id is the whole of what the session needs.
      if (user?.id) {
        token.userId = user.id;
        // Stamped rather than read from `iat`, which Auth.js refreshes as the
        // token rolls over. This is when they proved who they were, and it is
        // what a password reset is compared against.
        token.signedInAt = Date.now();
      }

      if (profile?.sub) {
        const user = await db.user.findUnique({
          where: { nextcloudSub: profile.sub },
          select: { id: true },
        });
        if (user) token.userId = user.id;
      }
      return token;
    },

    async session({ session, token }) {
      if (token.userId) {
        session.user.id = token.userId as string;
      }
      if (token.signedInAt) {
        (session as { signedInAt?: number }).signedInAt =
          token.signedInAt as number;
      }
      return session;
    },
  },
};

// Calling this also fills the config in from the environment — the secret, the
// base path, trustHost — in place, so `authConfig` is ready to hand to the
// core handler below.
const { auth, signIn, signOut } = NextAuth(authConfig);

export { auth, signIn, signOut };

/**
 * Serves Auth.js the address the browser actually used.
 *
 * Every absolute URL Auth.js emits — the `redirect_uri` sent to NextCloud, the
 * page somebody lands on after signing in, the error redirect — is built from
 * the URL of the request it is handed. `next-auth` is supposed to replace that
 * origin with AUTH_URL, and it tries: it constructs a `NextRequest` with a new
 * href. Under Next 16 that constructor keeps the original request's URL and
 * drops the new one, so the substitution does nothing and every URL comes out
 * as `http://localhost:3000` — the port the server happens to be listening on,
 * not the address anybody typed. Behind a proxy that is fatal: NextCloud is
 * asked to redirect to a host that only exists inside the container, and a
 * completed sign-in throws the browser at nothing.
 *
 * A plain `Request` does take the URL it is given, and the core handler is
 * happy with one — it is what `next-auth` calls with the request it failed to
 * rewrite. So the rewrite is done here and handed straight over.
 */
function withPublicOrigin(request: Request): Request {
  const base = (process.env.AUTH_URL ?? "").trim().replace(/\/+$/, "");
  if (!base) return request;

  let target: URL;
  try {
    const url = new URL(request.url);
    target = new URL(`${url.pathname}${url.search}`, base);
  } catch {
    return request;
  }
  if (target.href === request.url) return request;

  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers: request.headers,
    redirect: "manual",
    signal: request.signal,
  };
  // Streaming a body through requires saying so; without it Node refuses.
  if (request.body) {
    init.body = request.body;
    init.duplex = "half";
  }
  return new Request(target, init);
}

const serve = (request: Request) => Auth(withPublicOrigin(request), authConfig);

export const handlers = { GET: serve, POST: serve };
