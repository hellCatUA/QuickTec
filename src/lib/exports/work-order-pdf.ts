import { readFile } from "node:fs/promises";
import PDFDocument from "pdfkit";
import { formatAddress } from "@/lib/address";
import { intWoFieldLabel } from "@/lib/company";
import { usDateTimeInZone, usTimeInZone } from "@/lib/datetime";
import { deliverableLabel } from "@/lib/deliverables";
import type { JobExportData } from "@/lib/exports/job-data";
import { workSummary } from "@/lib/exports/text-report";
import { absolutePath } from "@/lib/storage";
import { ticketList } from "@/lib/tickets";

/**
 * The company's own work order.
 *
 * Rendered on demand rather than stored, so it always reflects the job as it
 * stands: created at scheduling, it shows the plan; pulled after checkout, it
 * carries the times, the narrative and the signatures. There is no stale copy
 * to wonder about.
 *
 * Unlike the text report this is internal, so it may carry the INC number,
 * hotel claims and the internal status.
 */

const PAGE_MARGIN = 48;
const INK = "#111111";
const MUTED = "#666666";
const RULE = "#cccccc";

type Doc = InstanceType<typeof PDFDocument>;

export async function buildWorkOrderPdf(data: JobExportData): Promise<Buffer> {
  const { job, company, timeZone } = data;

  const doc = new PDFDocument({
    size: "LETTER",
    margin: PAGE_MARGIN,
    info: {
      Title: `${company.name} ${company.intWoLabel} ${job.intWoId}`,
      Author: company.name,
      Subject: job.title,
    },
  });

  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<void>((resolve) => doc.on("end", () => resolve()));

  const width = doc.page.width - PAGE_MARGIN * 2;

  // --- header ---------------------------------------------------------------
  doc.font("Helvetica-Bold").fontSize(18).fillColor(INK).text(company.name);

  const contact = [
    company.addressLine1,
    [company.city, company.state, company.postalCode].filter(Boolean).join(" "),
    company.phone,
    company.email,
  ]
    .filter(Boolean)
    .join(" · ");

  if (contact) {
    doc.font("Helvetica").fontSize(8).fillColor(MUTED).text(contact);
  }

  doc.moveDown(0.8);
  doc
    .font("Helvetica-Bold")
    .fontSize(13)
    .fillColor(INK)
    .text(`Internal Work Order — ${job.title}`);
  doc
    .font("Helvetica")
    .fontSize(10)
    .fillColor(MUTED)
    .text(`${intWoFieldLabel(company)}: ${job.intWoId}`);

  rule(doc, width);

  // --- details --------------------------------------------------------------
  section(doc, "Assignment");
  grid(doc, width, [
    ["Company", job.client.name],
    ["Customer", job.customer.name],
    ["Site", `${data.siteName}`],
    ["Assignment ID", job.externalAssignmentId ?? "—"],
    ["Ticket #", ticketList(job) ?? "—"],
    ["INC #", job.incNumber ?? "—"],
    [
      "Project",
      job.project
        ? `${job.project.name}${job.project.externalProjectId ? ` (${job.project.externalProjectId})` : ""}`
        : "None",
    ],
    ["Address", formatAddress(job.site)],
  ]);

  section(doc, "Time");
  grid(doc, width, [
    [
      "Scheduled",
      job.scheduledStart ? usDateTimeInZone(job.scheduledStart, timeZone) : "—",
    ],
    [
      "Estimate",
      job.estimateMinutes ? `${(job.estimateMinutes / 60).toFixed(2)} hrs` : "—",
    ],
    [
      "Onsite",
      data.span.onsiteAt ? usTimeInZone(data.span.onsiteAt, timeZone) : "—",
    ],
    [
      "Offsite",
      data.span.offsiteAt ? usTimeInZone(data.span.offsiteAt, timeZone) : "—",
    ],
    [
      "Total time",
      data.span.totalMinutes > 0
        ? `${(data.span.totalMinutes / 60).toFixed(2)} hrs`
        : "—",
    ],
    ["Outcome", job.outcome ?? "—"],
    // Internal only: this never reaches the client-facing text report.
    ["Internal status", job.internalStatus?.replace(/_/g, " ") ?? "—"],
    [
      "Release code",
      job.noReleaseCode ? "None obtained" : (job.releaseCode ?? "—"),
    ],
  ]);

  section(doc, "Crew");
  for (const assignment of job.assignments) {
    const visits = assignment.visits
      .map(
        (visit) =>
          `${usTimeInZone(visit.clockInAt, timeZone)} – ${
            visit.clockOutAt ? usTimeInZone(visit.clockOutAt, timeZone) : "open"
          }`,
      )
      .join(", ");

    line(
      doc,
      `${assignment.user.name}${assignment.isLead ? " (lead)" : ""}`,
      visits || "no time recorded",
    );
  }

  section(doc, "Points of contact");
  if (job.pointsOfContact.length === 0) {
    muted(doc, "None recorded.");
  } else {
    for (const contactRow of job.pointsOfContact) {
      line(doc, contactRow.type.replace("_", "/"), contactRow.name);
    }
  }

  const scope = [job.project?.generalScopeOfWork, job.scopeOfWork]
    .filter(Boolean)
    .join("\n\n");
  if (scope) {
    section(doc, "Scope of work");
    doc.font("Helvetica").fontSize(9).fillColor(INK).text(scope, { width });
  }

  const summary = workSummary(data);
  if (summary) {
    section(doc, "Work performed");
    doc.font("Helvetica").fontSize(9).fillColor(INK).text(summary, { width });
  }

  if (job.deliverables.length > 0) {
    section(doc, "Deliverables");
    for (const item of job.deliverables) {
      const photos = item.attachments.length;
      line(
        doc,
        deliverableLabel(item.category, item.customLabel),
        [
          photos > 0 ? `${photos} file${photos === 1 ? "" : "s"}` : null,
          item.textValue?.trim() || null,
          item.assignment?.user.name ? `by ${item.assignment.user.name}` : null,
        ]
          .filter(Boolean)
          .join(" · "),
      );
    }
  }

  if (job.reimbursements.length > 0) {
    section(doc, "Reimbursements");
    let total = 0;
    for (const entry of job.reimbursements) {
      total += Number(entry.amount);
      line(
        doc,
        entry.label ?? entry.type,
        `$${Number(entry.amount).toFixed(2)} (${entry.type})`,
      );
    }
    line(doc, "Total", `$${total.toFixed(2)}`);
  }

  if (job.signatures.length > 0) {
    section(doc, "Signatures");

    for (const signature of job.signatures) {
      if (doc.y > doc.page.height - 160) doc.addPage();

      doc
        .font("Helvetica-Bold")
        .fontSize(9)
        .fillColor(INK)
        .text(`${signature.kind} — ${signature.signerName}`);

      if (signature.skipped || !signature.attachment) {
        muted(doc, "No signature obtained.");
        continue;
      }

      try {
        const image = await readFile(
          absolutePath(signature.attachment.storagePath),
        );
        doc.image(image, { fit: [220, 70] });
      } catch {
        // A missing file must not cost the whole document.
        muted(doc, "Signature image unavailable.");
      }

      if (signature.signedAt) {
        muted(doc, usDateTimeInZone(signature.signedAt, timeZone));
      }
      doc.moveDown(0.4);
    }
  }

  doc.moveDown(1);
  doc
    .font("Helvetica")
    .fontSize(7)
    .fillColor(MUTED)
    .text(
      `Generated ${usDateTimeInZone(new Date(), timeZone)} · ${company.name} internal document`,
      { width },
    );

  doc.end();
  await finished;

  return Buffer.concat(chunks);
}

