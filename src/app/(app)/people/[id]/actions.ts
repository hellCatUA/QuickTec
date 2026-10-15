"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { storeUploadedAvatar } from "@/lib/avatar";
import { db } from "@/lib/db";
import { optionalText, phoneText } from "@/lib/form";
import { capitaliseName, isFullName } from "@/lib/names";
import { notify } from "@/lib/notifications";
import { loadProfile, mayEditProfileOf, notTheirEmployee } from "@/lib/profile";
import { isoDate, monthYear, phoneText as phoneDisplay, stateText, statesText } from "@/lib/profile-format";
import { profileChanges, recordProfileEvents, type ProfileChange } from "@/lib/profile-history";
import { answerProfileRequest } from "@/lib/profile-requests";
import { getSessionUser } from "@/lib/session";
import { deleteFile } from "@/lib/storage";
import { US_STATES } from "@/lib/us-regions";

/**
 * Changing somebody else's profile.
 *
 * Their direct supervisor may, and so may whoever manages users. The legal
 * name, the years of service and the picture are the direct supervisor's in
 * particular: anybody else gets a warning first — answered by sending the
 * same form again with `confirmed` — and the supervisor is told it happened.
 */

export type ManagerResult =
  | { ok: true; message?: string }
  | { ok: false; error: string }
  | { ok: false; confirm: string };

const isState = (value: string | null) =>
  !value || US_STATES.some((entry) => entry.code === value);

const managerSchema = z.object({
  userId: z.string().min(1),
  legalName: optionalText,
  serviceStartDate: optionalText.refine(
    (value) => !value || /^\d{4}-\d{2}-\d{2}$/.test(value),
    "That is not a date.",
  ),
  workPhone: phoneText,
  voipPhone: phoneText,
  primaryRegion: optionalText.refine(isState, "That is not a state."),
  confirmed: optionalText,
});

function warning(subjectName: string, supervisorName: string | null, what: string): string {
  return `${subjectName} isn't your employee. ${supervisorName ?? "Their direct supervisor"} is their direct supervisor, and ${what} is theirs to change. If you go ahead, ${subjectName}'s history shows the change under your name with this warning, and ${supervisorName ?? "their supervisor"} is told.`;
}

async function tellSupervisor(input: {
  subject: { id: string; name: string; directSupervisorId: string | null };
  actor: { id: string; name: string };
  what: string;
}) {
  if (!input.subject.directSupervisorId) return;
  await notify({
    userId: input.subject.directSupervisorId,
    actorId: input.actor.id,
    kind: "profile_changed",
    title: `${input.actor.name} changed ${input.what} for ${input.subject.name}`,
    body: "They are your employee; this was changed past the warning that said so.",
    href: `/people/${input.subject.id}`,
  });
}

/** The fields a supervisor or manager keeps on somebody's profile. */
export async function saveProfileAsManager(formData: FormData): Promise<ManagerResult> {
  const actor = await getSessionUser();
  if (!actor) return { ok: false, error: "Not signed in." };

  const parsed = managerSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: z.prettifyError(parsed.error) };
  const data = parsed.data;

  const before = await loadProfile(data.userId);
  if (!before) return { ok: false, error: "That person does not exist." };
  if (!mayEditProfileOf(actor, before)) {
    return { ok: false, error: "You cannot change this person's profile." };
  }

  const legalName = data.legalName ? capitaliseName(data.legalName) : null;
  if (legalName && !isFullName(legalName)) {
    return { ok: false, error: "Write the legal name in full — first and last." };
  }
  const start = data.serviceStartDate ? new Date(`${data.serviceStartDate}T00:00:00Z`) : null;
  if (start && (Number.isNaN(start.getTime()) || start.getTime() > Date.now())) {
    return { ok: false, error: "The start date cannot be in the future." };
  }

  const states = Array.from(
    new Set(
      formData
        .getAll("statesOfOperation")
        .map((value) => String(value).trim().toUpperCase())
        .filter((value) => US_STATES.some((entry) => entry.code === value)),
    ),
  );

  // The direct supervisor's own fields, and whether this is somebody else
  // reaching into them.
  const sensitive: ProfileChange[] = profileChanges(
    { legalName: before.legalName, yearsOfService: isoDate(before.serviceStartDate) || null },
    { legalName, yearsOfService: data.serviceStartDate },
  );
  const warned = sensitive.length > 0 && notTheirEmployee(actor, before);
  if (warned && data.confirmed !== "1") {
    return {
      ok: false,
      confirm: warning(
        before.name,
        before.directSupervisor?.name ?? null,
        sensitive.length === 2
          ? "the legal name and the years of service"
          : sensitive[0].field === "legalName"
            ? "the legal name"
            : "the years of service",
      ),
    };
  }

  await db.user.update({
    where: { id: before.id },
    data: {
      legalName,
      serviceStartDate: start,
      workPhone: data.workPhone,
      voipPhone: data.voipPhone,
      primaryRegion: data.primaryRegion,
      statesOfOperation: states,
    },
  });

  // Stored the way it reads: a start date is "March 2019" in the history.
  const readable = (change: ProfileChange): ProfileChange =>
    change.field === "yearsOfService"
      ? {
          field: change.field,
          from: monthYear(before.serviceStartDate),
          to: monthYear(start),
        }
      : change;

  await recordProfileEvents({
    actorId: actor.id,
    userId: before.id,
    kind: "changed",
    changes: sensitive.map(readable),
    warned,
  });
  await recordProfileEvents({
    actorId: actor.id,
    userId: before.id,
    kind: "changed",
    changes: profileChanges(
      {
        workPhone: phoneDisplay(before.workPhone),
        voipPhone: phoneDisplay(before.voipPhone),
        primaryRegion: stateText(before.primaryRegion),
        statesOfOperation: statesText(before.statesOfOperation),
      },
      {
        workPhone: phoneDisplay(data.workPhone),
        voipPhone: phoneDisplay(data.voipPhone),
        primaryRegion: stateText(data.primaryRegion),
        statesOfOperation: statesText(states),
      },
    ),
  });

  if (warned) {
    await tellSupervisor({
      subject: before,
      actor,
      what: sensitive.map((change) => (change.field === "legalName" ? "the legal name" : "the years of service")).join(" and "),
    });
  }

  revalidatePath(`/people/${before.id}`);
  return { ok: true, message: "Saved." };
}

