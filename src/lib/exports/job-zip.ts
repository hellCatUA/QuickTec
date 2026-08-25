import { ZipArchive, type ArchiverError } from "archiver";
import { DELIVERABLE_META } from "@/lib/deliverables";
import { exportStem, type JobExportData } from "@/lib/exports/job-data";
import { buildTextReport } from "@/lib/exports/text-report";
import { buildWorkOrderPdf } from "@/lib/exports/work-order-pdf";
import { absolutePath, fileExists } from "@/lib/storage";

/**
 * The archive handed to the client.
 *
 *   Pre-Install/<tech>/IMG_0001.jpg
 *   Post Install/<tech>/…
 *   Sign Off/…
 *   Signatures/MOD-Dana Reyes-Signature.png
 *   Receipts/…
 *   <Company> INT WO/2026-07-PRJ12-0001.pdf
 *   887766-Report.txt
 *
 * Photos sit under their section and then under whoever took them, so a
 * two-tech job does not turn into an unsorted pile. The archive is streamed
 * rather than assembled in memory: thirty photos at 2400px is comfortably more
 * than a Node buffer should be holding while a phone downloads it over the
 * VPN.
 */

/** Strips anything that would upset a filesystem, on any platform. */
function safeName(name: string): string {
  return (
    name
      .replace(/[/\\?%*:|"<>\x00-\x1f]/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120) || "untitled"
  );
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

  // A missing photo should cost that photo, not the whole download — and
  // throwing from an event handler cannot be caught by the caller anyway, it
  // just takes the process's stream down mid-download and hands the client a
  // truncated zip.
  archive.on("warning", (error: ArchiverError) => {
    const where = (error as { path?: unknown }).path;
    missing.push(
      `${typeof where === "string" ? where : "a file"}: ${error.message}`,
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

  for (const item of job.deliverables) {
    const folder =
      item.category === "CUSTOM" && item.customLabel
        ? safeName(item.customLabel)
        : DELIVERABLE_META[item.category].label;

    const tech = item.assignment?.user.name
      ? safeName(item.assignment.user.name)
      : "Unattributed";

    // Serial numbers and return tracking are text, not files, so they would
    // otherwise vanish from the archive entirely.
    if (item.textValue?.trim()) {
      archive.append(`${item.textValue.trim()}\n`, {
        name: uniquePath(`${folder}/${tech}/notes.txt`),
      });
    }

    for (const attachment of item.attachments) {
      const path = `${folder}/${tech}/${safeName(attachment.originalName)}`;
      if (!(await fileExists(attachment.storagePath))) {
        missing.push(path);
        continue;
      }
      archive.file(absolutePath(attachment.storagePath), {
        name: uniquePath(path),
      });
    }
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

  for (const entry of job.reimbursements) {
    for (const attachment of entry.attachments) {
      const label = safeName(entry.label ?? entry.type);
      const path = `Receipts/${label} $${Number(entry.amount).toFixed(2)}.jpg`;
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
