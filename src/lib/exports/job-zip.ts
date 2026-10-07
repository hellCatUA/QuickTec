import { ZipArchive, type ArchiverError } from "archiver";
import { usDateTimeInZone } from "@/lib/datetime";
import { exportStem, type JobExportData } from "@/lib/exports/job-data";
import {
  extensionFor,
  planDeliverableExport,
  safeSegment,
  uniqueSegment,
} from "@/lib/exports/photo-layout";
import { buildTextReport } from "@/lib/exports/text-report";
import { buildWorkOrderPdf } from "@/lib/exports/work-order-pdf";
import { absolutePath, fileExists } from "@/lib/storage";

/**
 * The archive handed to the client.
 *
 *   Pre-Install/MDF/001.jpg
 *   Pre-Install/IDF/001.jpg
 *   Post Install/001.jpg
 *   Return Labels/notes.txt
 *   Photo index.csv
 *   Signatures/MOD-Dana Reyes-Signature.png
 *   Receipts/…
 *   <Company> INT WO/2607-PRJ12-0001.pdf
 *   <Client> WO/<their work order, as attached>
 *   Sign-off sheets/<the blank>.pdf, <the blank> — filled.pdf
 *   887766-Report.txt
 *
 * Photos sit under their field and then their location, numbered in the
 * order they reached the job — see planDeliverableExport. Who took each one,
 * when, and what the phone called it is in the photo index. The archive is
 * streamed rather than assembled in memory: thirty photos at 2400px is
 * comfortably more than a Node buffer should be holding while a phone
 * downloads it over the VPN.
 */

const safeName = safeSegment;

/**
 * One CSV cell, quoted when it has to be — and kept as text when a
 * spreadsheet would take it for a formula: a label like "-48V feed" is a
 * #NAME? in Excel otherwise, and one starting "=" would run.
 */
