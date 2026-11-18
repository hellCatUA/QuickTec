import { FileText } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { db } from "@/lib/db";
import { loadJobForExport } from "@/lib/exports/job-data";
import { canOnJob } from "@/lib/scope";
import { getSessionUser } from "@/lib/session";
import { cn } from "@/lib/utils";
import {
  NO_WORK_ORDER,
  NOT_CLOSED_YET,
  signableWorkOrder,
  signedWorkOrderName,
  workIsDone,
  type SavedSignOff,
} from "@/lib/wo-sign-off";
import { workOrderDefaults } from "@/lib/wo-sign-off-data";
import { WoSignOff } from "./wo-sign-off";

export const metadata = { title: "Use WM WO as a Sign-Off" };

/** What a signed copy kept about itself, if it still reads as that. */
function savedFrom(raw: unknown): SavedSignOff | null {
  if (!raw || typeof raw !== "object") return null;
  const saved = raw as Partial<SavedSignOff>;
  const overlay = saved.overlay;
  if (
    !overlay ||
    !Array.isArray(overlay.pages) ||
    !overlay.times ||
    !overlay.notes ||
    !overlay.approval ||
    !Array.isArray(overlay.covers) ||
    !saved.values ||
    !saved.found
  ) {
    return null;
  }
  return { overlay, values: saved.values, typed: saved.typed ?? {}, found: saved.found };
}

export default async function WoSignOffPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ wo?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/signin");

  const { id } = await params;
  const { wo } = await searchParams;

  const job = await db.job.findUnique({
    where: { id },
    select: {
      id: true,
      intWoId: true,
      lifecycle: true,
      projectId: true,
      createdById: true,
      client: { select: { name: true } },
      assignments: { select: { userId: true } },
      documents: {
        where: { jobDocumentKind: "CLIENT_WORK_ORDER" },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: {
          id: true,
          originalName: true,
          mimeType: true,
          jobDocumentKind: true,
          generated: true,
          signedFromId: true,
          overlay: true,
        },
      },
    },
  });
  if (!job) notFound();

  const canEdit = await canOnJob(user, "deliverable.upload", {
    projectId: job.projectId,
    createdById: job.createdById,
    assigneeIds: job.assignments.map((assignment) => assignment.userId),
  });
  if (!canEdit) redirect(`/jobs/${id}`);

  const header = (
    <PageHeader
      // A non-breaking hyphen: at 320 px the title broke as "Sign-" / "Off".
      title="Use WM WO as a Sign‑Off"
      backHref={`/jobs/${id}`}
      description={
        <>
          {job.client.name} · {job.intWoId}
          {/* On a phone the page under it wants the room. */}
          <span className="max-lg:hidden"> — their work order, signed where the customer signs it.</span>
        </>
      }
    />
  );

  const candidates = job.documents.filter(signableWorkOrder);
  const chosen = candidates.find((document) => document.id === wo) ?? candidates[0] ?? null;

  // Refused here as well as on saving: the page is reachable from a bookmark
  // or a tab left open since before the clock-out.
  const refusal = !workIsDone(job.lifecycle)
    ? NOT_CLOSED_YET
    : !chosen
      ? NO_WORK_ORDER
      : null;

  if (refusal || !chosen) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        {header}
        <Card>
          <CardContent className="flex flex-col gap-3 p-4 text-sm">
            <p role="alert">{refusal}</p>
            <Link
              href={`/jobs/${id}`}
              className="inline-flex min-h-11 w-fit items-center rounded-lg border border-border px-3 hover:bg-muted"
            >
              Back to the job
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const data = await loadJobForExport(id);
  if (!data) notFound();

  const signedCopy =
    job.documents.find(
      (document) => document.generated && document.signedFromId === chosen.id,
    ) ?? null;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      {header}

      {/* More than one work order happens — a revised one sent the morning
          of the job. Each is signed on its own. */}
      {candidates.length > 1 ? (
        <nav aria-label="Which work order" className="flex flex-wrap gap-2">
          {candidates.map((document) => (
            <Link
              key={document.id}
              href={`/jobs/${id}/wo-sign-off?wo=${document.id}`}
              aria-current={document.id === chosen.id ? "true" : undefined}
              className={cn(
                "inline-flex min-h-11 max-w-full items-center gap-2 rounded-lg border px-3 text-sm",
                document.id === chosen.id
                  ? "border-primary bg-primary/10 font-medium"
                  : "border-border hover:bg-muted",
              )}
            >
              <FileText className="size-4 shrink-0" aria-hidden />
              <span className="truncate">{document.originalName}</span>
            </Link>
          ))}
        </nav>
      ) : null}

      <WoSignOff
        // A different work order is a different document: start it afresh.
        key={chosen.id}
        jobId={id}
        workOrder={{ id: chosen.id, name: chosen.originalName }}
        signedName={signedWorkOrderName(chosen.originalName)}
        signedCopy={signedCopy ? { id: signedCopy.id } : null}
        defaults={workOrderDefaults(data)}
        saved={savedFrom(signedCopy?.overlay)}
      />
    </div>
  );
}
