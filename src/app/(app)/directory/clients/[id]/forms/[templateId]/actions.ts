"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { recordAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { analyzeForm, liftBoxes } from "@/lib/forms/analyze";
import { formSource, STATIC_SOURCE } from "@/lib/forms/catalogue";
import { storeDocument } from "@/lib/job-documents";
import { requirePermission } from "@/lib/session";
import { deleteFile } from "@/lib/storage";

export type ActionResult = { ok: true } | { ok: false; error: string };

/** A box as the editor holds it. */
export type PlacementDto = {
  id: string;
  fieldName: string | null;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  kind: "TEXT" | "CHECK" | "SIGNATURE";
  source: string | null;
  staticText: string | null;
  rowIndex: number | null;
  fontSize: number | null;
  sampleText: string | null;
};

/**
 * Boxes come back from the actions that create them rather than only through
 * a revalidate. The editor holds a mapping somebody is part way through, and
 * re-reading the page underneath them would throw away everything they had
 * not saved yet — adding one box is not a reason to lose the other twenty.
 */
export type BoxResult =
  | { ok: true; placements: PlacementDto[] }
  | { ok: false; error: string };

const PLACEMENT_FIELDS = {
  id: true,
  fieldName: true,
  page: true,
  x: true,
  y: true,
  width: true,
  height: true,
  kind: true,
  source: true,
  staticText: true,
  rowIndex: true,
  fontSize: true,
  sampleText: true,
} as const;

/**
 * Setting up which box on a blank takes which fact about the job.
 *
 * Done once per company form and then never again, which is the whole point:
 * the alternative is somebody typing the same twenty values into the same
 * twenty boxes on every job, on a phone, on site.
 */

const placementSchema = z.object({
  id: z.string().min(1),
  source: z.string().nullable(),
  staticText: z.string().nullable(),
  rowIndex: z.number().int().min(0).max(50).nullable(),
  fontSize: z.number().min(4).max(72).nullable(),
  kind: z.enum(["TEXT", "CHECK", "SIGNATURE"]),
  page: z.number().int().min(0),
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
});

const saveSchema = z.object({
  templateId: z.string().min(1),
  placements: z.array(placementSchema),
});

async function loadTemplate(templateId: string) {
  return db.clientDocumentTemplate.findUnique({
    where: { id: templateId },
    select: {
      id: true,
      label: true,
      clientId: true,
      pageWidth: true,
      pageHeight: true,
      attachment: { select: { id: true, storagePath: true, mimeType: true } },
    },
  });
}

/** Rejects a mapping that would put the wrong thing on a customer's form. */
function validate(
  placements: z.infer<typeof placementSchema>[],
): string | null {
  for (const placement of placements) {
    if (!placement.source) continue;

    if (placement.source === STATIC_SOURCE) {
      if (!placement.staticText?.trim()) {
        return "A box set to fixed text needs the text to put in it.";
      }
      continue;
    }

    const source = formSource(placement.source);
    if (!source) {
      return "One of the boxes is bound to something this version does not know about.";
    }

    // A signature box that resolves to text would draw the file path.
    if (source.resolveImage && placement.kind !== "SIGNATURE") {
      return `"${source.label}" is a signature — set that box to Signature.`;
    }
    if (!source.resolveImage && placement.kind === "SIGNATURE") {
      return `"${source.label}" is not a signature. Set the box to Text or Tick.`;
    }
  }
  return null;
}

export async function saveFormMapping(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requirePermission("client.manage");

  let input: z.infer<typeof saveSchema>;
  try {
    input = saveSchema.parse(JSON.parse(String(formData.get("payload") ?? "")));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { ok: false, error: z.prettifyError(error) };
    }
    return { ok: false, error: "That mapping could not be read." };
  }

  const template = await loadTemplate(input.templateId);
  if (!template) return { ok: false, error: "Form not found." };

  const problem = validate(input.placements);
  if (problem) return { ok: false, error: problem };

  // Only rows that belong to this template, so a stale tab cannot rewrite
  // another company's form.
  const owned = new Set(
    (
      await db.formPlacement.findMany({
        where: { templateId: template.id },
        select: { id: true },
      })
    ).map((row) => row.id),
  );

  await db.$transaction(
    input.placements
      .filter((placement) => owned.has(placement.id))
      .map((placement) =>
        db.formPlacement.update({
          where: { id: placement.id },
          data: {
            source: placement.source,
            staticText:
              placement.source === STATIC_SOURCE ? placement.staticText : null,
            rowIndex: placement.rowIndex,
            fontSize: placement.fontSize,
            kind: placement.kind,
            page: placement.page,
            x: placement.x,
            y: placement.y,
            width: placement.width,
            height: placement.height,
          },
        }),
      ),
  );

  const mapped = input.placements.filter((placement) => placement.source).length;
  await recordAudit({
    actorId: actor.id,
    entityType: "ClientDocumentTemplate",
    entityId: template.id,
    action: "updated",
    detail: { field: "field mapping", to: `${mapped} of ${input.placements.length} boxes` },
  });

  revalidatePath(`/directory/clients/${template.clientId}/forms/${template.id}`);
  revalidatePath("/directory/clients");
  return { ok: true };
}

