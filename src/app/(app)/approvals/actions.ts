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
): Promise<{ ok: boolean }> {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false };

  await db.notification.updateMany({
    where: { id, userId: user.id, acknowledgedAt: null },
    data: { acknowledgedAt: new Date() },
  });

  revalidatePath("/approvals");
  return { ok: true };
}

export async function acknowledgeAll(): Promise<{ ok: boolean }> {
  const user = await requireUser();

  await db.notification.updateMany({
    where: { userId: user.id, acknowledgedAt: null },
    data: { acknowledgedAt: new Date() },
  });

  revalidatePath("/approvals");
  return { ok: true };
}
