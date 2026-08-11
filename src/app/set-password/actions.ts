"use server";

import { db } from "@/lib/db";
import {
  hashPassword,
  passwordProblem,
  verifyPassword,
} from "@/lib/password";
import { getSessionUser } from "@/lib/session";

export type ChangeResult = { ok: true } | { ok: false; error: string };

/**
 * Replacing a password you already hold.
 *
 * The current one is asked for even though the session already proves who they
 * are: a phone left unlocked on a table is not consent to change the password
 * on it.
 */
export async function changeOwnPassword(
  formData: FormData,
): Promise<ChangeResult> {
  const viewer = await getSessionUser();
  if (!viewer) return { ok: false, error: "Not signed in." };

  const current = String(formData.get("current") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (password !== confirm) return { ok: false, error: "The two do not match." };

  const problem = passwordProblem(password);
  if (problem) return { ok: false, error: problem };

  const user = await db.user.findUnique({
    where: { id: viewer.id },
    select: { passwordHash: true, signInMethod: true },
  });

  if (!user || user.signInMethod !== "LOCAL") {
    return {
      ok: false,
      error: "This account signs in through NextCloud, so its password is there.",
    };
  }

  if (!(await verifyPassword(current, user.passwordHash))) {
    return { ok: false, error: "That is not your current password." };
  }

  await db.user.update({
    where: { id: viewer.id },
    data: {
      passwordHash: await hashPassword(password),
      mustChangePassword: false,
      failedSignIns: 0,
      lockedUntil: null,
    },
  });

  return { ok: true };
}
