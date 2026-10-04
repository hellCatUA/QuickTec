import type { NextRequest } from "next/server";
import { signIn } from "@/auth";
import { safeRedirect } from "@/lib/safe-redirect";

/**
 * Starts the NextCloud sign-in.
 *
 * A page cannot do this: the authorization request has to set the state and
 * PKCE cookies, which needs a response rather than a render. So /signin sends
 * people here and this hands them straight to NextCloud — there is nothing to
 * ask them, since NextCloud is the only way in.
 *
 * With `?reauth=1` it asks NextCloud to re-authenticate the person rather than
 * reusing their existing session. That is what makes signing out mean
 * something: without it, signing out and back in on the same phone silently
 * returns the same account, which is wrong when the phone is shared and
 * alarming when it is not.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  // Auth.js would keep this on our origin by itself, prefixing a relative path
  // with the base URL. It is filtered here anyway so that both ways in answer
  // "where may I be sent" with the same rule, rather than one rule and one
  // library default that happens to agree today.
  const callbackUrl = safeRedirect(searchParams.get("callbackUrl"));
  const reauth = searchParams.get("reauth") === "1";

  await signIn(
    "nextcloud",
    { redirectTo: callbackUrl },
    reauth ? { prompt: "login" } : undefined,
  );
}
