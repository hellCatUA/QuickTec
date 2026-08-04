import { db } from "@/lib/db";
import { loadJobForExport } from "@/lib/exports/job-data";
import { formSource, STATIC_SOURCE } from "@/lib/forms/catalogue";
import type { FillablePlacement } from "@/lib/forms/fill";
import { valueFor } from "@/lib/forms/fill";

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

export type DraftBox = {
  placementId: string;
  /** The blank's own name for it, where it had one. */
  fieldName: string | null;
  /** What the blank was carrying there, which usually says what it is for. */
  sampleText: string | null;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  kind: "TEXT" | "CHECK" | "SIGNATURE";
  /** The catalogue entry this box is bound to, if any. */
  source: string | null;
  sourceLabel: string | null;
  /** What that entry resolves to for this job. Null when it has nothing. */
  resolved: string | null;
  /** Whether the resolved value is an image rather than text. */
  isImage: boolean;
  /** What somebody typed. Null when they have not touched it. */
  entered: string | null;
  /** Which row of a repeating source this box wants. */
  rowIndex: number | null;
};

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
        select: { placementId: true, value: true },
      })
    ).map((entry) => [entry.placementId, entry.value]),
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

    return {
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
      entered: entries.get(placement.id) ?? null,
      rowIndex: placement.rowIndex,
    };
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
