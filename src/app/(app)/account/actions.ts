"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { recordAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { optionalText } from "@/lib/form";
import { getSessionUser } from "@/lib/session";
import { US_STATES } from "@/lib/us-regions";

export type ContactResult = { ok: true } | { ok: false; error: string };

const contactSchema = z.object({
  phone: optionalText,
  addressLine1: optionalText,
  addressLine2: optionalText,
  city: optionalText,
  // The picker offers fifty-six; the action should accept fifty-six. It is
  // the only one of these fields with a closed set behind it.
  state: optionalText.refine(
    (value) => !value || US_STATES.some((entry) => entry.code === value),
    "That is not a state.",
  ),
  postalCode: optionalText,
  country: optionalText,
});

/**
 * Somebody's own phone number and address.
 *
 * Deliberately theirs to change rather than a manager's: people move, and a
 * change of address that has to go through somebody else is a change of
 * address that does not happen until payroll bounces. What is *not* here is
 * everything that decides money or reach — the rate, the supervisor, the role,
 * the legal name that payroll pays. Those stay where they were, because a
 * person editing their own record should not be able to move any of them.
 */
export async function updateOwnContact(
  _prev: ContactResult | null,
  formData: FormData,
): Promise<ContactResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const parsed = contactSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: z.prettifyError(parsed.error) };
  }

  const before = await db.user.findUnique({
    where: { id: user.id },
    select: {
      phone: true,
      addressLine1: true,
      addressLine2: true,
      city: true,
      state: true,
      postalCode: true,
      country: true,
    },
  });
  if (!before) return { ok: false, error: "Account not found." };

  await db.user.update({ where: { id: user.id }, data: parsed.data });

  // Recorded like any other change to a person, so a supervisor asking why
  // payroll went to the wrong address has an answer.
  await recordAudit({
    actorId: user.id,
    entityType: "User",
    entityId: user.id,
    action: "contact_updated",
    detail: Object.fromEntries(
      Object.entries(parsed.data).filter(
        ([key, value]) => value !== before[key as keyof typeof before],
      ),
    ),
  });

  revalidatePath("/account");
  return { ok: true };
}
