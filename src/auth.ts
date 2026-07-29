import NextAuth, { customFetch, type NextAuthConfig } from "next-auth";
import { db } from "@/lib/db";
import { extractGroups, resolveBaseRole } from "@/lib/nextcloud-groups";

/**
 * Sign-in rejection reasons surfaced on /signin.
 * Auth.js only lets us pass a string back, so these are matched by name.
 */
export const SIGNIN_ERRORS = {
  NoGroup:
    "Your NextCloud account is not in any quicktec-* group, or NextCloud is not sharing group membership with QuickTec. An administrator can tell which from the server log.",
  Inactive: "This account has been deactivated in QuickTec.",
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
 * Reads group membership from the userinfo endpoint.
 *
 * Auth.js treats the ID token as the whole profile for an OIDC provider and
 * never calls userinfo, but NextCloud installs differ in which of the two
 * carries the groups. Rather than making the operator work out which one they
 * have, this is tried when the ID token came back without any — one extra
 * request, and only on the path that would otherwise refuse the sign-in.
 */
async function groupsFromUserInfo(accessToken: string): Promise<string[]> {
  try {
    const discovery = await fetch(discoveryUrl(), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    if (!discovery.ok) return [];

    const { userinfo_endpoint: endpoint } = (await discovery.json()) as {
      userinfo_endpoint?: string;
    };
    if (!endpoint) return [];

    const response = await fetch(endpoint, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      console.error(`[auth] userinfo returned HTTP ${response.status}`);
      return [];
    }

    return extractGroups((await response.json()) as Record<string, unknown>);
  } catch (error) {
    console.error("[auth] could not read groups from userinfo:", error);
    return [];
  }
}

export const authConfig: NextAuthConfig = {
  // Behind Nginx Proxy Manager on a Tailscale-only subdomain, so the host
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
      if (!profile?.sub || !profile.email) return false;

      const claims = profile as Record<string, unknown>;
      let groups = extractGroups(claims);
      let source = "the ID token";

      if (groups.length === 0 && typeof account?.access_token === "string") {
        groups = await groupsFromUserInfo(account.access_token);
        source = "userinfo";
      }

      const role = resolveBaseRole(groups);
      if (!role) {
        // The one line that turns "not in any group" into something an admin
        // can act on: whether the groups arrived at all, and under what name.
        console.error(
          `[auth] refused ${profile.email}: no quicktec-* group.\n` +
            `[auth]   claims in the ID token: ${Object.keys(claims).join(", ")}\n` +
            `[auth]   groups found in ${source}: ${groups.length > 0 ? groups.join(", ") : "none"}`,
        );
        return `/signin?error=NoGroup`;
      }

      const email = String(profile.email).toLowerCase();
      const name =
        (profile.name as string) ||
        (profile.preferred_username as string) ||
        email;

      const existing = await db.user.findFirst({
        where: { OR: [{ nextcloudSub: profile.sub }, { email }] },
        select: { id: true, active: true },
      });

      if (existing && !existing.active) return `/signin?error=Inactive`;

      if (existing) {
        await db.user.update({
          where: { id: existing.id },
          data: {
            nextcloudSub: profile.sub,
            email,
            name,
            avatarUrl: (profile.picture as string) ?? undefined,
            baseRole: role,
            lastLoginAt: new Date(),
          },
        });
      } else {
        await db.user.create({
          data: {
            nextcloudSub: profile.sub,
            email,
            name,
            avatarUrl: (profile.picture as string) ?? undefined,
            baseRole: role,
            lastLoginAt: new Date(),
          },
        });
      }

      return true;
    },

    async jwt({ token, profile }) {
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
      return session;
    },
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
