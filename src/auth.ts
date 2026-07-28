import NextAuth, { type NextAuthConfig } from "next-auth";
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

const issuer = process.env.NEXTCLOUD_ISSUER ?? "";

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

  providers: [
    {
      id: "nextcloud",
      name: "NextCloud",
      type: "oidc",
      issuer,
      // The NextCloud OIDC provider app serves discovery from its own path
      // rather than the server root on most installs.
      wellKnown:
        process.env.NEXTCLOUD_WELL_KNOWN ||
        `${issuer.replace(/\/$/, "")}/index.php/apps/oidc/openid-configuration`,
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
