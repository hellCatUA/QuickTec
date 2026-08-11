"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/auth";
import { db } from "@/lib/db";
import { hashPassword, hashSetupToken, passwordProblem } from "@/lib/password";

export type SignInResult =
  | { ok: true; redirectTo: string }
  | { ok: false; error: string };

/** Every refusal that is not a lockout, in the same words. */
const REFUSED = "Email or password is wrong.";

/**
 * Signs somebody in against a password held here.
 *
 * `redirect: false` because Auth.js's own redirect throws, and a thrown
 * redirect inside a server action reaches the client as a generic failure with
 * the real reason nowhere. The caller navigates instead.
 */
export async function signInWithPassword(
  formData: FormData,
): Promise<SignInResult> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const callbackUrl = String(formData.get("callbackUrl") ?? "/dashboard");

  if (!email || !password) return { ok: false, error: REFUSED };

  // Only ever somewhere inside this app. An open redirect on a sign-in form is
  // how a convincing phishing link gets built out of a real domain.
  const redirectTo =
    callbackUrl.startsWith("/") && !callbackUrl.startsWith("//")
      ? callbackUrl
      : "/dashboard";

  try {
    await signIn("password", { email, password, redirect: false });
  } catch (error) {
    if (error instanceof AuthError) {
      // The provider says how long is left on a lock, which is the one thing
      // worth telling somebody: without it they retype a password they know
      // is right until the window happens to pass.
      const locked = /Locked:(\d+)/.exec(error.message);
      if (locked) {
        const minutes = Number(locked[1]);
        return {
          ok: false,
          error: `Too many wrong passwords. Try again in ${minutes} minute${
            minutes === 1 ? "" : "s"
          }.`,
        };
      }
      return { ok: false, error: REFUSED };
    }
    throw error;
  }

  // Signed in, but with a password somebody else chose for them.
  const user = await db.user.findUnique({
    where: { email: email.toLowerCase() },
    select: { mustChangePassword: true },
  });

  return {
    ok: true,
    redirectTo: user?.mustChangePassword ? "/set-password" : redirectTo,
  };
}

export type SetPasswordResult = { ok: true } | { ok: false; error: string };

/**
 * Sets a password from a one-time link.
 *
 * The token is spent whether or not it is the first attempt: a link that keeps
 * working after somebody has used it is a password sitting in a chat history.
 */
export async function setPasswordWithToken(
  formData: FormData,
): Promise<SetPasswordResult> {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (password !== confirm) return { ok: false, error: "The two do not match." };

  const problem = passwordProblem(password);
  if (problem) return { ok: false, error: problem };

  const record = await db.passwordSetupToken.findUnique({
    where: { tokenHash: hashSetupToken(token) },
    select: {
      id: true,
      userId: true,
      expiresAt: true,
      usedAt: true,
      user: { select: { active: true, signInMethod: true } },
    },
  });

  if (
    !record ||
    record.usedAt ||
    record.expiresAt < new Date() ||
    !record.user.active ||
    record.user.signInMethod !== "LOCAL"
  ) {
    return {
      ok: false,
      error:
        "This link has been used already or has expired. Ask for a new one.",
    };
  }

  await db.$transaction([
    db.user.update({
      where: { id: record.userId },
      data: {
        passwordHash: await hashPassword(password),
        mustChangePassword: false,
        failedSignIns: 0,
        lockedUntil: null,
        passwordChangedAt: new Date(),
      },
    }),
    db.passwordSetupToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    }),
    // Any other link outstanding for this person stops working too. Two live
    // links means two people can take the account.
    db.passwordSetupToken.updateMany({
      where: { userId: record.userId, usedAt: null },
      data: { usedAt: new Date() },
    }),
  ]);

  return { ok: true };
}
