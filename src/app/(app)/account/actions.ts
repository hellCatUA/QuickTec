"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { storeUploadedAvatar } from "@/lib/avatar";
import { db } from "@/lib/db";
import { changedSinceOpened, optionalText, phoneText, samePhone } from "@/lib/form";
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
  LEVEL_INFO,
  narrowest,
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

  // Only what they changed: their supervisor may have set a work phone, or a
  // manager a state, while this page sat open.
  const touched = changedSinceOpened(formData);
  const pick = <T,>(key: string, now: string | null, typed: T, stored: T, same?: (a: string, b: string) => boolean) =>
    touched(key, now, same) ? typed : stored;

  // The name box capitalises what it is given, so "Ludwig van Beethoven"
  // comes back as "Ludwig Van Beethoven" without anybody touching it. That is
  // not a change, and must not become one — nor a reason to take the name
  // over from NextCloud, nor to refuse a save because NextCloud only ever had
  // one word for them.
  const typed = data.name ? capitaliseName(data.name) : null;
  if (!typed) return { ok: false, error: "Write your preferred name — first and last." };
  const nameChanged =
    touched("name", typed, (a, b) => a === capitaliseName(b)) && typed !== capitaliseName(before.name);
  const name = nameChanged ? typed : before.name;
  if (nameChanged && !isFullName(name)) {
    return { ok: false, error: "Write your preferred name in full — first and last." };
  }

  // The phones and the preferred one go together: which may be preferred
  // depends on which phones there are.
  const phonesTouched =
    touched("phone", data.phone, samePhone) ||
    touched("workPhone", data.workPhone, samePhone) ||
    touched("voipPhone", data.voipPhone, samePhone) ||
    touched("preferredPhone", data.preferredPhone);
  const phone = phonesTouched ? data.phone : before.phone;
  const workPhone = phonesTouched ? data.workPhone : before.workPhone;
  const voipPhone = phonesTouched ? data.voipPhone : before.voipPhone;
  const phones = { personal: phone, work: workPhone, voip: voipPhone };
  const preferredPhone = phonesTouched
    ? (data.preferredPhone as "PERSONAL" | "WORK" | "VOIP" | null)
    : before.preferredPhone;
  if (phonesTouched && preferredPhone) {
    const why = whyNotPreferable(preferredPhone, phones);
    if (why) return { ok: false, error: `${PHONE_LABEL[preferredPhone]} can't be your preferred phone: ${why.toLowerCase()}.` };
  }

  // The street is its two lines together.
  const streetTouched =
    touched("addressLine1", data.addressLine1) || touched("addressLine2", data.addressLine2);
  const addressLine1 = streetTouched ? data.addressLine1 : before.addressLine1;
  const addressLine2 = streetTouched ? data.addressLine2 : before.addressLine2;
  const city = pick("city", data.city, data.city, before.city);
  const state = pick("state", data.state, data.state, before.state);
  const postalCode = pick("postalCode", data.postalCode, data.postalCode, before.postalCode);

  // The zone follows the ZIP until somebody picks one; picking "from my ZIP"
  // hands it back.
  let timeZone = before.timeZone;
  let timeZoneManual = before.timeZoneManual;
  if (touched("timeZone", data.timeZone) || touched("postalCode", data.postalCode)) {
    if (data.timeZone === "auto") {
      timeZoneManual = false;
      timeZone = timeZoneForZip(postalCode) ?? before.timeZone;
    } else if (data.timeZone) {
      if (!US_TIME_ZONES.some((zone) => zone.value === data.timeZone)) {
        return { ok: false, error: "That is not a time zone." };
      }
      timeZone = data.timeZone;
      timeZoneManual = true;
    }
  }

  const primaryRegion = pick("primaryRegion", data.primaryRegion, data.primaryRegion, before.primaryRegion);
  const submittedStates = Array.from(
    new Set(
      formData
        .getAll("statesOfOperation")
        .map((value) => String(value).trim().toUpperCase())
        .filter((value) => US_STATES.some((entry) => entry.code === value)),
    ),
  );
  const states = pick(
    "statesOfOperation",
    [...submittedStates].sort().join(","),
    submittedStates,
    before.statesOfOperation,
  );

  // A legal name is theirs to give once — at onboarding, which until there is
  // one is "until it has ever been set". After that it is asked for, even if
  // it has been cleared.
  const legalTyped =
    !before.legalNameSetAt && data.legalName ? capitaliseName(data.legalName) : null;
  if (legalTyped && legalTyped !== before.legalName && !isFullName(legalTyped)) {
    return { ok: false, error: "Write your legal name in full — first and last." };
  }

  await db.user.update({
    where: { id: user.id },
    data: {
      name,
      // A name typed here is a decision, and NextCloud must not undo it at
      // the next sign-in.
      ...(name !== before.name ? { nameOverridden: true } : {}),
      phone,
      workPhone,
      voipPhone,
      preferredPhone,
      addressLine1,
      addressLine2,
      city,
      state,
      postalCode,
      timeZone,
      timeZoneManual,
      primaryRegion,
      statesOfOperation: states,
    },
  });

  // Once, and only while it still is the first time: two tabs, or a double
  // tap, must not give it twice.
  let legalName = before.legalName;
  if (legalTyped && legalTyped !== before.legalName) {
    const given = await db.user.updateMany({
      where: { id: user.id, legalNameSetAt: null },
      data: { legalName: legalTyped, legalNameSetAt: new Date() },
    });
    if (given.count === 1) legalName = legalTyped;
  }

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
        personalPhone: phoneDisplay(phone),
        workPhone: phoneDisplay(workPhone),
        voipPhone: phoneDisplay(voipPhone),
        preferredPhone: preferredAfter ? PHONE_LABEL[preferredAfter] : null,
        street: streetText(addressLine1, addressLine2),
        city,
        state: stateText(state),
        zip: postalCode,
        timeZone: zoneText(timeZone),
        primaryRegion: stateText(primaryRegion),
        statesOfOperation: statesText(states),
      },
    ),
  });

  revalidatePath("/account");
  revalidatePath(`/people/${user.id}`);
  return { ok: true, message: "Saved." };
}

