"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { diffFields, recordAudit } from "@/lib/audit";
import {
  BRAND_SCALE_DEFAULT,
  BRAND_SCALE_MAX,
  BRAND_SCALE_MIN,
} from "@/lib/brand";
import { db } from "@/lib/db";
import { flag, optionalText, phoneText } from "@/lib/form";
import {
  canSignInWithPassword,
  hashPassword,
  newSetupToken,
  passwordProblem,
  SETUP_TOKEN_HOURS,
} from "@/lib/password";
import { isLocationIcon } from "@/lib/location-icons";
import { MAX_LOCATION_NAME } from "@/lib/deliverables";
import { PERMISSION_KEYS, type Permission } from "@/lib/permissions";
import { requirePermission } from "@/lib/session";
import { canSupervise } from "@/lib/supervisors";
import { BaseRole, PermissionScope } from "@prisma-client";

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Percent, held to the range the slider offers.
 *
 * `.default` rather than required: the sliders are always in the form, but a
 * page left open across a deploy submits whatever markup it was served, and
 * losing an unrelated settings save to a field that was not on screen is a
 * worse outcome than quietly taking the default.
 */
const brandScale = z.coerce
  .number()
  .int()
  .min(BRAND_SCALE_MIN)
  .max(BRAND_SCALE_MAX)
  .default(BRAND_SCALE_DEFAULT);

const companySchema = z.object({
  name: z.string().trim().min(1, "Company name is required"),
  logoUrl: optionalText,
  logoScale: brandScale,
  headerLogoUrl: optionalText,
  headerLogoScale: brandScale,
  appIconUrl: optionalText,
  addressLine1: optionalText,
  addressLine2: optionalText,
  city: optionalText,
  state: optionalText,
  postalCode: optionalText,
  country: optionalText,
  phone: phoneText,
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
  phone: phoneText,
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
  const actor = await requirePermission("users.manage", { minScope: "ALL" });

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

  // Enforced here and not only in the picker: this is the rule that keeps a
  // week from sitting forever on somebody who can never approve it.
  if (data.directSupervisorId) {
    const candidate = await db.user.findUnique({
      where: { id: data.directSupervisorId },
      select: { name: true, baseRole: true, active: true },
    });
    if (!candidate) {
      return { ok: false, error: "That supervisor does not exist." };
    }
    if (!candidate.active) {
      return {
        ok: false,
        error: `${candidate.name} is deactivated and cannot approve anyone's week.`,
      };
    }
    if (!canSupervise(candidate.baseRole)) {
      return {
        ok: false,
        error: `${candidate.name} cannot approve payroll, so they cannot be a direct supervisor. Pick a manager or an administrator.`,
      };
    }
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
  permission: z
    .string()
    .refine(
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
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email("That is not an email address")),
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
  const actor = await requirePermission("users.manage", { minScope: "ALL" });

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
    detail: {
      who: name,
      field: "Sign-in",
      to: password ? "password set" : "link issued",
    },
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
  const actor = await requirePermission("users.manage", { minScope: "ALL" });
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
      // Not carried over as a fallback either: this account is being handed to
      // NextCloud, and keeping the password it had would be the second door
      // this change exists to close.
      passwordFallback: false,
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
 * Gives a NextCloud account a QuickTec password as well.
 *
 * OIDC is a conversation with another server over domain names. A site that
 * cannot reach NextCloud cannot sign anybody in at all, and the people it
 * strands are exactly the ones standing at a customer's door. This is the way
 * back in, granted one person at a time by somebody who decided they should
 * have it.
 *
 * SSO keeps working and keeps deciding what they can see: the role is still
 * read from their groups on every SSO sign-in, and nothing here touches it.
 * What this adds is a second way to prove who they are, and like every other
 * password in this app it is chosen by its owner through a one-time link
 * rather than typed by the administrator granting it.
 */
export async function grantPasswordFallback(
  formData: FormData,
): Promise<LinkResult> {
  const actor = await requirePermission("users.manage", { minScope: "ALL" });
  const userId = String(formData.get("userId") ?? "");

  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      active: true,
      signInMethod: true,
      passwordFallback: true,
    },
  });
  if (!user) return { ok: false, error: "No such account." };

  if (user.signInMethod === "LOCAL") {
    return {
      ok: false,
      error: "This account already signs in with a QuickTec password.",
    };
  }
  if (!user.active) {
    return {
      ok: false,
      error: "This account is deactivated. Reactivate it first.",
    };
  }
  // The screen hides the button once it is granted, which is not a guard: a
  // server action is a POST and its id is in a public chunk. Granting twice
  // would throw away a password its owner had chosen and issue a fresh link
  // for it, which is a reset wearing the word "grant".
  if (user.passwordFallback) {
    return {
      ok: false,
      error:
        "This account already has one. Issue a new link if they have lost it.",
    };
  }

  await db.user.update({
    where: { id: userId },
    data: {
      passwordFallback: true,
      // Granting is not setting: they choose it through the link below. Until
      // they do there is no password on the account, so the door is open in
      // the sense that it has a lock on it and no key cut yet.
      passwordHash: null,
      mustChangePassword: false,
      failedSignIns: 0,
      lockedUntil: null,
      // Every sibling that nulls a hash stamps this, and for the same reason:
      // whatever was opened with the password that is going should go with it.
      passwordChangedAt: new Date(),
    },
  });

  await recordAudit({
    actorId: actor.id,
    entityType: "User",
    entityId: userId,
    action: "password_fallback_granted",
    detail: {
      who: user.name,
      field: "Sign-in",
      from: "SSO only",
      to: "SSO and a QuickTec password",
    },
  });

  revalidatePath("/settings/users");
  return { ok: true, link: await issueToken(userId, actor.id) };
}

