"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { diffFields, recordAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { flag, optionalText } from "@/lib/form";
import {
  hashPassword,
  newSetupToken,
  passwordProblem,
  SETUP_TOKEN_HOURS,
} from "@/lib/password";
import { PERMISSION_KEYS, type Permission } from "@/lib/permissions";
import { requirePermission } from "@/lib/session";
import { BaseRole, PermissionScope } from "@prisma-client";

export type ActionResult = { ok: true } | { ok: false; error: string };


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
  showCompanyNameInHeader: flag,
  breakPaidByDefault: flag,
  mileageRate: z.coerce.number().min(0).max(100),
  payLagWeeks: z.coerce.number().int().min(0).max(26),
  maxPhotosPerJob: z.coerce.number().int().min(1).max(500),
  watermarkEnabled: flag,
});

export async function updateCompanySettings(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requirePermission("settings.company");

  const parsed = companySchema.safeParse({
    ...Object.fromEntries(formData),
    // Unchecked checkboxes are simply absent from FormData.
    showCompanyNameInHeader: formData.get("showCompanyNameInHeader") === "on",
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
  /** What the app calls them. Blank means "go back to what NextCloud says". */
  name: optionalText,
  legalName: optionalText,
  phone: optionalText,
  addressLine1: optionalText,
  addressLine2: optionalText,
  city: optionalText,
  state: optionalText,
  postalCode: optionalText,
  country: optionalText,
  active: flag,
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

  // A name typed here is a decision, and has to be marked as one: NextCloud
  // rewrites the name on every sign-in, so without the flag the correction
  // would survive until that person next signed in and then vanish. Clearing
  // the field hands the name back to NextCloud, which is how somebody undoes
  // a correction they no longer want.
  const { name, ...rest } = data;
  const nameChange =
    name && name !== before.name
      ? { name, nameOverridden: true }
      : name
        ? {}
        : before.nameOverridden
          ? { nameOverridden: false }
          : {};

  await db.user.update({
    where: { id: userId },
    data: { ...rest, ...nameChange },
  });

  await recordAudit({
    actorId: actor.id,
    entityType: "User",
    entityId: userId,
    action: "updated",
    detail: diffFields(
      before as unknown as Record<string, unknown>,
      { ...rest, ...nameChange } as unknown as Record<string, unknown>,
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

// ---------------------------------------------------------------------------
// Accounts for people who are not in NextCloud
// ---------------------------------------------------------------------------

export type LinkResult =
  | { ok: true; link?: string }
  | { ok: false; error: string };

const outsideUserSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  email: z.string().trim().toLowerCase().pipe(z.email("That is not an email address")),
  baseRole: z.enum(BaseRole),
  timeZone: z.string().trim().min(1),
  /** Blank means issue a link instead and let them choose their own. */
  password: optionalText,
});

/** The address somebody opens to choose a password. */
function setupLink(token: string): string {
  const base = (process.env.AUTH_URL ?? "").trim().replace(/\/+$/, "");
  return `${base}/set-password?token=${token}`;
}

async function issueToken(userId: string, actorId: string): Promise<string> {
  // Anything outstanding stops working: two live links means two people can
  // take the account.
  await db.passwordSetupToken.updateMany({
    where: { userId, usedAt: null },
    data: { usedAt: new Date() },
  });

  const { token, tokenHash } = newSetupToken();
  await db.passwordSetupToken.create({
    data: {
      userId,
      tokenHash,
      createdById: actorId,
      expiresAt: new Date(Date.now() + SETUP_TOKEN_HOURS * 3600_000),
    },
  });

  return setupLink(token);
}

/**
 * Creates an account for somebody outside the organisation.
 *
 * Their role is set here rather than read from a group, because there is no
 * group to read: that is the whole difference between these accounts and the
 * rest. Which means the person creating one is choosing what a non-employee
 * can see, and it is worth their while to choose Tech unless they have a
 * reason not to.
 */
export async function createOutsideUser(
  _prev: LinkResult | null,
  formData: FormData,
): Promise<LinkResult> {
  const actor = await requirePermission("users.manage");

  const parsed = outsideUserSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: z.prettifyError(parsed.error) };
  }

  const { name, email, baseRole, timeZone, password } = parsed.data;

  if (password) {
    const problem = passwordProblem(password);
    if (problem) return { ok: false, error: problem };
  }

  const taken = await db.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (taken) {
    return { ok: false, error: "Somebody already uses that address." };
  }

  const user = await db.user.create({
    data: {
      name,
      email,
      baseRole,
      timeZone,
      signInMethod: "LOCAL",
      // A password the administrator typed is one they still know, so it is
      // good for exactly one sign-in.
      passwordHash: password ? await hashPassword(password) : null,
      mustChangePassword: Boolean(password),
    },
    select: { id: true },
  });

  await recordAudit({
    actorId: actor.id,
    entityType: "User",
    entityId: user.id,
    action: "outside_account_created",
    detail: { who: name, field: "Sign-in", to: password ? "password set" : "link issued" },
  });

  revalidatePath("/settings/users");

  if (password) return { ok: true };
  return { ok: true, link: await issueToken(user.id, actor.id) };
}

/**
 * Hands an outside account over to NextCloud.
 *
 * The subcontractor joined the company. Their SSO sign-in was being refused
 * with "an administrator has to join the two", which named an action that did
 * not exist anywhere — the only ways out were deleting the account and its job
 * history, or editing the database by hand.
 *
 * The password goes with the change: it is not theirs to sign in with any
 * more, and leaving it would be a second door into the same account.
 */
export async function switchToSso(formData: FormData): Promise<LinkResult> {
  const actor = await requirePermission("users.manage");
  const userId = String(formData.get("userId") ?? "");

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, signInMethod: true },
  });
  if (!user) return { ok: false, error: "No such account." };
  if (user.signInMethod === "SSO") return { ok: true };

  await db.user.update({
    where: { id: userId },
    data: {
      signInMethod: "SSO",
      passwordHash: null,
      mustChangePassword: false,
      failedSignIns: 0,
      lockedUntil: null,
      passwordChangedAt: new Date(),
    },
  });

  // Any link still outstanding would set a password on an account that no
  // longer has one.
  await db.passwordSetupToken.updateMany({
    where: { userId, usedAt: null },
    data: { usedAt: new Date() },
  });

  await recordAudit({
    actorId: actor.id,
    entityType: "User",
    entityId: userId,
    action: "sign_in_method_changed",
    detail: { who: user.name, field: "Sign-in", from: "password", to: "SSO" },
  });

  revalidatePath("/settings/users");
  return { ok: true };
}

