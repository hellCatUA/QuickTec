/**
 * What a job holds, and what of it is actually on disk.
 *
 * Written for the question "the ZIP is short a few photos — where did they
 * go?", which the export itself cannot answer: it can only report what it
 * found. This looks at the record and the disk side by side and says which of
 * the two is missing something.
 *
 * Read-only. Safe to run against production.
 *
 *   npx tsx --tsconfig tsconfig.json scripts/audit-job-files.ts 2608-0000-0017
 *   npx tsx --tsconfig tsconfig.json scripts/audit-job-files.ts --all
 *
 * With --all it sweeps every job and prints only the ones with a problem.
 */

import "dotenv/config";
import { db } from "@/lib/db";
import { DELIVERABLE_META } from "@/lib/deliverables";
import { fileExists, absolutePath } from "@/lib/storage";

type Problem = { job: string; kind: string; detail: string };

async function auditJob(jobId: string): Promise<{
  label: string;
  lines: string[];
  problems: Problem[];
}> {
  const job = await db.job.findUniqueOrThrow({
    where: { id: jobId },
    select: {
      id: true,
      intWoId: true,
      title: true,
      deliverables: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          category: true,
          customLabel: true,
          textValue: true,
          createdAt: true,
          assignment: { select: { user: { select: { name: true } } } },
          attachments: {
            orderBy: { createdAt: "asc" },
            select: {
              id: true,
              storagePath: true,
              originalName: true,
              sizeBytes: true,
              createdAt: true,
            },
          },
        },
      },
      signatures: {
        select: {
          kind: true,
          signerName: true,
          attachment: { select: { storagePath: true } },
        },
      },
      reimbursements: {
        select: {
          label: true,
          type: true,
          attachments: { select: { storagePath: true } },
        },
      },
    },
  });

  const label = `${job.intWoId} — ${job.title}`;
  const lines: string[] = [];
  const problems: Problem[] = [];

  for (const item of job.deliverables) {
    const section =
      item.category === "CUSTOM" && item.customLabel
        ? item.customLabel
        : DELIVERABLE_META[item.category].label;
    const who = item.assignment?.user.name ?? "Unattributed";

    lines.push(
      `  ${section} / ${who} — ${item.attachments.length} file(s)` +
        (item.textValue?.trim() ? ", plus text" : ""),
    );

    for (const attachment of item.attachments) {
      const there = await fileExists(attachment.storagePath);
      lines.push(
        `      ${there ? "ok     " : "MISSING"} ${attachment.originalName}` +
          `  (${attachment.sizeBytes} bytes, ${attachment.storagePath})`,
      );
      if (!there) {
        problems.push({
          job: label,
          kind: "file gone from disk",
          detail: `${section} / ${who} / ${attachment.originalName} → ${absolutePath(
            attachment.storagePath,
          )}`,
        });
      }
    }
  }

  for (const signature of job.signatures) {
    if (!signature.attachment) {
      problems.push({
        job: label,
        kind: "signature with no image",
        detail: `${signature.kind} — ${signature.signerName}`,
      });
      continue;
    }
    if (!(await fileExists(signature.attachment.storagePath))) {
      problems.push({
        job: label,
        kind: "file gone from disk",
        detail: `Signature ${signature.kind} — ${signature.signerName}`,
      });
    }
  }

  for (const entry of job.reimbursements) {
    for (const attachment of entry.attachments) {
      if (!(await fileExists(attachment.storagePath))) {
        problems.push({
          job: label,
          kind: "file gone from disk",
          detail: `Receipt ${entry.label ?? entry.type}`,
        });
      }
    }
  }

  return { label, lines, problems };
}

/**
 * Photos on the job that no section owns.
 *
 * An upload that failed to be attached, or an attachment left behind by an
 * older code path, is invisible everywhere: not in the section list, not in
 * the export, not deleted either. It is the shape a lost photo takes.
 */
async function orphans(jobId?: string): Promise<Problem[]> {
  const rows = await db.attachment.findMany({
    where: {
      deliverableItemId: null,
      reimbursementId: null,
      jobDocumentId: null,
      clientTemplate: null,
      signature: null,
      // Everything a job stores lives under its own id, so this narrows the
      // sweep to the job being asked about. Without it a single-job report is
      // buried under every leftover the server has ever accumulated.
      ...(jobId ? { storagePath: { startsWith: `jobs/${jobId}/` } } : {}),
    },
    select: {
      id: true,
      originalName: true,
      storagePath: true,
      createdAt: true,
      uploadedBy: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return rows.map((row) => ({
    job: "(not attached to anything)",
    kind: "orphaned upload",
    detail: `${row.originalName} by ${row.uploadedBy.name} on ${row.createdAt.toISOString()} → ${row.storagePath}`,
  }));
}

async function main() {
  const argument = process.argv[2];
  if (!argument) {
    console.error(
      "Give an INT WO number or a job id, or --all to sweep every job.",
    );
    process.exit(2);
  }

  const problems: Problem[] = [];
  let scoped: string | undefined;

  if (argument === "--all") {
    const jobs = await db.job.findMany({
      select: { id: true },
      orderBy: { createdAt: "desc" },
    });
    console.log(`Checking ${jobs.length} job(s)…\n`);
    for (const job of jobs) {
      const result = await auditJob(job.id);
      problems.push(...result.problems);
    }
  } else {
    const job = await db.job.findFirst({
      where: { OR: [{ id: argument }, { intWoId: argument }] },
      select: { id: true },
    });
    if (!job) {
      console.error(`No job with id or INT WO number "${argument}".`);
      process.exit(2);
    }
    scoped = job.id;

    const result = await auditJob(job.id);
    console.log(result.label);
    console.log(result.lines.join("\n") || "  (nothing recorded)");
    console.log();

    // What was done to the photos, which is the other half of the question.
    // A section that is not there because somebody removed it looks exactly
    // like one that was never filled in, unless you read this.
    const history = await db.auditEvent.findMany({
      where: {
        jobId: job.id,
        action: {
          in: [
            "deliverable_added",
            "deliverable_removed",
            "deliverable_moved",
            "deliverable_updated",
          ],
        },
      },
      orderBy: { createdAt: "asc" },
      select: {
        action: true,
        createdAt: true,
        detail: true,
        actor: { select: { name: true } },
      },
    });

    console.log("What was done to the deliverables:");
    if (history.length === 0) {
      console.log("  (nothing on the record)");
    }
    for (const event of history) {
      const detail = (event.detail ?? {}) as Record<string, unknown>;
      const about = [detail.category, detail.field, detail.from, detail.to]
        .filter(Boolean)
        .join(" ");
      console.log(
        `  ${event.createdAt.toISOString()}  ${event.action.padEnd(21)}` +
          `  ${event.actor?.name ?? "the system"}  ${about}`,
      );
    }
    console.log();

    problems.push(...result.problems);
  }

  problems.push(...(await orphans(scoped)));

  if (problems.length === 0) {
    console.log("Everything on the record is on the disk. Nothing missing.");
    return;
  }

  console.log(`${problems.length} problem(s):\n`);
  for (const problem of problems) {
    console.log(`  [${problem.kind}] ${problem.job}`);
    console.log(`      ${problem.detail}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
