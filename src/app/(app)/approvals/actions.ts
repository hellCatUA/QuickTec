"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";

/**
 * Acknowledging is scoped to the signed-in user by construction: the update is
 * filtered on their own id, so a guessed notification id changes nothing.
 */
export async function acknowledgeNotification(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "Nothing to acknowledge." };

  // The count matters: a row that matched nothing means somebody else's
  // notification, or one already acknowledged elsewhere. Reporting that as a
  // success is how a screen ends up disagreeing with the record.
  const { count } = await db.notification.updateMany({
    where: { id, userId: user.id, acknowledgedAt: null },
    data: { acknowledgedAt: new Date() },
  });
  if (count === 0) {
    return { ok: false, error: "That one is no longer waiting on you." };
  }

  revalidatePath("/approvals");
  return { ok: true };
}

export async function acknowledgeAll(): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();

  await db.notification.updateMany({
    where: { userId: user.id, acknowledgedAt: null },
    data: { acknowledgedAt: new Date() },
  });

  revalidatePath("/approvals");
  return { ok: true };
}