/**
 * Who sees their picture — the one level a person picks for themselves:
 * Public, as pictures are, or kept to the company where the company lets them.
 */
export async function setOwnPictureVisibility(level: string): Promise<ProfileResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Not signed in." };
  if (level !== "PUBLIC" && level !== "FEDERATED") {
    return { ok: false, error: "That is not a choice here." };
  }

  const settings = await loadPrivacySettings();
  if (level === "FEDERATED" && !settings.picture.allowChoice) {
    return { ok: false, error: "The company shows every profile picture at the same level." };
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
        // Who sees it, by the level's own name, as the badge beside it says:
        // their choice, never wider than the company's level.
        from: LEVEL_INFO[narrowest(settings.picture.level, before.avatarVisibility)].label,
        to: LEVEL_INFO[narrowest(settings.picture.level, level)].label,
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
    select: { id: true, name: true, avatarPath: true, pictureSetAt: true, directSupervisorId: true },
  });
  if (!subject) return { ok: false, error: "Account not found." };

  const stored = await storeUploadedAvatar(user.id, file);
  if (!stored.ok) return stored;

  // The first picture is theirs to set. One taken down by a manager is not
  // a first picture: the next one is asked for.
  if (!subject.avatarPath && !subject.pictureSetAt) {
    const taken = await db.user.updateMany({
      where: { id: user.id, avatarPath: null, pictureSetAt: null },
      data: { avatarPath: stored.path, pictureSetAt: new Date() },
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

  let sent: { reviewer: string | null };
  try {
    sent = await fileProfileRequest({
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
  return { ok: true, message: `Sent to ${sent.reviewer ?? "a manager"}. It shows once approved.` };
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
    select: { id: true, name: true, legalName: true, legalNameSetAt: true, directSupervisorId: true },
  });
  if (!subject) return { ok: false, error: "Account not found." };
  if (subject.legalName === value) return { ok: false, error: "That is already your legal name." };

  if (!subject.legalNameSetAt) {
    const given = await db.user.updateMany({
      where: { id: user.id, legalNameSetAt: null },
      data: { legalName: value, legalNameSetAt: new Date() },
    });
    if (given.count === 0) return { ok: false, error: "Your legal name was set meanwhile. Reload to ask for a change." };
    await recordProfileEvents({
      actorId: user.id,
      userId: user.id,
      kind: "changed",
      changes: [{ field: "legalName", from: null, to: value }],
    });
    revalidatePath("/account");
    return { ok: true, message: "Saved." };
  }

  const sent = await fileProfileRequest({ subject, requesterId: user.id, field: "LEGAL_NAME", value });
  revalidatePath("/account");
  return { ok: true, message: `Sent to ${sent.reviewer ?? "a manager"}.` };
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