/**
 * A new link for an account that already exists.
 *
 * The same button answers a forgotten password and a first sign-in that never
 * happened, because they are the same thing: nobody currently holds a working
 * password for this account and somebody needs to choose one.
 */
export async function resetOutsidePassword(
  formData: FormData,
): Promise<LinkResult> {
  const actor = await requirePermission("users.manage");
  const userId = String(formData.get("userId") ?? "");

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, signInMethod: true },
  });
  if (!user) return { ok: false, error: "No such account." };

  if (user.signInMethod !== "LOCAL") {
    return {
      ok: false,
      error: "This account signs in through NextCloud, so its password is there.",
    };
  }

  // The old one stops working now rather than when the new link is used: an
  // account being reset is one somebody may already have the password to.
  await db.user.update({
    where: { id: userId },
    data: {
      passwordHash: null,
      mustChangePassword: false,
      failedSignIns: 0,
      lockedUntil: null,
      // Cuts off anybody already signed in on the password being replaced.
      passwordChangedAt: new Date(),
    },
  });

  await recordAudit({
    actorId: actor.id,
    entityType: "User",
    entityId: userId,
    action: "password_reset_issued",
    detail: { who: user.name },
  });

  revalidatePath("/settings/users");
  return { ok: true, link: await issueToken(userId, actor.id) };
}
