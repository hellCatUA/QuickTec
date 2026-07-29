import NextAuth, { customFetch, type NextAuthConfig } from "next-auth";
import { db } from "@/lib/db";
import { extractGroups, resolveBaseRole } from "@/lib/nextcloud-groups";

/**
 * Sign-in rejection reasons surfaced on /signin.
 * Auth.js only lets us pass a string back, so these are matched by name.
 */
export const SIGNIN_ERRORS = {
  NoGroup: "Your NextCloud account is not in any quicktec-* group.",
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
    async signIn({ profile }) {
      if (!profile?.sub || !profile.email) return false;

      const role = resolveBaseRole(
        extractGroups(profile as Record<string, unknown>),
      );
      if (!role) return `/signin?error=NoGroup`;

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