/**
 * Takes it away again.
 *
 * The password goes with the permission, and so does anybody holding a session
 * that was opened with it: a fallback being revoked is a fallback somebody may
 * have learned, and leaving them signed in for the rest of the week is the
 * case revoking it exists for.
 */
export async function revokePasswordFallback(
  formData: FormData,
): Promise<LinkResult> {
  const actor = await requirePermission("users.manage", { minScope: "ALL" });
  const userId = String(formData.get("userId") ?? "");

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, signInMethod: true, passwordFallback: true },
  });
  if (!user) return { ok: false, error: "No such account." };

  if (user.signInMethod === "LOCAL") {
    return {
      ok: false,
      error:
        "A password is the only way into this account. Hand it to NextCloud instead, or deactivate it.",
    };
  }
  if (!user.passwordFallback) return { ok: true };

  await db.user.update({
    where: { id: userId },
    data: {
      passwordFallback: false,
      passwordHash: null,
      mustChangePassword: false,
      failedSignIns: 0,
      lockedUntil: null,
      passwordChangedAt: new Date(),
    },
  });

  // A link still outstanding would set a password on an account that is no
  // longer allowed one.
  await db.passwordSetupToken.updateMany({
    where: { userId, usedAt: null },
    data: { usedAt: new Date() },
  });

  await recordAudit({
    actorId: actor.id,
    entityType: "User",
    entityId: userId,
    action: "password_fallback_revoked",
    detail: {
      who: user.name,
      field: "Sign-in",
      from: "SSO and a QuickTec password",
      to: "SSO only",
    },
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
  const actor = await requirePermission("users.manage", { minScope: "ALL" });
  const userId = String(formData.get("userId") ?? "");

  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      signInMethod: true,
      passwordFallback: true,
    },
  });
  if (!user) return { ok: false, error: "No such account." };

  if (!canSignInWithPassword(user)) {
    return {
      ok: false,
      error:
        "This account signs in through NextCloud, so its password is there.",
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

// ---------------------------------------------------------------------------
// The positions a site contact might hold
// ---------------------------------------------------------------------------
//
// A dictionary, not a set of allowed values: what a job stores is the text
// that was written on it. Renaming an entry changes what is offered from now
// on and rewrites nothing, and retiring one takes it off the list while every
// job that used it keeps saying what it said.

const positionSchema = z.object({
  label: z.string().trim().min(1, "Give it a name").max(80),
});

export async function addContactPosition(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requirePermission("settings.company");

  const parsed = positionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success)
    return { ok: false, error: z.prettifyError(parsed.error) };
  const { label } = parsed.data;

  const clash = await db.contactPosition.findUnique({
    where: { label },
    select: { id: true, active: true },
  });
  if (clash) {
    // Retired rather than absent is the common case: somebody takes one off
    // the list and puts it back a month later.
    if (clash.active)
      return { ok: false, error: "That one is already on the list." };
    await db.contactPosition.update({
      where: { id: clash.id },
      data: { active: true },
    });
    revalidatePath("/settings/company");
    return { ok: true };
  }

  const last = await db.contactPosition.findFirst({
    orderBy: { order: "desc" },
    select: { order: true },
  });

  await db.contactPosition.create({
    data: { label, order: (last?.order ?? -1) + 1 },
  });

  revalidatePath("/settings/company");
  return { ok: true };
}

export async function renameContactPosition(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requirePermission("settings.company");

  const id = String(formData.get("id") ?? "");
  const parsed = positionSchema.safeParse({ label: formData.get("label") });
  if (!parsed.success)
    return { ok: false, error: z.prettifyError(parsed.error) };

  const clash = await db.contactPosition.findUnique({
    where: { label: parsed.data.label },
    select: { id: true },
  });
  if (clash && clash.id !== id) {
    return { ok: false, error: "There is already one called that." };
  }

  await db.contactPosition.update({
    where: { id },
    data: { label: parsed.data.label },
  });

  revalidatePath("/settings/company");
  return { ok: true };
}

/** Off the list from now on. Jobs that used it are left as they are. */
export async function retireContactPosition(
  formData: FormData,
): Promise<ActionResult> {
  await requirePermission("settings.company");

  const id = String(formData.get("id") ?? "");
  await db.contactPosition.update({ where: { id }, data: { active: false } });

  revalidatePath("/settings/company");
  return { ok: true };
}

/** Up or down one place, which is the only ordering anybody asks for. */
export async function moveContactPosition(
  formData: FormData,
): Promise<ActionResult> {
  await requirePermission("settings.company");

  const id = String(formData.get("id") ?? "");
  const up = formData.get("direction") === "up";

  const all = await db.contactPosition.findMany({
    where: { active: true },
    orderBy: [{ order: "asc" }, { label: "asc" }],
    select: { id: true },
  });

  const at = all.findIndex((one) => one.id === id);
  const swapWith = up ? at - 1 : at + 1;
  if (at === -1 || swapWith < 0 || swapWith >= all.length) return { ok: true };

  [all[at], all[swapWith]] = [all[swapWith], all[at]];

  // Rewritten whole rather than swapping two rows: the list is a dozen rows
  // and an order that was never contiguous stays wrong if only two move.
  await db.$transaction(
    all.map((one, index) =>
      db.contactPosition.update({
        where: { id: one.id },
        data: { order: index },
      }),
    ),
  );

  revalidatePath("/settings/company");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// The locations on site photos are filed under
// ---------------------------------------------------------------------------
//
// The same kind of dictionary as the positions above: what is offered while
// somebody adds a location to a job, with the icon it is drawn with. A job
// keeps the name and icon it was given, so nothing here rewrites a job.

const locationLabel = z
  .string()
  .transform((value) => value.replace(/\s+/g, " ").trim())
  .pipe(
    z
      .string()
      .min(1, "Give it a name")
      .max(MAX_LOCATION_NAME, `Keep it to ${MAX_LOCATION_NAME} characters.`)
      // A folder in the export: dots or dashes alone are no name.
      .regex(/[\p{L}\p{N}]/u, "Give it a name with a letter or a number in it."),
  );

const locationIconField = z
  .string()
  .refine(isLocationIcon, "That icon is not in the collection.");

export async function addKnownLocation(
  formData: FormData,
): Promise<ActionResult> {
  await requirePermission("settings.company");

  const parsed = z
    .object({ label: locationLabel, icon: locationIconField })
    .safeParse({ label: formData.get("label") ?? "", icon: formData.get("icon") });
  if (!parsed.success)
    return { ok: false, error: z.prettifyError(parsed.error) };
  const { label, icon } = parsed.data;

  // "MDF" and "mdf" are one room; a second entry for it splits the photos.
  const clash = await db.knownLocation.findFirst({
    where: { label: { equals: label, mode: "insensitive" } },
    select: { id: true, active: true },
  });
  if (clash) {
    if (clash.active)
      return { ok: false, error: "That one is already on the list." };
    // Put back rather than made again, with the icon chosen now.
    await db.knownLocation.update({
      where: { id: clash.id },
      data: { active: true, label, icon },
    });
    revalidatePath("/settings/company");
    return { ok: true };
  }

  const last = await db.knownLocation.findFirst({
    orderBy: { order: "desc" },
    select: { order: true },
  });

  await db.knownLocation.create({
    data: { label, icon, order: (last?.order ?? -1) + 1 },
  });

  revalidatePath("/settings/company");
  return { ok: true };
}

export async function renameKnownLocation(
  formData: FormData,
): Promise<ActionResult> {
  await requirePermission("settings.company");

  const id = String(formData.get("id") ?? "");
  const parsed = locationLabel.safeParse(formData.get("label") ?? "");
  if (!parsed.success)
    return { ok: false, error: z.prettifyError(parsed.error) };

  const clash = await db.knownLocation.findFirst({
    where: { label: { equals: parsed.data, mode: "insensitive" } },
    select: { id: true },
  });
  if (clash && clash.id !== id) {
    return { ok: false, error: "There is already one called that." };
  }

  await db.knownLocation.update({
    where: { id },
    data: { label: parsed.data },
  });

  revalidatePath("/settings/company");
  return { ok: true };
}

/** A different picture from now on. Jobs keep the one they were given. */
export async function setKnownLocationIcon(
  formData: FormData,
): Promise<ActionResult> {
  await requirePermission("settings.company");

  const id = String(formData.get("id") ?? "");
  const parsed = locationIconField.safeParse(formData.get("icon"));
  if (!parsed.success)
    return { ok: false, error: z.prettifyError(parsed.error) };

  await db.knownLocation.update({ where: { id }, data: { icon: parsed.data } });

  revalidatePath("/settings/company");
  return { ok: true };
}

/** Off the list from now on. Jobs that used it are left as they are. */
export async function retireKnownLocation(
  formData: FormData,
): Promise<ActionResult> {
  await requirePermission("settings.company");

  const id = String(formData.get("id") ?? "");
  await db.knownLocation.update({ where: { id }, data: { active: false } });

  revalidatePath("/settings/company");
  return { ok: true };
}

/** Up or down one place: the ones on most jobs belong at the top. */
export async function moveKnownLocation(
  formData: FormData,
): Promise<ActionResult> {
  await requirePermission("settings.company");

  const id = String(formData.get("id") ?? "");
  const up = formData.get("direction") === "up";

  const all = await db.knownLocation.findMany({
    where: { active: true },
    orderBy: [{ order: "asc" }, { label: "asc" }],
    select: { id: true },
  });

  const at = all.findIndex((one) => one.id === id);
  const swapWith = up ? at - 1 : at + 1;
  if (at === -1 || swapWith < 0 || swapWith >= all.length) return { ok: true };

  [all[at], all[swapWith]] = [all[swapWith], all[at]];

  await db.$transaction(
    all.map((one, index) =>
      db.knownLocation.update({
        where: { id: one.id },
        data: { order: index },
      }),
    ),
  );

  revalidatePath("/settings/company");
  return { ok: true };
}