function csvCell(raw: string): string {
  const value = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function zipFileName(data: JobExportData): string {
  return `${exportStem(data)}.zip`;
}

export function reportFileName(data: JobExportData): string {
  return `${data.job.externalAssignmentId || data.job.intWoId}-Report.txt`;
}

export async function buildJobZip(data: JobExportData) {
  const { job, company } = data;

  // archiver 8 is ESM and exports the archive classes rather than the old
  // factory function.
  const archive = new ZipArchive({ zlib: { level: 6 } });

  /**
   * What the job holds that the archive could not.
   *
   * A file that is on the record but not on disk used to be skipped in
   * silence, which is the worst of the options: the download succeeds, it is
   * short, and nobody can tell a section nobody photographed from a photo that
   * has gone missing. Now it is skipped and said out loud.
   */
  const missing: string[] = [];

  // Archiver raises this from its queue worker, which drains after this
  // function has already written the manifest below — so there is no putting
  // it in there. Logged instead, and loudly: the pre-checks further down
  // catch the ordinary "file is gone" case, so anything reaching here is the
  // unusual kind, and the download it produces will be quietly short.
  archive.on("warning", (error: ArchiverError) => {
    const where = (error as { path?: unknown }).path;
    console.error(
      `[export] ${job.intWoId}: ${typeof where === "string" ? where : "a file"} — ${error.message}`,
    );
  });

  archive.append(buildTextReport(data), { name: reportFileName(data) });

  // "NetCom INT WO", not the field label "NetCom INT WO ID" — the folder is
  // named for the document, not for the number printed inside it.
  const workOrderFolder = `${safeName(company.name)} INT WO`;

  // Regenerated here rather than pulled from storage, so the copy in the
  // archive matches the job as it stands right now.
  try {
    const pdf = await buildWorkOrderPdf(data);
    archive.append(pdf, {
      name: `${workOrderFolder}/${safeName(job.intWoId)}.pdf`,
    });
  } catch {
    archive.append(
      "The internal work order could not be generated for this job.\n",
      { name: `${workOrderFolder}/ERROR.txt` },
    );
  }

  // The paying company's own paperwork, beside ours: "Mettel WO" next to
  // "NetCom INT WO", so nobody has to open both to tell them apart. Kept apart
  // from each other however the two companies happen to be named.
  const rootTaken = new Set([workOrderFolder.toLowerCase()]);
  const clientWorkOrderFolder = uniqueSegment(safeName(`${job.client.name} WO`), rootTaken);
  const signOffFolder = uniqueSegment("Sign-off sheets", rootTaken);

  const used = new Set<string>();

  /** Keeps two IMG_0001.jpg from different phones from colliding. */
  function uniquePath(candidate: string): string {
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }

    const dot = candidate.lastIndexOf(".");
    const stem = dot === -1 ? candidate : candidate.slice(0, dot);
    const extension = dot === -1 ? "" : candidate.slice(dot);

    let counter = 2;
    let next = `${stem} (${counter})${extension}`;
    while (used.has(next)) {
      counter += 1;
      next = `${stem} (${counter})${extension}`;
    }

    used.add(next);
    return next;
  }

  // Field, location, photo. The top-level names the rest of the archive uses
  // are kept out of reach of a custom field that happens to share one.
  const { photos, notes } = planDeliverableExport(
    job.deliverables,
    data.rules,
    job.locations,
    [
      "Signatures",
      "Receipts",
      workOrderFolder,
      clientWorkOrderFolder,
      signOffFolder,
      reportFileName(data),
      "Photo index.csv",
      "MISSING FILES.txt",
    ],
  );
  const attachments = new Map(
    job.deliverables.flatMap((item) =>
      item.attachments.map((attachment) => [attachment.id, attachment] as const),
    ),
  );

  const index: string[][] = [
    ["File", "Field", "Location", "Label", "Uploaded by", "Taken", "Original name"],
  ];
  for (const photo of photos) {
    const attachment = attachments.get(photo.attachmentId)!;
    index.push([
      photo.path,
      photo.field,
      photo.location ?? "",
      photo.label ?? "",
      attachment.uploadedBy?.name ?? "",
      usDateTimeInZone(attachment.capturedAt ?? attachment.createdAt, data.timeZone),
      attachment.originalName,
    ]);
    if (!(await fileExists(attachment.storagePath))) {
      missing.push(photo.path);
      continue;
    }
    archive.file(absolutePath(attachment.storagePath), {
      name: uniquePath(photo.path),
    });
  }
  for (const note of notes) {
    archive.append(note.text, { name: uniquePath(note.path) });
  }
  if (photos.length > 0) {
    archive.append(
      index.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n",
      { name: "Photo index.csv" },
    );
  }

  for (const signature of job.signatures) {
    if (!signature.attachment) continue;
    const path = `Signatures/${safeName(
      `${signature.kind}-${signature.signerName}-Signature`,
    )}.png`;
    if (!(await fileExists(signature.attachment.storagePath))) {
      missing.push(path);
      continue;
    }

    archive.file(absolutePath(signature.attachment.storagePath), {
      name: uniquePath(path),
    });
  }

  // Under the names they were attached with, so the sheet the client sent is
  // recognisably theirs; the filled copy carries "— filled" from when it was
  // made. Both go: the blank is what the job was given, the filled one what
  // came back.
  for (const document of job.documents) {
    const folder =
      document.jobDocumentKind === "SIGN_OFF" ? signOffFolder : clientWorkOrderFolder;
    const stem = document.originalName.replace(/\.[a-z0-9]{1,5}$/i, "");
    const path = `${folder}/${safeName(stem)}.${extensionFor(document.mimeType, document.originalName)}`;
    if (!(await fileExists(document.storagePath))) {
      missing.push(path);
      continue;
    }
    archive.file(absolutePath(document.storagePath), { name: uniquePath(path) });
  }

  for (const entry of job.reimbursements) {
    for (const attachment of entry.attachments) {
      const label = safeName(entry.label ?? entry.type);
      // The extension the bytes are: a PDF receipt is not a .jpg.
      const path = `Receipts/${label} $${Number(entry.amount).toFixed(2)}.${extensionFor(attachment.mimeType)}`;
      if (!(await fileExists(attachment.storagePath))) {
        missing.push(path);
        continue;
      }
      archive.file(absolutePath(attachment.storagePath), {
        name: uniquePath(path),
      });
    }
  }

  // Last, so it has seen everything. A download that is quietly short is worse
  // than one that says which pieces are not in it and who to ask.
  if (missing.length > 0) {
    archive.append(
      [
        "These are on the job's record but their files could not be read,",
        "so they are not in this archive. Nothing has been deleted from the",
        "job — tell an administrator, who can look for them on the server.",
        "",
        ...missing.map((entry) => `  ${entry}`),
        "",
      ].join("\n"),
      { name: "MISSING FILES.txt" },
    );
  }

  // Not awaited — the caller streams the archive as it is written — but a
  // rejection here would otherwise be an unhandled one, and the client would
  // be handed a truncated zip with nothing said anywhere.
  archive.finalize().catch((error) => {
    console.error(`[export] archive for ${job.intWoId} failed:`, error);
    archive.destroy(error instanceof Error ? error : new Error(String(error)));
  });

  return archive;
}