/** Sets somebody's picture outright — from their Photo ID at onboarding, or any time after. */
export async function setPictureAsManager(formData: FormData): Promise<ManagerResult> {
  const actor = await getSessionUser();
  if (!actor) return { ok: false, error: "Not signed in." };

  const userId = String(formData.get("userId") ?? "");
  const subject = await loadProfile(userId);
  if (!subject) return { ok: false, error: "That person does not exist." };
  if (!mayEditProfileOf(actor, subject)) {
    return { ok: false, error: "You cannot change this person's profile." };
  }

  const warned = notTheirEmployee(actor, subject);
  if (warned && formData.get("confirmed") !== "1") {
    return {
      ok: false,
      confirm: warning(subject.name, subject.directSupervisor?.name ?? null, "the profile picture"),
    };
  }

  const file = formData.get("picture");
  if (!(file instanceof File)) return { ok: false, error: "Pick a photo first." };
  const stored = await storeUploadedAvatar(subject.id, file);
  if (!stored.ok) return stored;

  await db.user.update({ where: { id: subject.id }, data: { avatarPath: stored.path } });
  if (subject.avatarPath) await deleteFile(subject.avatarPath);

  await recordProfileEvents({
    actorId: actor.id,
    userId: subject.id,
    kind: "changed",
    changes: [
      {
        field: "picture",
        from: subject.avatarPath ? "Previous picture" : null,
        to: formData.get("source") === "photo-id" ? "Picture from the Photo ID" : "New picture",
      },
    ],
    warned,
  });
  if (warned) await tellSupervisor({ subject, actor, what: "the profile picture" });

  revalidatePath(`/people/${subject.id}`);
  return { ok: true, message: "Picture set." };
}

/** Takes somebody's picture down. */
export async function removePictureAsManager(formData: FormData): Promise<ManagerResult> {
  const actor = await getSessionUser();
  if (!actor) return { ok: false, error: "Not signed in." };

  const subject = await loadProfile(String(formData.get("userId") ?? ""));
  if (!subject) return { ok: false, error: "That person does not exist." };
  if (!mayEditProfileOf(actor, subject)) {
    return { ok: false, error: "You cannot change this person's profile." };
  }
  if (!subject.avatarPath) return { ok: true };

  const warned = notTheirEmployee(actor, subject);
  if (warned && formData.get("confirmed") !== "1") {
    return {
      ok: false,
      confirm: warning(subject.name, subject.directSupervisor?.name ?? null, "the profile picture"),
    };
  }

  await db.user.update({ where: { id: subject.id }, data: { avatarPath: null } });
  await deleteFile(subject.avatarPath);
  await recordProfileEvents({
    actorId: actor.id,
    userId: subject.id,
    kind: "changed",
    changes: [{ field: "picture", from: "Previous picture", to: null }],
    warned,
  });
  if (warned) await tellSupervisor({ subject, actor, what: "the profile picture" });

  revalidatePath(`/people/${subject.id}`);
  return { ok: true, message: "Picture removed." };
}

/** Approves or turns down somebody's request for a new legal name or picture. */
export async function answerRequest(formData: FormData): Promise<ManagerResult> {
  const actor = await getSessionUser();
  if (!actor) return { ok: false, error: "Not signed in." };

  const requestId = String(formData.get("requestId") ?? "");
  const request = await db.profileRequest.findUnique({
    where: { id: requestId },
    select: { userId: true, field: true },
  });
  if (!request) return { ok: false, error: "That request has already been answered." };

  const subject = await loadProfile(request.userId);
  if (!subject) return { ok: false, error: "That person does not exist." };
  if (!mayEditProfileOf(actor, subject)) {
    return { ok: false, error: "You cannot answer this person's requests." };
  }

  const warned = notTheirEmployee(actor, subject);
  if (warned && formData.get("confirmed") !== "1") {
    return {
      ok: false,
      confirm: warning(
        subject.name,
        subject.directSupervisor?.name ?? null,
        request.field === "PICTURE" ? "the profile picture" : "the legal name",
      ),
    };
  }

  const note = optionalText.parse(formData.get("note"));
  const approve = formData.get("decision") === "approve";
  if (!approve && !note) {
    return { ok: false, error: "Say why, so they know what to do instead." };
  }

  const answered = await answerProfileRequest({
    requestId,
    reviewerId: actor.id,
    reviewerName: actor.name,
    approve,
    note,
    warned,
  });
  if (!answered.ok) return answered;

  revalidatePath(`/people/${subject.id}`);
  revalidatePath("/approvals");
  return { ok: true, message: approve ? "Approved." : "Turned down." };
}
