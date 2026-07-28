"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { recordAudit } from "@/lib/audit";
import { getCompanySettings } from "@/lib/company";
import { db } from "@/lib/db";
import { processImage } from "@/lib/images";
import { MILEAGE_META, mileageAmount, milesBetween } from "@/lib/mileage";
import { getSessionUser, permissionScope } from "@/lib/session";
import { deleteFile, storeFile } from "@/lib/storage";
import { MileageCategory } from "@prisma-client";

export type ActionResult = { ok: true; id?: string } | { ok: false; error: string };

const fail = (error: string): ActionResult => ({ ok: false, error });

const odometer = z
  .string()
  .trim()
  .refine((value) => Number.isFinite(Number(value)) && Number(value) >= 0, {
    message: "Enter an odometer reading",
  });

const schema = z.object({
  category: z.enum(MileageCategory),
  jobId: z.string().optional(),
  startOdometer: odometer,
  endOdometer: odometer,
  startedAt: z.string().trim().min(1, "When did you set off?"),
  endedAt: z.string().trim().min(1, "When did you arrive?"),
  note: z.string().trim().max(500).optional(),
});

export async function saveMileage(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return fail("Not signed in.");
  if (!permissionScope(user, "mileage.submit")) {
    return fail("You cannot log mileage.");
  }

  const parsed = schema.safeParse({
    category: formData.get("category"),
    jobId: formData.get("jobId") ?? undefined,
    startOdometer: formData.get("startOdometer") ?? "",
    endOdometer: formData.get("endOdometer") ?? "",
    startedAt: formData.get("startedAt") ?? "",
    endedAt: formData.get("endedAt") ?? "",
    note: formData.get("note") ?? undefined,
  });
  if (!parsed.success) return fail(z.prettifyError(parsed.error));

  const { category, startOdometer, endOdometer, note } = parsed.data;
  const meta = MILEAGE_META[category];

  const start = Number(startOdometer);
  const end = Number(endOdometer);
  if (end <= start) {
    return fail("The end reading has to be higher than the start.");
  }

  if (meta.requiresNote && !note) {
    return fail("Say what this trip was for.");
  }

  // Whether the tech was on the clock decides which categories are legitimate,
  // and the form is not the place to settle that.
  const openVisit = await db.visit.findFirst({
    where: { assignment: { userId: user.id }, clockOutAt: null },
    select: { id: true, assignment: { select: { jobId: true } } },
  });
  const clockedIn = Boolean(openVisit);

  if (meta.requiresClockedIn === true && !clockedIn) {
    return fail("That category is only available while you are clocked in.");
  }
  if (meta.requiresClockedIn === false && clockedIn) {
    return fail(
      "You are clocked in — use the on-clock supply run category instead.",
    );
  }

  let jobId = parsed.data.jobId || null;
  if (meta.requiresJob) {
    jobId = jobId ?? openVisit?.assignment.jobId ?? null;
    if (!jobId) return fail("Pick the job you were driving to.");
  }

  // Both photos are the evidence: a number typed into a box is not a
  // write-off record anyone would want to defend.
  const startPhoto = formData.get("startPhoto");
  const endPhoto = formData.get("endPhoto");
  if (!(startPhoto instanceof File) || startPhoto.size === 0) {
    return fail("A photo of the starting odometer is required.");
  }
  if (!(endPhoto instanceof File) || endPhoto.size === 0) {
    return fail("A photo of the ending odometer is required.");
  }

  const job = jobId
    ? await db.job.findUnique({
        where: { id: jobId },
        select: { externalAssignmentId: true, intWoId: true },
      })
    : null;

  const company = await getCompanySettings();
  const miles = milesBetween(start, end);

  async function store(file: File) {
    const processed = await processImage(
      Buffer.from(await file.arrayBuffer()),
      file.type,
      null,
    );
    const stored = await storeFile(
      jobId ?? `mileage-${user!.id}`,
      processed.data,
      processed.mimeType,
    );
    return db.attachment.create({
      data: {
        storagePath: stored.storagePath,
        originalName: file.name || "odometer.jpg",
        mimeType: processed.mimeType,
        sizeBytes: stored.sizeBytes,
        width: processed.width,
        height: processed.height,
        capturedAt: processed.capturedAt,
        gpsLat: processed.gpsLat,
        gpsLng: processed.gpsLng,
        uploadedById: user!.id,
      },
      select: { id: true },
    });
  }

  let startAttachment;
  let endAttachment;
  try {
    startAttachment = await store(startPhoto);
    endAttachment = await store(endPhoto);
  } catch {
    return fail("Those photos could not be read. Try taking them again.");
  }

  const entry = await db.mileageEntry.create({
    data: {
      userId: user.id,
      category,
      jobId,
      // Denormalised so the entry still reads correctly if the job's ID is
      // later corrected, and so exports need no join.
      reference: job?.externalAssignmentId ?? job?.intWoId ?? null,
      startOdometer: startOdometer,
      endOdometer: endOdometer,
      miles: miles.toFixed(1),
      // Snapshotted: a later change to the company rate must not silently
      // rewrite what last quarter's trips were worth.
      rate: company.mileageRate.toString(),
      amount: mileageAmount(miles, company.mileageRate.toString()),
      startedAt: new Date(parsed.data.startedAt),
      endedAt: new Date(parsed.data.endedAt),
      note: note || null,
      startPhotoId: startAttachment.id,
      endPhotoId: endAttachment.id,
    },
    select: { id: true },
  });

  await recordAudit({
    actorId: user.id,
    entityType: "MileageEntry",
    entityId: entry.id,
    jobId,
    action: "mileage_logged",
    detail: { category, miles, reference: job?.externalAssignmentId ?? null },
  });

  revalidatePath("/mileage");
  return { ok: true, id: entry.id };
}

export async function deleteMileage(formData: FormData): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return fail("Not signed in.");

  const id = String(formData.get("id") ?? "");
  const entry = await db.mileageEntry.findUnique({
    where: { id },
    select: {
      userId: true,
      startPhoto: { select: { id: true, storagePath: true } },
      endPhoto: { select: { id: true, storagePath: true } },
    },
  });
  if (!entry) return fail("Trip not found.");

  // Mileage belongs to the person who drove it; nobody edits someone else's.
  if (entry.userId !== user.id) {
    return fail("You can only remove your own trips.");
  }

  for (const photo of [entry.startPhoto, entry.endPhoto]) {
    if (!photo) continue;
    await deleteFile(photo.storagePath);
  }

  await db.mileageEntry.delete({ where: { id } });

  await recordAudit({
    actorId: user.id,
    entityType: "MileageEntry",
    entityId: id,
    action: "mileage_removed",
  });

  revalidatePath("/mileage");
  return { ok: true };
}
