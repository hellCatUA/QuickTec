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
import { KEYS_REFUSED, mayHoldKeysTo } from "@/lib/account-keys";
import { changedSinceOpened, flag, optionalText, phoneText, samePhone } from "@/lib/form";
import {
  canSignInWithPassword,
  hashPassword,
  newSetupToken,
  passwordProblem,
  SETUP_TOKEN_HOURS,
} from "@/lib/password";
import { isLocationIcon } from "@/lib/location-icons";
import { MAX_LOCATION_NAME } from "@/lib/deliverables";
import { capitaliseName, isFullName } from "@/lib/names";
import { PERMISSION_KEYS, type Permission } from "@/lib/permissions";
import {
  homeRegion,
  phoneText as phoneDisplay,
  ROLE_LABEL,
  streetText,
  zoneLine,
  zonePickedByHand,
} from "@/lib/profile-format";
import { preferredPhoneChange, profileChanges, recordProfileEvents } from "@/lib/profile-history";
import { requirePermission } from "@/lib/session";
import { canSupervise } from "@/lib/supervisors";
import { isOfferedTimeZone, timeZoneForZip, US_STATES } from "@/lib/us-regions";
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
  // The brand assets themselves are files, uploaded on their own by
  // ./company/brand-actions.ts; only their scales ride along with this form.
  logoScale: brandScale,
  headerLogoScale: brandScale,
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
  // The list the form offers. Any text used to do, and every page that shows
  // a time throws on a zone the formatter does not know.
  defaultTimeZone: z
    .string()
    .trim()
    .refine(isOfferedTimeZone, "That is not one of the time zones offered."),
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

// Fed straight to the date formatting on every page that shows the person —
// to them and to whoever looks at their profile — which throws on a zone it
// does not know. And held to the one list every screen offers: this page used
// to take any zone the formatter knew, so an "Etc/GMT+12" set here read as
// "From my ZIP" on the person's own profile, and moved to their ZIP's zone the
// next time they saved their apartment number.
const ZONE_REFUSED = "That is not one of the time zones offered.";
const timeZoneText = z.string().trim().refine(isOfferedTimeZone, ZONE_REFUSED);

const userSchema = z.object({
  userId: z.string().min(1),
  directSupervisorId: optionalText,
  // Checked against the list below, and only when it was changed: a zone
  // stored before the list was enforced must not stop every other save.
  timeZone: optionalText,
  /** What the app calls them. Blank means "go back to what NextCloud says". */
  name: optionalText,
  // No legal name: it is the direct supervisor's, and is changed on the
  // profile, where anybody else is warned and the supervisor told.
  phone: phoneText,
  addressLine1: optionalText,
  addressLine2: optionalText,
  city: optionalText,
  state: optionalText,
  postalCode: optionalText,
  country: optionalText,
  active: flag,
});

