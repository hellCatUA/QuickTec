"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { storeUploadedAvatar } from "@/lib/avatar";
import { db } from "@/lib/db";
import { optionalText, phoneText } from "@/lib/form";
import { capitaliseName, isFullName } from "@/lib/names";
import { loadPrivacySettings, loadProfile } from "@/lib/profile";
import {
  phoneText as phoneDisplay,
  stateText,
  statesText,
  streetText,
  zoneText,
} from "@/lib/profile-format";
import { profileChanges, recordProfileEvents } from "@/lib/profile-history";
import {
  effectivePreferred,
  PHONE_LABEL,
  whyNotPreferable,
} from "@/lib/profile-privacy";
import {
  fileProfileRequest,
  withdrawProfileRequest,
} from "@/lib/profile-requests";
import { getSessionUser } from "@/lib/session";
import { deleteFile } from "@/lib/storage";
import { timeZoneForZip, US_STATES, US_TIME_ZONES } from "@/lib/us-regions";

export type ProfileResult = { ok: true; message?: string } | { ok: false; error: string };

const isState = (value: string | null) =>
  !value || US_STATES.some((entry) => entry.code === value);

const ownSchema = z.object({
  name: optionalText,
  legalName: optionalText,
  phone: phoneText,
  workPhone: phoneText,
  voipPhone: phoneText,
  preferredPhone: optionalText.refine(
    (value) => !value || ["PERSONAL", "WORK", "VOIP"].includes(value),
    "That is not one of your phones.",
  ),
  addressLine1: optionalText,
  addressLine2: optionalText,
  city: optionalText,
  // The picker offers fifty-six; the action should accept fifty-six.
  state: optionalText.refine(isState, "That is not a state."),
  postalCode: optionalText,
  /** "auto" for the zone the ZIP is in, or one picked from the list. */
  timeZone: optionalText,
  primaryRegion: optionalText.refine(isState, "That is not a state."),
});

/**
 * Everything on somebody's profile that is theirs to keep current.
 *
 * Not here, because it is not theirs: the role, the supervisor, the years of
 * service, the pay rate — and, once they are set, the legal name and the
 * picture, which change only by asking.
 */
export async function saveOwnProfile(
  _prev: ProfileResult | null,
  formData: FormData,
): Promise<ProfileResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const parsed = ownSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: z.prettifyError(parsed.error) };
  const data = parsed.data;

  const before = await loadProfile(user.id);
  if (!before) return { ok: false, error: "Account not found." };

  const name = data.name ? capitaliseName(data.name) : null;
  if (!name || !isFullName(name)) {
    return { ok: false, error: "Write your preferred name in full — first and last." };
  }

  const phones = { personal: data.phone, work: data.workPhone, voip: data.voipPhone };
  const preferredPhone = data.preferredPhone as "PERSONAL" | "WORK" | "VOIP" | null;
  if (preferredPhone) {
    const why = whyNotPreferable(preferredPhone, phones);
    if (why) return { ok: false, error: `${PHONE_LABEL[preferredPhone]} can't be your preferred phone: ${why.toLowerCase()}.` };
  }

  // The zone follows the ZIP until somebody picks one; picking "from my ZIP"
  // hands it back.
  let timeZone = before.timeZone;
  let timeZoneManual = before.timeZoneManual;
  if (data.timeZone === "auto") {
    timeZoneManual = false;
    timeZone = timeZoneForZip(data.postalCode) ?? before.timeZone;
  } else if (data.timeZone) {
    if (!US_TIME_ZONES.some((zone) => zone.value === data.timeZone)) {
      return { ok: false, error: "That is not a time zone." };
    }
    timeZone = data.timeZone;
    timeZoneManual = true;
  }

  const states = Array.from(
    new Set(
      formData
        .getAll("statesOfOperation")
        .map((value) => String(value).trim().toUpperCase())
        .filter((value) => US_STATES.some((entry) => entry.code === value)),
    ),
  );

  // A legal name is theirs to give once — at onboarding, which until there is
  // an onboarding is "while there is none". After that, they ask.
  const legalName =
    !before.legalName && data.legalName ? capitaliseName(data.legalName) : before.legalName;

  await db.user.update({
    where: { id: user.id },
    data: {
      name,
      // A name typed here is a decision, and NextCloud must not undo it at
      // the next sign-in.
      ...(name !== before.name ? { nameOverridden: true } : {}),
      legalName,
      phone: data.phone,
      workPhone: data.workPhone,
      voipPhone: data.voipPhone,
      preferredPhone,
      addressLine1: data.addressLine1,
      addressLine2: data.addressLine2,
      city: data.city,
      state: data.state,
      postalCode: data.postalCode,
      timeZone,
      timeZoneManual,
      primaryRegion: data.primaryRegion,
      statesOfOperation: states,
    },
  });

  const preferredBefore = effectivePreferred(before.preferredPhone, {
    personal: before.phone,
    work: before.workPhone,
    voip: before.voipPhone,
  });
  const preferredAfter = effectivePreferred(preferredPhone, phones);

  await recordProfileEvents({
    actorId: user.id,
    userId: user.id,
    kind: "changed",
    changes: profileChanges(
      {
        name: before.name,
        legalName: before.legalName,
        personalPhone: phoneDisplay(before.phone),
        workPhone: phoneDisplay(before.workPhone),
        voipPhone: phoneDisplay(before.voipPhone),
        preferredPhone: preferredBefore ? PHONE_LABEL[preferredBefore] : null,
        street: streetText(before.addressLine1, before.addressLine2),
        city: before.city,
        state: stateText(before.state),
        zip: before.postalCode,
        timeZone: zoneText(before.timeZone),
        primaryRegion: stateText(before.primaryRegion),
        statesOfOperation: statesText(before.statesOfOperation),
      },
      {
        name,
        legalName,
        personalPhone: phoneDisplay(data.phone),
        workPhone: phoneDisplay(data.workPhone),
        voipPhone: phoneDisplay(data.voipPhone),
        preferredPhone: preferredAfter ? PHONE_LABEL[preferredAfter] : null,
        street: streetText(data.addressLine1, data.addressLine2),
        city: data.city,
        state: stateText(data.state),
        zip: data.postalCode,
        timeZone: zoneText(timeZone),
        primaryRegion: stateText(data.primaryRegion),
        statesOfOperation: statesText(states),
      },
    ),
  });

  revalidatePath("/account");
  revalidatePath(`/people/${user.id}`);
  return { ok: true, message: "Saved." };
}