// --- small layout helpers ---------------------------------------------------

function rule(doc: Doc, width: number) {
  doc.moveDown(0.5);
  doc
    .strokeColor(RULE)
    .lineWidth(0.5)
    .moveTo(PAGE_MARGIN, doc.y)
    .lineTo(PAGE_MARGIN + width, doc.y)
    .stroke();
  doc.moveDown(0.5);
}

function section(doc: Doc, title: string) {
  if (doc.y > doc.page.height - 120) doc.addPage();
  doc.moveDown(0.6);
  doc
    .font("Helvetica-Bold")
    .fontSize(10)
    .fillColor(INK)
    .text(title.toUpperCase(), { characterSpacing: 0.6 });
  doc.moveDown(0.2);
}

function line(doc: Doc, label: string, value: string) {
  if (doc.y > doc.page.height - 70) doc.addPage();
  const y = doc.y;
  doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(label, PAGE_MARGIN, y, {
    width: 130,
    continued: false,
  });
  doc
    .font("Helvetica")
    .fontSize(9)
    .fillColor(INK)
    .text(value || "—", PAGE_MARGIN + 140, y, {
      width: doc.page.width - PAGE_MARGIN * 2 - 140,
    });
  doc.moveDown(0.2);
}

function grid(doc: Doc, _width: number, rows: [string, string][]) {
  for (const [label, value] of rows) line(doc, label, value);
}

function muted(doc: Doc, text: string) {
  doc.font("Helvetica").fontSize(8).fillColor(MUTED).text(text);
}
