"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { diffFields, recordAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { PERMISSION_KEYS, type Permission } from "@/lib/permissions";
import { requirePermission } from "@/lib/session";
import { BaseRole, PermissionScope } from "@prisma-client";

export type ActionResult = { ok: true } | { ok: false; error: string };

const optionalText = z
  .string()
  .trim()
  .transform((value) => (value === "" ? null : value));

const companySchema = z.object({
  name: z.string().trim().min(1, "Company name is required"),
  logoUrl: optionalText,
  addressLine1: optionalText,
  addressLine2: optionalText,
  city: optionalText,
  state: optionalText,
  postalCode: optionalText,
  country: optionalText,
  phone: optionalText,
  email: optionalText,
  website: optionalText,
  intWoLabel: z.string().trim().min(1),
  defaultTimeZone: z.string().trim().min(1),
  timeRoundingMinutes: z.coerce.number().int().min(1).max(60),
  techTimeAdjustLimit: z.coerce.number().int().min(0).max(480),
  breakPaidByDefault: z.coerce.boolean(),
  mileageRate: z.coerce.number().min(0).max(100),
  payLagWeeks: z.coerce.number().int().min(0).max(26),
  maxPhotosPerJob: z.coerce.number().int().min(1).max(500),
  watermarkEnabled: z.coerce.boolean(),
});

export async function updateCompanySettings(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requirePermission("settings.company");

  const parsed = companySchema.safeParse({
    ...Object.fromEntries(formData),
    // Unchecked checkboxes are simply absent from FormData.
    breakPaidByDefault: formData.get("breakPaidByDefault") === "on",
    watermarkEnabled: formData.get("watermarkEnabled") === "on",
  });

  if (!parsed.success) {
    return { ok: false, error: z.prettifyError(parsed.error) };
  }

  const before = await db.companySettings.findUnique({
    where: { id: "singleton" },
  });

  const data = {
    ...parsed.data,
    mileageRate: parsed.data.mileageRate.toFixed(4),
  };

  await db.companySettings.upsert({
    where: { id: "singleton" },
    update: data,
    create: { id: "singleton", ...data },
  });

  await recordAudit({
    actorId: user.id,
    entityType: "CompanySettings",
    entityId: "singleton",
    action: "updated",
    detail: before
      ? diffFields(
          before as unknown as Record<string, unknown>,
          data as unknown as Record<string, unknown>,
        )
      : {},
  });

  revalidatePath("/settings/company");
  revalidatePath("/", "layout");
  return { ok: true };
}

const userSchema = z.object({
  userId: z.string().min(1),
  directSupervisorId: optionalText,
  timeZone: z.string().trim().min(1),
  phone: optionalText,
  active: z.coerce.boolean(),
});

export async function updateUser(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requirePermission("users.manage");

  const parsed = userSchema.safeParse({
    ...Object.fromEntries(formData),
    active: formData.get("active") === "on",
  });
  if (!parsed.success) {
    return { ok: false, error: z.prettifyError(parsed.error) };
  }

  const { userId, ...data } = parsed.data;

  if (data.directSupervisorId === userId) {
    return { ok: false, error: "A user cannot be their own supervisor." };
  }

  // A supervisor cycle would make payroll routing loop forever, so walk the
  // chain upwards before committing.
  let cursor = data.directSupervisorId;
  const seen = new Set<string>([userId]);
  while (cursor) {
    if (seen.has(cursor)) {
      return { ok: false, error: "That would create a supervisor loop." };
    }
    seen.add(cursor);
    const next: { directSupervisorId: string | null } | null =
      await db.user.findUnique({
        where: { id: cursor },
        select: { directSupervisorId: true },
      });
    cursor = next?.directSupervisorId ?? null;
  }

  const before = await db.user.findUnique({ where: { id: userId } });
  if (!before) return { ok: false, error: "User not found." };

  await db.user.update({ where: { id: userId }, data });

  await recordAudit({
    actorId: actor.id,
    entityType: "User",
    entityId: userId,
    action: "updated",
    detail: diffFields(
      before as unknown as Record<string, unknown>,
      data as unknown as Record<string, unknown>,
    ),
  });

  revalidatePath("/settings/users");
  return { ok: true };
}

const roleGrantSchema = z.object({
  role: z.enum(BaseRole),
  permission: z.string().refine(
    (value): value is Permission =>
      (PERMISSION_KEYS as string[]).includes(value),
    { message: "Unknown permission" },
  ),
  // "" means "revoke this permission from the role".
  scope: z.union([z.enum(PermissionScope), z.literal("")]),
});

export async function updateRoleGrant(
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requirePermission("roles.manage");

  const parsed = roleGrantSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: z.prettifyError(parsed.error) };
  }

  const { role, permission, scope } = parsed.data;

  // Locking yourself out of the role editor is unrecoverable without a shell
  // on the server, so this one combination is protected.
  if (role === "MANAGER" && permission === "roles.manage" && scope === "") {
    return {
      ok: false,
      error:
        "Managers must keep 'Manage roles', otherwise nobody can edit this matrix again.",
    };
  }

  if (scope === "") {
    await db.roleGrant.deleteMany({ where: { role, permission } });
  } else {
    await db.roleGrant.upsert({
      where: { role_permission: { role, permission } },
      update: { scope },
      create: { role, permission, scope },
    });
  }

  await recordAudit({
    actorId: actor.id,
    entityType: "RoleGrant",
    entityId: `${role}:${permission}`,
    action: scope === "" ? "revoked" : "granted",
    detail: { role, permission, scope: scope || null },
  });

  revalidatePath("/settings/roles");
  return { ok: true };
}
