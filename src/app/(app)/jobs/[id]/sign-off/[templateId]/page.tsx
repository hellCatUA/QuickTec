import { notFound, redirect } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { db } from "@/lib/db";
import { loadDraft } from "@/lib/forms/draft";
import { canOnJob } from "@/lib/scope";
import { getSessionUser } from "@/lib/session";
import { SignOffReview } from "./review";

export const metadata = { title: "Sign-off sheet" };

export default async function SignOffPage({
  params,
}: {
  params: Promise<{ id: string; templateId: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/signin");

  const { id, templateId } = await params;

  const job = await db.job.findUnique({
    where: { id },
    select: {
      id: true,
      intWoId: true,
      projectId: true,
      createdById: true,
      client: { select: { name: true } },
      assignments: { select: { userId: true } },
    },
  });
  if (!job) notFound();

  const canEdit = await canOnJob(user, "deliverable.upload", {
    projectId: job.projectId,
    createdById: job.createdById,
    assigneeIds: job.assignments.map((assignment) => assignment.userId),
  });
  if (!canEdit) redirect(`/jobs/${id}`);

  const draft = await loadDraft(id, templateId);
  if (!draft) notFound();

  const attached = await db.attachment.findFirst({
    where: { jobDocumentId: id, generated: true, sourceTemplateId: templateId },
    select: { id: true },
  });

  const mapped = draft.boxes.filter((box) => box.source).length;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <PageHeader
        title={draft.templateLabel}
        backHref={`/jobs/${id}`}
        description={`${job.client.name} · ${job.intWoId} — check it before it goes to the customer. ${mapped} of ${draft.boxes.length} boxes fill themselves; the rest are yours.`}
      />

      {draft.boxes.length === 0 ? (
        <Card>
          <CardContent className="p-4 text-sm text-muted-foreground">
            Nobody has said what goes in this form&rsquo;s boxes yet. Set it up
            against the company in the directory and it will fill itself from
            then on.
          </CardContent>
        </Card>
      ) : (
        <SignOffReview
          jobId={id}
          templateId={templateId}
          templateLabel={draft.templateLabel}
          pageCount={draft.pageCount}
          pageWidth={draft.pageWidth}
          pageHeight={draft.pageHeight}
          boxes={draft.boxes}
          attachedId={attached?.id ?? null}
        />
      )}
    </div>
  );
}
