import type { ProfileRequestField } from "@prisma-client";
import { db } from "@/lib/db";
import { notify } from "@/lib/notifications";
import { recordProfileEvents } from "@/lib/profile-history";
import type { ProfileField } from "@/lib/profile-privacy";
import { deleteFile } from "@/lib/storage";

/**
 * Asking for a change to your own legal name or picture, and answering.
 *
 * Both are set once — at onboarding, or from NextCloud — and after that are
 * the direct supervisor's: a legal name is what payroll pays and what gets
 * signed, and a picture is how a client knows who is at their door. So the
 * person asks, and their supervisor (or, past a warning, another manager)
 * answers.
 */

export const REQUEST_FIELD: Record<ProfileRequestField, ProfileField> = {
  LEGAL_NAME: "legalName",
  PICTURE: "picture",
};

const WHAT: Record<ProfileRequestField, string> = {
  LEGAL_NAME: "a new legal name",
  PICTURE: "a new profile picture",
};

/**
 * Who hears that somebody asked: their direct supervisor, or — when they have
 * none, which payroll will be complaining about separately — the managers, so
 * the request does not wait on nobody.
 */
async function reviewersOf(subject: { directSupervisorId: string | null }): Promise<string[]> {
  if (subject.directSupervisorId) return [subject.directSupervisorId];
  const managers = await db.user.findMany({
    where: { active: true, baseRole: { in: ["MANAGER", "ADMINISTRATOR"] } },
    select: { id: true },
  });
  return managers.map((manager) => manager.id);
}

/**
 * Files a request, replacing whatever the same person was already waiting on
 * for the same field: the newest ask is the one that stands.
 */
export async function fileProfileRequest(input: {
  subject: { id: string; name: string; directSupervisorId: string | null };
  requesterId: string;
  field: ProfileRequestField;
  value?: string | null;
  picturePath?: string | null;
}): Promise<{ id: string }> {
  const superseded = await db.profileRequest.findMany({
    where: { userId: input.subject.id, field: input.field, status: "PENDING" },
    select: { id: true, picturePath: true },
  });
  // One by one and only while still pending: a supervisor approving the old
  // one at this very moment has just made its picture the one in use, and
  // deleting the file underneath them would leave nobody with a picture.
  for (const row of superseded) {
    const gone = await db.profileRequest.deleteMany({
      where: { id: row.id, status: "PENDING" },
    });
    if (gone.count === 1 && row.picturePath) await deleteFile(row.picturePath);
  }

  const created = await db.profileRequest.create({
    data: {
      userId: input.subject.id,
      field: input.field,
      value: input.value ?? null,
      picturePath: input.picturePath ?? null,
      requestedById: input.requesterId,
    },
    select: { id: true },
  });

  await recordProfileEvents({
    actorId: input.requesterId,
    userId: input.subject.id,
    kind: "requested",
    changes: [
      {
        field: REQUEST_FIELD[input.field],
        from: null,
        to: input.field === "PICTURE" ? "New picture" : (input.value ?? null),
      },
    ],
  });

  for (const reviewerId of await reviewersOf(input.subject)) {
    await notify({
      userId: reviewerId,
      actorId: input.requesterId,
      kind: "profile_request",
      title: `${input.subject.name} asked for ${WHAT[input.field]}`,
      body:
        input.field === "LEGAL_NAME" && input.value
          ? `New legal name: ${input.value}`
          : null,
      href: `/people/${input.subject.id}`,
    });
  }

  return created;
}

/** Takes back a request that has not been answered. */
export async function withdrawProfileRequest(input: {
  requestId: string;
  userId: string;
  actorId: string;
}): Promise<boolean> {
  const request = await db.profileRequest.findFirst({
    where: { id: input.requestId, userId: input.userId, status: "PENDING" },
    select: { id: true, field: true, picturePath: true },
  });
  if (!request) return false;

  // Only while still pending, for the same reason as above: an answer that
  // got there first has already decided what happens to the file.
  const gone = await db.profileRequest.deleteMany({
    where: { id: request.id, status: "PENDING" },
  });
  if (gone.count === 0) return false;
  if (request.picturePath) await deleteFile(request.picturePath);

  await recordProfileEvents({
    actorId: input.actorId,
    userId: input.userId,
    kind: "withdrawn",
    changes: [{ field: REQUEST_FIELD[request.field], from: null, to: null }],
  });
  return true;
}

/**
 * Answers a request. Approving puts the change in place; either answer goes
 * back to whoever asked. A manager who is not the person's direct supervisor
 * answers only past a warning, and the supervisor is told they did.
 */
export async function answerProfileRequest(input: {
  requestId: string;
  reviewerId: string;
  reviewerName: string;
  approve: boolean;
  note: string | null;
  warned: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const request = await db.profileRequest.findUnique({
    where: { id: input.requestId },
    select: {
      id: true,
      field: true,
      value: true,
      picturePath: true,
      status: true,
      requestedById: true,
      user: {
        select: {
          id: true,
          name: true,
          legalName: true,
          avatarPath: true,
          directSupervisorId: true,
        },
      },
    },
  });
  if (!request || request.status !== "PENDING") {
    return { ok: false, error: "That request has already been answered." };
  }
  const subject = request.user;

  // Claimed before anything moves, so two people answering at once cannot
  // both apply it.
  const claimed = await db.profileRequest.updateMany({
    where: { id: request.id, status: "PENDING" },
    data: {
      status: input.approve ? "APPROVED" : "REJECTED",
      reviewedById: input.reviewerId,
      reviewedAt: new Date(),
      reviewNote: input.note,
    },
  });
  if (claimed.count === 0) {
    return { ok: false, error: "That request has already been answered." };
  }

  let from: string | null = null;
  let to: string | null = null;

  if (request.field === "LEGAL_NAME") {
    from = subject.legalName;
    to = request.value;
    if (input.approve) {
      await db.user.update({
        where: { id: subject.id },
        data: { legalName: request.value },
      });
    }
  } else {
    from = subject.avatarPath ? "Previous picture" : null;
    to = "New picture";
    if (input.approve && request.picturePath) {
      await db.user.update({
        where: { id: subject.id },
        data: { avatarPath: request.picturePath },
      });
      if (subject.avatarPath) await deleteFile(subject.avatarPath);
    } else if (request.picturePath) {
      await deleteFile(request.picturePath);
    }
    // The file is either the picture now or gone; the row no longer owns it.
    await db.profileRequest.update({
      where: { id: request.id },
      data: { picturePath: null },
    });
  }

  await recordProfileEvents({
    actorId: input.reviewerId,
    userId: subject.id,
    kind: input.approve ? "approved" : "denied",
    changes: [{ field: REQUEST_FIELD[request.field], from, to }],
    note: input.note,
    warned: input.warned,
  });

  await notify({
    userId: request.requestedById,
    actorId: input.reviewerId,
    kind: "profile_request_answered",
    title: input.approve
      ? `${input.reviewerName} approved ${WHAT[request.field]}`
      : `${input.reviewerName} turned down ${WHAT[request.field]}`,
    body: input.note,
    href: "/account",
  });

  if (input.warned && subject.directSupervisorId) {
    await notify({
      userId: subject.directSupervisorId,
      actorId: input.reviewerId,
      kind: "profile_changed",
      title: `${input.reviewerName} ${input.approve ? "approved" : "turned down"} ${WHAT[request.field]} for ${subject.name}`,
      body: "They are your employee; this was answered past the warning that said so.",
      href: `/people/${subject.id}`,
    });
  }

  return { ok: true };
}
