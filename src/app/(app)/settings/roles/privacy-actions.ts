"use server";

import { revalidatePath } from "next/cache";
import { recordAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import {
  differsFromDefault,
  fieldDefinition,
  isPrivacyLevel,
  isProfileField,
  LEVEL_INFO,
  PROFILE_FIELD_KEYS,
} from "@/lib/profile-privacy";
import { requirePermission } from "@/lib/session";

export type PrivacyResult = { ok: true } | { ok: false; error: string };

/**
 * Sets who may see one profile field, company-wide.
 *
 * A field put back on its optimized default loses its row rather than keeping
 * one that happens to agree: "how far is this company from the defaults" is
 * then simply how many rows there are.
 */
export async function setFieldPrivacy(input: {
  field: string;
  level: string;
  allowPublic?: boolean;
}): Promise<PrivacyResult> {
  const actor = await requirePermission("roles.manage");

  if (!isProfileField(input.field)) return { ok: false, error: "Unknown field." };
  if (!isPrivacyLevel(input.level)) return { ok: false, error: "Unknown level." };

  const field = input.field;
  const definition = fieldDefinition(field);
  const allowPublic = definition.allowPublic
    ? (input.allowPublic ?? definition.allowPublic.default)
    : false;

  const before = await db.profilePrivacy.findUnique({ where: { field } });
  const value = { level: input.level, allowPublic };

  if (differsFromDefault(field, value)) {
    await db.profilePrivacy.upsert({
      where: { field },
      update: {
        level: value.level,
        allowPublic: definition.allowPublic ? allowPublic : null,
        updatedById: actor.id,
      },
      create: {
        field,
        level: value.level,
        allowPublic: definition.allowPublic ? allowPublic : null,
        updatedById: actor.id,
      },
    });
  } else {
    await db.profilePrivacy.deleteMany({ where: { field } });
  }

  await recordAudit({
    actorId: actor.id,
    entityType: "ProfilePrivacy",
    entityId: field,
    action: "updated",
    detail: {
      field: definition.label,
      from: LEVEL_INFO[before?.level ?? definition.level].label,
      to: LEVEL_INFO[value.level].label,
      ...(definition.allowPublic ? { allowPublic } : {}),
    },
  });

  revalidatePath("/settings/roles");
  return { ok: true };
}

/** Forgets every change: the optimized defaults, as they ship. */
export async function restorePrivacyDefaults(): Promise<PrivacyResult> {
  const actor = await requirePermission("roles.manage");

  const rows = await db.profilePrivacy.findMany({ select: { field: true, level: true } });
  if (rows.length === 0) return { ok: true };

  await db.profilePrivacy.deleteMany({});
  await recordAudit({
    actorId: actor.id,
    entityType: "ProfilePrivacy",
    entityId: "all",
    action: "restored_defaults",
    detail: {
      count: rows.length,
      fields: rows
        .filter((row) => isProfileField(row.field))
        .map((row) => fieldDefinition(row.field as (typeof PROFILE_FIELD_KEYS)[number]).label),
    },
  });

  revalidatePath("/settings/roles");
  return { ok: true };
}