const boxSchema = z.object({
  templateId: z.string().min(1),
  page: z.number().int().min(0),
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
});

/** Adds one box to a flat blank, where the file gave us nothing to start from. */
export async function addFormBox(formData: FormData): Promise<BoxResult> {
  await requirePermission("client.manage");

  let input: z.infer<typeof boxSchema>;
  try {
    input = boxSchema.parse(JSON.parse(String(formData.get("payload") ?? "")));
  } catch {
    return { ok: false, error: "That box could not be read." };
  }

  const template = await loadTemplate(input.templateId);
  if (!template) return { ok: false, error: "Form not found." };

  const last = await db.formPlacement.findFirst({
    where: { templateId: template.id },
    orderBy: { order: "desc" },
    select: { order: true },
  });

  const created = await db.formPlacement.create({
    data: {
      templateId: template.id,
      page: input.page,
      x: input.x,
      y: input.y,
      width: input.width,
      height: input.height,
      kind: "TEXT",
      order: (last?.order ?? -1) + 1,
    },
    select: PLACEMENT_FIELDS,
  });

  revalidatePath(`/directory/clients/${template.clientId}/forms/${template.id}`);
  return { ok: true, placements: [created] };
}

export async function deleteFormBox(formData: FormData): Promise<ActionResult> {
  await requirePermission("client.manage");
  const id = String(formData.get("id") ?? "");

  const placement = await db.formPlacement.findUnique({
    where: { id },
    select: { template: { select: { id: true, clientId: true } } },
  });
  if (!placement) return { ok: false, error: "Not found." };

  await db.formPlacement.delete({ where: { id } });

  revalidatePath(
    `/directory/clients/${placement.template.clientId}/forms/${placement.template.id}`,
  );
  return { ok: true };
}

/**
 * Takes the boxes off a copy somebody already filled in by hand.
 *
 * A phone annotator leaves its text behind as annotations with real
 * rectangles, so a sheet from a finished job is a map of the form drawn by the
 * person who knows it. On a flat blank the alternative is placing twenty boxes
 * from memory, so this is usually the difference between the feature getting
 * set up and not.
 *
 * The text that was in each box is kept as its hint — it says what the box is
 * for far better than a position does.
 */
export async function importBoxesFromFilled(
  _prev: BoxResult | null,
  formData: FormData,
): Promise<BoxResult> {
  const actor = await requirePermission("client.manage");
  const templateId = String(formData.get("templateId") ?? "");

  const template = await loadTemplate(templateId);
  if (!template) return { ok: false, error: "Form not found." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose a filled copy first." };
  }
  if (file.type !== "application/pdf") {
    return { ok: false, error: "That has to be a PDF." };
  }

  const bytes = Buffer.from(await file.arrayBuffer());

  let boxes;
  try {
    boxes = await liftBoxes(bytes);
  } catch (error) {
    console.error("[directory] lifting boxes from a filled copy failed", error);
    return { ok: false, error: "That PDF could not be read." };
  }

  if (boxes.length === 0) {
    return {
      ok: false,
      error:
        "No text boxes in that PDF. It has to be a copy filled in with an " +
        "annotation app — a scan or a photo of a filled sheet has nothing to read.",
    };
  }

  const last = await db.formPlacement.findFirst({
    where: { templateId: template.id },
    orderBy: { order: "desc" },
    select: { order: true },
  });
  let order = (last?.order ?? -1) + 1;

  const created = await db.formPlacement.createManyAndReturn({
    data: boxes.map((box) => ({
      templateId: template.id,
      page: box.page,
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      kind: "TEXT" as const,
      // Deliberately unmapped: where a box goes came from the filled copy,
      // what goes in it is a decision somebody still has to make.
      source: null,
      sampleText: box.text.slice(0, 400),
      order: order++,
    })),
    select: PLACEMENT_FIELDS,
  });

  await recordAudit({
    actorId: actor.id,
    entityType: "ClientDocumentTemplate",
    entityId: template.id,
    action: "updated",
    detail: { field: "boxes", to: `${boxes.length} imported from a filled copy` },
  });

  revalidatePath(`/directory/clients/${template.clientId}/forms/${template.id}`);
  return { ok: true, placements: created };
}

