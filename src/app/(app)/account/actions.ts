"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { approvalOf, PICTURE_SOURCE, putUpPicture, storeUploadedAvatar } from "@/lib/avatar";
import { db } from "@/lib/db";
import { changedSinceOpened, optionalText, phoneText, samePhone } from "@/lib/form";
import { capitaliseName, isFullName } from "@/lib/names";
import { actingSupervisor, loadPrivacySettings, loadProfile } from "@/lib/profile";
import {
  homeRegion,
  isPictureReason,
  phoneText as phoneDisplay,
  PICTURE_REASONS,
  stateText,
  streetText,
  zoneLine,
  zonePickedByHand,
} from "@/lib/profile-format";
import {
  preferredPhoneChange,
  profileChanges,
  recordProfileEvents,
  statesChange,
} from "@/lib/profile-history";
import { LEVEL_INFO, levelFor, PHONE_LABEL, whyNotPreferable } from "@/lib/profile-privacy";
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
  // hands it back. Left as it was, it does what is stored, not what the page
  // showed when it was opened: an administrator may have picked one since.
  // A zone picked by hand stays, and is flagged as picked from now on.
  let timeZone = before.timeZone;
  let timeZoneManual = before.timeZoneManual;
  const byHandBefore = zonePickedByHand(before);
  const zonePicked = touched("timeZone", data.timeZone);
  const zipMoved = touched("postalCode", data.postalCode);
  if (!zonePicked && zipMoved) {
    if (byHandBefore) timeZoneManual = true;
    else timeZone = timeZoneForZip(postalCode) ?? before.timeZone;
  } else if (zonePicked) {
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

  // Picked by hand or handed back to the ZIP, it is their doing; left to
  // follow the ZIP and moved with a new one, it is QuickTec's.
  const byHandAfter = zonePicked && data.timeZone ? timeZoneManual : byHandBefore;
  const zoneByThem = zonePicked && (byHandBefore || byHandAfter);

  await recordProfileEvents({
    actorId: user.id,
    userId: user.id,
    changes: [
      ...profileChanges(
        {
          name: before.name,
          legalName: before.legalName,
          personalPhone: phoneDisplay(before.phone),
          workPhone: phoneDisplay(before.workPhone),
          voipPhone: phoneDisplay(before.voipPhone),
          street: streetText(before.addressLine1, before.addressLine2),
          homeRegion: homeRegion({ city: before.city, state: before.state, zip: before.postalCode }),
          primaryRegion: stateText(before.primaryRegion),
        },
        {
          name,
          legalName,
          personalPhone: phoneDisplay(phone),
          workPhone: phoneDisplay(workPhone),
          voipPhone: phoneDisplay(voipPhone),
          street: streetText(addressLine1, addressLine2),
          homeRegion: homeRegion({ city, state, zip: postalCode }),
          primaryRegion: stateText(primaryRegion),
        },
      ),
      ...preferredPhoneChange(
        {
          chosen: before.preferredPhone,
          personal: before.phone,
          work: before.workPhone,
          voip: before.voipPhone,
        },
        { chosen: preferredPhone, ...phones },
      ),
      ...statesChange(before.statesOfOperation, states, (code) => stateText(code) ?? code),
      ...(zoneByThem
        ? profileChanges(
            { timeZone: zoneLine(before.timeZone, byHandBefore, before.postalCode) },
            { timeZone: zoneLine(timeZone, byHandAfter, postalCode) },
          )
        : []),
    ],
  });
  if (!zoneByThem && timeZone !== before.timeZone) {
    await recordProfileEvents({
      actorId: null,
      userId: user.id,
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
  // Who sees it, as the badge says it: their choice within the company's
  // level. A choice that changes nobody's view is not history.
  const shownAs = (choice: typeof level) =>
    levelFor("picture", settings, {
      avatarVisibility: choice,
      preferredPhone: null,
      phones: { personal: null, work: null, voip: null },
    });
  if (shownAs(before.avatarVisibility as typeof level) === shownAs(level)) {
    revalidatePath("/account");
    return { ok: true };
  }
  await recordProfileEvents({
    actorId: user.id,
    userId: user.id,
    changes: [
      {
        field: "picture",
        verb: "visibility",
        from: LEVEL_INFO[shownAs(before.avatarVisibility as typeof level)].label,
        to: LEVEL_INFO[shownAs(level)].label,
      },
    ],
  });

  revalidatePath("/account");
  return { ok: true };
}

/**
 * A new picture, asked for. Their direct supervisor approves it; somebody
 * with no direct supervisor to approve it has it approved by QuickTec, at
 * once. Where there is no picture, the request says why: before they were
 * hired, at hiring, or the one they had is gone.
 */
export async function uploadOwnPicture(formData: FormData): Promise<ProfileResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const file = formData.get("picture");
  if (!(file instanceof File)) return { ok: false, error: "Pick a photo first." };

  const subject = await loadProfile(user.id);
  if (!subject) return { ok: false, error: "Account not found." };

  // Sending a different picture for a first one asked for already keeps the
  // reason it was asked for with.
  const pendingPicture = await db.profileRequest.findFirst({
    where: { userId: user.id, field: "PICTURE", status: "PENDING" },
    select: { reason: true },
  });
  const reason = optionalText.parse(formData.get("reason")) ?? pendingPicture?.reason ?? null;
  if (!subject.avatarPath && !isPictureReason(reason)) {
    return { ok: false, error: `Say why: ${PICTURE_REASONS.join(", ")}.` };
  }

  const stored = await storeUploadedAvatar(user.id, file);
  if (!stored.ok) return stored;

  if (!actingSupervisor(subject)) {
    // Anything they were still waiting on is answered by this one: nobody is
    // left to approve it, and approving it later would put it over this.
    for (const waiting of await db.profileRequest.findMany({
      where: { userId: user.id, field: "PICTURE", status: "PENDING" },
      select: { id: true, picturePath: true },
    })) {
      const gone = await db.profileRequest.deleteMany({ where: { id: waiting.id, status: "PENDING" } });
      if (gone.count === 1 && waiting.picturePath) await deleteFile(waiting.picturePath);
    }
    const source = PICTURE_SOURCE.manual(user.name);
    try {
      await putUpPicture({
        userId: user.id,
        path: stored.path,
        source,
        addedById: user.id,
        approval: { bySystem: true },
      });
    } catch (error) {
      await deleteFile(stored.path);
      throw error;
    }
    await recordProfileEvents({
      actorId: user.id,
      userId: user.id,
      changes: [{ field: "picture", from: subject.avatarPath ? "Picture" : null, to: "Picture" }],
      approval: { bySystem: true },
      source,
      reason: subject.avatarPath ? null : reason,
    });
    revalidatePath("/account");
    return { ok: true, message: "Your picture is set." };
  }

  let sent: { reviewer: string | null };
  try {
    sent = await fileProfileRequest({
      subject: { id: subject.id, name: subject.name, directSupervisorId: subject.directSupervisorId },
      requesterId: user.id,
      field: "PICTURE",
      picturePath: stored.path,
      reason: subject.avatarPath ? null : reason,
    });
  } catch (error) {
    await deleteFile(stored.path);
    throw error;
  }

  revalidatePath("/account");
  return { ok: true, message: `Sent to ${sent.reviewer ?? "a manager"}. It shows once approved.` };
}

/** Takes their own picture down. It stays among their earlier pictures. */
export async function removeOwnPicture(): Promise<ProfileResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const taken = await db.user.updateMany({
    where: { id: user.id, avatarPath: { not: null } },
    data: { avatarPath: null },
  });
  if (taken.count === 0) return { ok: true };

  await recordProfileEvents({
    actorId: user.id,
    userId: user.id,
    changes: [{ field: "picture", from: "Picture", to: null }],
  });
  revalidatePath("/account");
  return { ok: true, message: "Your picture is taken down." };
}

/**
 * Puts back a picture they had before. It was approved once, so it needs no
 * approval again: the entry names whoever approved it then, and where it
 * came from.
 */
export async function restoreOwnPicture(pictureId: string): Promise<ProfileResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const picture = await db.profilePicture.findFirst({
    where: { id: pictureId, userId: user.id },
  });
  if (!picture) return { ok: false, error: "That picture is no longer kept." };
  // Taken down for a reason by a supervisor or manager: theirs to put back.
  if (picture.takenDownAt) {
    return { ok: false, error: "That picture was taken down by a supervisor; only they can put it back." };
  }

  const current = await db.user.findUniqueOrThrow({
    where: { id: user.id },
    select: { avatarPath: true },
  });
  if (current.avatarPath === picture.path) return { ok: true };

  // Only over the picture they were looking at: one approved a moment ago
  // is not quietly replaced.
  const swapped = await db.user.updateMany({
    where: { id: user.id, avatarPath: current.avatarPath },
    data: { avatarPath: picture.path, pictureSetAt: new Date() },
  });
  if (swapped.count === 0) return { ok: false, error: "Your picture changed meanwhile. Reload and try again." };
  await recordProfileEvents({
    actorId: user.id,
    userId: user.id,
    changes: [{ field: "picture", verb: "restored", from: null, to: "Picture" }],
    approval: approvalOf(picture, user.id),
    source: picture.source,
  });
  revalidatePath("/account");
  return { ok: true, message: "Your earlier picture is back." };
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
      changes: [{ field: "legalName", from: subject.legalName, to: value }],
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