/**
 * One row of the Users page.
 *
 * Only what was changed on the row is saved. Everything it showed used to be
 * written back, touched or not: a phone and a street the person saved on
 * their own profile while this page sat open went back to the old ones, and
 * their history said this manager had done it. The row now says what each
 * field held when it was opened, as the person's own profile does, and a
 * field left alone keeps whatever is stored by the time it is saved.
 */
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

  const before = await db.user.findUnique({ where: { id: userId } });
  if (!before) return { ok: false, error: "User not found." };

  const touched = changedSinceOpened(formData);

  // A name typed here is a decision, and has to be marked as one: NextCloud
  // rewrites the name on every sign-in, so without the flag the correction
  // would survive until that person next signed in and then vanish. Clearing
  // the field hands the name back to NextCloud, which is how somebody undoes
  // a correction they no longer want. The box capitalises as it is typed, so
  // a name NextCloud sent in lower case is not a change until it is edited.
  const typedName = data.name ? capitaliseName(data.name) : null;
  let nameChange: { name?: string; nameOverridden?: boolean } = {};
  let nameReset = false;
  if (touched("name", typedName, (a, b) => a === capitaliseName(b))) {
    if (!typedName) {
      // An outside account has no NextCloud to hand its name back to.
      // Cleared, it kept the name it had and its history said "reset to
      // NextCloud".
      if (before.signInMethod === "LOCAL") {
        return { ok: false, error: "Write their name — first and last." };
      }
      if (before.nameOverridden) {
        nameChange = { nameOverridden: false };
        nameReset = true;
      }
    } else if (typedName !== capitaliseName(before.name)) {
      // The rule their own profile has always had: this page took "Pat",
      // which the profile then refused to save back.
      if (!isFullName(typedName)) {
        return { ok: false, error: "Write their name in full — first and last." };
      }
      nameChange = { name: typedName, nameOverridden: true };
    }
  }

  // Checked only when it was changed, and enforced here and not only in the
  // picker: this is the rule that keeps a week from sitting forever on
  // somebody who can never approve it. Checked on every save, a supervisor
  // deactivated since made every save of their people's rows fail — even the
  // one that would have given them somebody else — because the picker sent
  // the old name back.
  const directSupervisorId = touched("directSupervisorId", data.directSupervisorId)
    ? data.directSupervisorId
    : before.directSupervisorId;
  if (directSupervisorId && directSupervisorId !== before.directSupervisorId) {
    if (directSupervisorId === userId) {
      return { ok: false, error: "A user cannot be their own supervisor." };
    }
    const candidate = await db.user.findUnique({
      where: { id: directSupervisorId },
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

    // A supervisor cycle would make payroll routing loop forever, so walk the
    // chain upwards before committing.
    let cursor: string | null = directSupervisorId;
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
  }

  const phone = touched("phone", data.phone, samePhone) ? data.phone : before.phone;
  // The street is its two lines together, as on their own profile.
  const streetTouched =
    touched("addressLine1", data.addressLine1) || touched("addressLine2", data.addressLine2);
  const addressLine1 = streetTouched ? data.addressLine1 : before.addressLine1;
  const addressLine2 = streetTouched ? data.addressLine2 : before.addressLine2;
  const city = touched("city", data.city) ? data.city : before.city;
  const stateTouched = touched("state", data.state);
  if (stateTouched && data.state && !US_STATES.some((entry) => entry.code === data.state)) {
    return { ok: false, error: "That is not a state." };
  }
  const state = stateTouched ? data.state : before.state;
  const postalCode = touched("postalCode", data.postalCode) ? data.postalCode : before.postalCode;
  const country = touched("country", data.country) ? data.country : before.country;

  // Unticked on your own row, the next page was the sign-in screen — and on
  // the last account that manages users, nobody was left to tick it again
  // without the database.
  const active = touched("active", data.active ? "on" : "") ? data.active : before.active;
  if (!active && before.active && userId === actor.id) {
    return {
      ok: false,
      error: "You cannot deactivate your own account. Another manager can, if it should be.",
    };
  }

  // A zone set here is a choice, and a later change of address must not
  // quietly replace it with the one its ZIP is in — unless it is the ZIP's
  // own zone, which is following the ZIP, whoever clicked it. Left alone
  // while the ZIP moved, it follows the ZIP — as it would on their own
  // profile — unless it was a choice already; a zone that is not its ZIP's
  // was one even when nobody flagged it, and is flagged from now on.
  const zoneTyped =
    data.timeZone !== null &&
    touched("timeZone", data.timeZone) &&
    data.timeZone !== before.timeZone;
  if (zoneTyped && !isOfferedTimeZone(data.timeZone!)) {
    return { ok: false, error: ZONE_REFUSED };
  }
  const zipZone = timeZoneForZip(postalCode);
  const byHandBefore = zonePickedByHand(before);
  const byHandAfter = zoneTyped ? data.timeZone !== zipZone : byHandBefore;
  const zoneChange: { timeZone?: string; timeZoneManual?: boolean } = zoneTyped
    ? { timeZone: data.timeZone!, timeZoneManual: byHandAfter }
    : postalCode !== before.postalCode
      ? byHandBefore
        ? { timeZoneManual: true }
        : zipZone
          ? { timeZone: zipZone }
          : {}
      : {};
  const timeZone = zoneChange.timeZone ?? before.timeZone;

  // A personal phone somebody picked as the one clients call is theirs to
  // pick: replaced by a manager, it stops being the preferred one, rather than
  // a number they never chose going out on the paperwork.
  const preferredChange =
    !samePhone(phone ?? "", before.phone ?? "") && before.preferredPhone === "PERSONAL"
      ? { preferredPhone: null }
      : {};

  // Only what differs from what is stored is written, so a field nobody
  // changed is not put back over a change made a moment ago.
  const next: Record<string, unknown> = {
    ...nameChange,
    directSupervisorId,
    phone,
    addressLine1,
    addressLine2,
    city,
    state,
    postalCode,
    country,
    active,
    ...zoneChange,
    ...preferredChange,
  };
  const stored = before as unknown as Record<string, unknown>;
  const writes = Object.fromEntries(
    Object.entries(next).filter(([key, value]) => stored[key] !== value),
  );
  if (Object.keys(writes).length === 0) return { ok: true };

  await db.user.update({ where: { id: userId }, data: writes });

  await recordAudit({
    actorId: actor.id,
    entityType: "User",
    entityId: userId,
    action: "updated",
    // Marked: the person's own history is written below, line by line, and
    // reading this diff there as well would say everything twice.
    detail: { ...diffFields(stored, writes), _profile: true },
  });

  // Their profile's history, as the profile itself writes it.
  const supervisors = await db.user.findMany({
    where: {
      id: {
        in: [before.directSupervisorId, directSupervisorId].filter((id): id is string => Boolean(id)),
      },
    },
    select: { id: true, name: true },
  });
  const supervisorName = (id: string | null) =>
    id ? (supervisors.find((one) => one.id === id)?.name ?? null) : null;
  // Picked here, or handed back to the ZIP, it is the administrator's doing;
  // moved to the ZIP's zone when it followed the ZIP anyway, it is QuickTec's.
  const zoneByThem = zoneTyped && (byHandBefore || byHandAfter);
  await recordProfileEvents({
    actorId: actor.id,
    userId,
    changes: [
      ...profileChanges(
        {
          name: before.name,
          personalPhone: phoneDisplay(before.phone),
          street: streetText(before.addressLine1, before.addressLine2),
          homeRegion: homeRegion({ city: before.city, state: before.state, zip: before.postalCode }),
          directSupervisor: supervisorName(before.directSupervisorId),
        },
        {
          name: nameChange.name ?? before.name,
          personalPhone: phoneDisplay(phone),
          street: streetText(addressLine1, addressLine2),
          homeRegion: homeRegion({ city, state, zip: postalCode }),
          directSupervisor: supervisorName(directSupervisorId),
        },
      ),
      // Cleared here, the name is NextCloud's again from the next sign-in.
      ...(nameReset
        ? [{ field: "name" as const, verb: "reset" as const, from: before.name, to: null }]
        : []),
      ...(zoneByThem
        ? profileChanges(
            { timeZone: zoneLine(before.timeZone, byHandBefore, before.postalCode) },
            { timeZone: zoneLine(timeZone, byHandAfter, postalCode) },
          )
        : []),
      // Switched off and on again. Only the diff above used to hold it, and
      // nothing reads that, so a deactivation left no trace on the person.
      ...(active !== before.active
        ? [
            {
              field: "role" as const,
              verb: active ? ("reactivated" as const) : ("deactivated" as const),
              from: null,
              to: null,
            },
          ]
        : []),
    ],
  });
  if (!zoneByThem && timeZone !== before.timeZone) {
    await recordProfileEvents({
      actorId: null,
      userId,
      changes: [
        {
          field: "timeZone",
          from: zoneLine(before.timeZone, false, before.postalCode),
          to: zoneLine(timeZone, false, postalCode),
        },
      ],
      source: `Auto: ZIP ${postalCode ?? ""}`.trim(),
    });
  }
  // The phone clients get, when the change moved it to another phone — and
  // only then: a stored choice of Personal that a work phone already
  // overrode changes nothing for them.
  const moved = preferredPhoneChange(
    { chosen: before.preferredPhone, personal: before.phone, work: before.workPhone, voip: before.voipPhone },
    {
      chosen: "preferredPhone" in preferredChange ? null : before.preferredPhone,
      personal: phone,
      work: before.workPhone,
      voip: before.voipPhone,
    },
  );
  if (moved.length > 0) {
    await recordProfileEvents({
      actorId: actor.id,
      userId,
      changes: moved,
      reason: phone ? "Personal phone changed" : "Personal phone removed",
    });
  }

  revalidatePath("/settings/users");
  revalidatePath(`/people/${userId}`);
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
  const actor = await requirePermission("roles.manage", { minScope: "ALL" });

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
  // First and last, as every other screen that takes a person's name asks:
  // this one took a single word their own profile then refused to save.
  name: z
    .string()
    .trim()
    .min(1, "Write their name — first and last.")
    .transform(capitaliseName)
    .refine(isFullName, "Write their name in full — first and last."),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email("That is not an email address")),
  baseRole: z.enum(BaseRole),
  timeZone: timeZoneText,
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

  if (!(await mayHoldKeysTo(actor, { role: baseRole }))) return { ok: false, error: KEYS_REFUSED };

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
      // Picked by whoever made the account, with no ZIP to follow yet: a
      // ZIP put in later must not quietly replace it.
      timeZoneManual: true,
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
  // What the account starts with is on its history from the first line. Its
  // role is set here, once, rather than read from NextCloud groups.
  await recordProfileEvents({
    actorId: actor.id,
    userId: user.id,
    changes: [
      { field: "name", from: null, to: name },
      { field: "email", from: null, to: email },
      { field: "role", from: null, to: ROLE_LABEL[baseRole] ?? baseRole },
      { field: "timeZone", from: null, to: zoneLine(timeZone, true, null) },
    ],
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
    select: { id: true, name: true, email: true, signInMethod: true, baseRole: true },
  });
  if (!user) return { ok: false, error: "No such account." };
  // The same rule as resetting its password: handing an account to NextCloud
  // hands it to whoever signs in there first with that email. An administrator
  // refused a manager's password could still do this, until it was asked.
  if (!(await mayHoldKeysTo(actor, { role: user.baseRole, userId: user.id }))) {
    return { ok: false, error: KEYS_REFUSED };
  }
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
      baseRole: true,
      signInMethod: true,
      passwordFallback: true,
    },
  });
  if (!user) return { ok: false, error: "No such account." };
  if (!(await mayHoldKeysTo(actor, { role: user.baseRole, userId: user.id }))) {
    return { ok: false, error: KEYS_REFUSED };
  }

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
      baseRole: true,
      signInMethod: true,
      passwordFallback: true,
    },
  });
  if (!user) return { ok: false, error: "No such account." };
  if (!(await mayHoldKeysTo(actor, { role: user.baseRole, userId: user.id }))) {
    return { ok: false, error: KEYS_REFUSED };
  }

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