/** Who sees their picture — the one level a person picks for themselves. */
export async function setOwnPictureVisibility(level: string): Promise<ProfileResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Not signed in." };
  if (level !== "PUBLIC" && level !== "FEDERATED") {
    return { ok: false, error: "That is not a choice here." };
  }

  const settings = await loadPrivacySettings();
  if (level === "PUBLIC" && !settings.picture.allowPublic) {
    return { ok: false, error: "The company keeps profile pictures off client paperwork." };
  }

  const before = await db.user.findUnique({
    where: { id: user.id },
    select: { avatarVisibility: true },
  });
  if (!before) return { ok: false, error: "Account not found." };
  if (before.avatarVisibility === level) return { ok: true };

  await db.user.update({ where: { id: user.id }, data: { avatarVisibility: level } });
  await recordProfileEvents({
    actorId: user.id,
    userId: user.id,
    kind: "changed",
    changes: [
      {
        field: "picture",
        from: `Shown to ${before.avatarVisibility === "PUBLIC" ? "Public" : "Federated"}`,
        to: `Shown to ${level === "PUBLIC" ? "Public" : "Federated"}`,
      },
    ],
  });

  revalidatePath("/account");
  return { ok: true };
}

/**
 * A new picture. The first one is theirs to set; after that it waits on
 * their direct supervisor.
 */
export async function uploadOwnPicture(formData: FormData): Promise<ProfileResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const file = formData.get("picture");
  if (!(file instanceof File)) return { ok: false, error: "Pick a photo first." };

  const subject = await db.user.findUnique({
    where: { id: user.id },
    select: { id: true, name: true, avatarPath: true, directSupervisorId: true },
  });
  if (!subject) return { ok: false, error: "Account not found." };

  const stored = await storeUploadedAvatar(user.id, file);
  if (!stored.ok) return stored;

  if (!subject.avatarPath) {
    const taken = await db.user.updateMany({
      where: { id: user.id, avatarPath: null },
      data: { avatarPath: stored.path },
    });
    if (taken.count === 1) {
      await recordProfileEvents({
        actorId: user.id,
        userId: user.id,
        kind: "changed",
        changes: [{ field: "picture", from: null, to: "Picture added" }],
      });
      revalidatePath("/account");
      return { ok: true, message: "Your picture is set." };
    }
    // Somebody set one in the meantime, so this one is now a request.
  }

  try {
    await fileProfileRequest({
      subject,
      requesterId: user.id,
      field: "PICTURE",
      picturePath: stored.path,
    });
  } catch (error) {
    await deleteFile(stored.path);
    throw error;
  }

  revalidatePath("/account");
  return { ok: true, message: "Sent to your direct supervisor. It shows once they approve it." };
}

/**
 * A different legal name. The first one is theirs to give; after that it
 * waits on their direct supervisor, because it is what payroll pays.
 */
export async function requestOwnLegalName(
  _prev: ProfileResult | null,
  formData: FormData,
): Promise<ProfileResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const raw = optionalText.parse(formData.get("legalName"));
  const value = raw ? capitaliseName(raw) : null;
  if (!value || !isFullName(value)) {
    return { ok: false, error: "Write the legal name in full — first and last." };
  }

  const subject = await db.user.findUnique({
    where: { id: user.id },
    select: { id: true, name: true, legalName: true, directSupervisorId: true },
  });
  if (!subject) return { ok: false, error: "Account not found." };
  if (subject.legalName === value) return { ok: false, error: "That is already your legal name." };

  if (!subject.legalName) {
    await db.user.update({ where: { id: user.id }, data: { legalName: value } });
    await recordProfileEvents({
      actorId: user.id,
      userId: user.id,
      kind: "changed",
      changes: [{ field: "legalName", from: null, to: value }],
    });
    revalidatePath("/account");
    return { ok: true, message: "Saved." };
  }

  await fileProfileRequest({ subject, requesterId: user.id, field: "LEGAL_NAME", value });
  revalidatePath("/account");
  return { ok: true, message: "Sent to your direct supervisor." };
}

export async function withdrawOwnRequest(requestId: string): Promise<ProfileResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const withdrawn = await withdrawProfileRequest({
    requestId,
    userId: user.id,
    actorId: user.id,
  });
  if (!withdrawn) return { ok: false, error: "That request has already been answered." };

  revalidatePath("/account");
  return { ok: true };
}