/**
 * Puts a new blank behind an existing mapping.
 *
 * The dangerous case the whole app has to protect against: a company sends a
 * revised sheet, somebody swaps the file, and every box now sits over the
 * wrong line. So the mapping is only carried across when the new file's own
 * fields match by name — otherwise the boxes are re-read from the new file and
 * have to be pointed at their sources again, loudly, before anything is filled.
 */
export async function replaceBlank(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requirePermission("client.manage");
  const templateId = String(formData.get("templateId") ?? "");

  const template = await loadTemplate(templateId);
  if (!template) return { ok: false, error: "Form not found." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose the new blank first." };
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  let analysis;
  try {
    analysis = file.type === "application/pdf" ? await analyzeForm(bytes) : null;
  } catch {
    analysis = null;
  }

  const existing = await db.formPlacement.findMany({
    where: { templateId: template.id },
    select: { fieldName: true, source: true, staticText: true, rowIndex: true, kind: true, fontSize: true },
  });

  // A mapping only survives if every mapped box names a field the new file
  // still has. Anything less and the safe answer is to start again.
  const carried = new Map(
    existing
      .filter((placement) => placement.fieldName && placement.source)
      .map((placement) => [placement.fieldName!, placement]),
  );
  const newFieldNames = new Set(
    (analysis?.placements ?? [])
      .map((placement) => placement.fieldName)
      .filter((name): name is string => Boolean(name)),
  );
  const keepsMapping =
    carried.size > 0 &&
    [...carried.keys()].every((name) => newFieldNames.has(name));

  const stored = await storeDocument(file, actor.id, `templates/${template.clientId}`);
  if ("error" in stored) return { ok: false, error: stored.error };

  const previous = template.attachment;

  try {
    await db.$transaction(async (tx) => {
      await tx.formPlacement.deleteMany({ where: { templateId: template.id } });
      await tx.clientDocumentTemplate.update({
        where: { id: template.id },
        data: {
          attachmentId: stored.id,
          boxSource: analysis?.boxSource ?? null,
          pageCount: analysis?.pageCount ?? null,
          pageWidth: analysis?.pageWidth ?? null,
          pageHeight: analysis?.pageHeight ?? null,
          placements: analysis
            ? {
                create: analysis.placements.map((placement) => {
                  const kept =
                    keepsMapping && placement.fieldName
                      ? carried.get(placement.fieldName)
                      : undefined;
                  return {
                    fieldName: placement.fieldName,
                    page: placement.page,
                    x: placement.x,
                    y: placement.y,
                    width: placement.width,
                    height: placement.height,
                    kind: kept?.kind ?? placement.kind,
                    sampleText: placement.sampleText,
                    order: placement.order,
                    source: kept?.source ?? null,
                    staticText: kept?.staticText ?? null,
                    rowIndex: kept?.rowIndex ?? null,
                    fontSize: kept?.fontSize ?? null,
                  };
                }),
              }
            : undefined,
        },
      });
    });
  } catch (error) {
    console.error("[directory] replacing a blank failed", error);
    return { ok: false, error: "That blank could not be saved." };
  }

  // The old file only goes once the new one is the one of record.
  await deleteFile(previous.storagePath);
  await db.attachment.delete({ where: { id: previous.id } }).catch(() => {});

  await recordAudit({
    actorId: actor.id,
    entityType: "ClientDocumentTemplate",
    entityId: template.id,
    action: "updated",
    detail: {
      field: "blank",
      to: keepsMapping
        ? "replaced, mapping carried across"
        : "replaced, mapping cleared",
    },
  });

  revalidatePath(`/directory/clients/${template.clientId}/forms/${template.id}`);
  revalidatePath("/directory/clients");
  return keepsMapping
    ? { ok: true }
    : {
        ok: false,
        error:
          "The new blank is saved, but its boxes do not line up with the old " +
          "mapping — every box needs pointing at its value again before this " +
          "form can be filled.",
      };
}

