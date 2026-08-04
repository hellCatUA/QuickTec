import { db } from "@/lib/db";
import { loadJobForExport } from "@/lib/exports/job-data";
import { formSource, STATIC_SOURCE } from "@/lib/forms/catalogue";
import type { FillablePlacement } from "@/lib/forms/fill";
import { valueFor } from "@/lib/forms/fill";
import { boxFingerprint, type DraftBox } from "@/lib/forms/box";

export { boxFingerprint };
export type { DraftBox };

/**
 * A company's sheet for one job, as it stands before anybody signs anything.
 *
 * The mapping fills what the app knows, which on a real sheet is most of it
 * but never all of it. A travel time, a tick against "site not ready", a phone
 * number we do not hold — those are somebody's judgement, and the alternative
 * to typing them here is printing the sheet and writing on it.
 *
 * So filling produces this rather than a finished document: every box, what
 * the app put in it, and what a person typed instead. Nothing is attached to
 * the job until they say so.
 */

export type Draft = {
  jobId: string;
  templateId: string;
  templateLabel: string;
  attachmentId: string;
  fileAttachmentId: string;
  pageCount: number;
  pageWidth: number;
  pageHeight: number;
  boxes: DraftBox[];
};

/**
 * What actually goes in a box: what somebody typed, else what the app worked
 * out. One rule, used by the screen and by the filler, so what is reviewed is
 * what gets attached.
 */
export function effectivePlacements(boxes: DraftBox[]): FillablePlacement[] {
  return boxes.map((box) => {
    const typed = box.entered?.trim();

    // A person's entry beats the mapping. It also beats it when it is empty:
    // clearing a box is a decision, and a value that came back after being
    // deleted is worse than one that was never there.
    if (box.entered !== null && !box.isImage) {
      return {
        fieldName: box.fieldName,
        page: box.page,
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        kind: box.kind,
        source: typed ? STATIC_SOURCE : null,
        staticText: typed ?? null,
        rowIndex: null,
        fontSize: null,
      };
    }

    return {
      fieldName: box.fieldName,
      page: box.page,
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      kind: box.kind,
      source: box.source,
      staticText: null,
      rowIndex: box.rowIndex,
      fontSize: null,
    };
  });
}

export async function loadDraft(
  jobId: string,
  templateId: string,
): Promise<Draft | null> {
  const blank = await db.attachment.findFirst({
    where: {
      jobDocumentId: jobId,
      sourceTemplateId: templateId,
      generated: false,
    },
    select: {
      id: true,
      sourceTemplate: {
        select: {
          id: true,
          label: true,
          pageCount: true,
          pageWidth: true,
          pageHeight: true,
          placements: {
            orderBy: [{ page: "asc" }, { order: "asc" }],
            select: {
              id: true,
              fieldName: true,
              sampleText: true,
              page: true,
              x: true,
              y: true,
              width: true,
              height: true,
              kind: true,
              source: true,
              rowIndex: true,
            },
          },
        },
      },
    },
  });

  if (!blank?.sourceTemplate) return null;
  const template = blank.sourceTemplate;

  const data = await loadJobForExport(jobId);
  if (!data) return null;

  const entries = new Map(
    (
      await db.jobFormEntry.findMany({
        where: { jobId },
        select: { placementId: true, value: true, approvedValue: true },
      })
    ).map((entry) => [entry.placementId, entry]),
  );

  const context = { data, now: new Date() };

  const boxes: DraftBox[] = template.placements.map((placement) => {
    const source = placement.source ? formSource(placement.source) : null;
    const value = valueFor(
      {
        fieldName: placement.fieldName,
        page: placement.page,
        x: placement.x,
        y: placement.y,
        width: placement.width,
        height: placement.height,
        kind: placement.kind,
        source: placement.source,
        staticText: null,
        rowIndex: placement.rowIndex,
        fontSize: null,
      },
      context,
    );

    const entry = entries.get(placement.id);
    const box: DraftBox = {
      placementId: placement.id,
      fieldName: placement.fieldName,
      sampleText: placement.sampleText,
      page: placement.page,
      x: placement.x,
      y: placement.y,
      width: placement.width,
      height: placement.height,
      kind: placement.kind,
      source: placement.source,
      sourceLabel: source?.label ?? null,
      resolved: value && "text" in value ? value.text : null,
      isImage: Boolean(source?.resolveImage),
      hasImage: Boolean(value && "image" in value),
      entered: entry?.value ?? null,
      approved: false,
      rowIndex: placement.rowIndex,
    };

    box.approved =
      entry?.approvedValue !== null &&
      entry?.approvedValue !== undefined &&
      entry.approvedValue === boxFingerprint(box);

    return box;
  });

  return {
    jobId,
    templateId: template.id,
    templateLabel: template.label,
    attachmentId: blank.id,
    fileAttachmentId: blank.id,
    pageCount: template.pageCount ?? 1,
    pageWidth: template.pageWidth ?? 612,
    pageHeight: template.pageHeight ?? 792,
    boxes,
  };
}
