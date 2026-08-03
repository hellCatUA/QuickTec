import { notFound, redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { db } from "@/lib/db";
import { formSourceGroups } from "@/lib/forms/catalogue";
import { can, getSessionUser } from "@/lib/session";
import { FormMapper, type PlacementRow, type SourceGroup } from "./mapper";
import { ReplaceBlank } from "./replace-blank";

export const metadata = { title: "Form fields" };

export default async function FormMappingPage({
  params,
}: {
  params: Promise<{ id: string; templateId: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/signin");
  if (!can(user, "client.manage")) redirect("/dashboard");

  const { id, templateId } = await params;

  const template = await db.clientDocumentTemplate.findUnique({
    where: { id: templateId },
    select: {
      id: true,
      label: true,
      kind: true,
      clientId: true,
      boxSource: true,
      pageCount: true,
      pageWidth: true,
      pageHeight: true,
      client: { select: { id: true, name: true } },
      attachment: { select: { id: true, mimeType: true } },
      placements: {
        orderBy: [{ page: "asc" }, { order: "asc" }],
        select: {
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
        },
      },
    },
  });

  if (!template || template.clientId !== id) notFound();

  const groups: SourceGroup[] = formSourceGroups().map((group) => ({
    group: group.group,
    sources: group.sources.map((source) => ({
      key: source.key,
      label: source.label,
      list: Boolean(source.list),
      image: Boolean(source.resolveImage),
    })),
  }));

  const isPdf = template.attachment.mimeType === "application/pdf";

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <PageHeader
        title={template.label}
        backHref="/directory/clients"
        description={`${template.client.name} — say what goes in each box once, and every job for them starts with the form already filled in.`}
      />

      {!isPdf ? (
        <Card>
          <CardContent className="p-4 text-sm text-muted-foreground">
            This blank is a photo rather than a PDF, so there is nothing to fill
            in automatically. Replace it with a PDF to set the boxes up.
          </CardContent>
        </Card>
      ) : (
        <FormMapper
          templateId={template.id}
          fileUrl={`/api/files/${template.attachment.id}`}
          pageCount={template.pageCount ?? 1}
          pageWidth={template.pageWidth ?? 612}
          pageHeight={template.pageHeight ?? 792}
          groups={groups}
          drawn={template.boxSource !== "FIELDS"}
          initial={template.placements as PlacementRow[]}
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle>Replace the blank</CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <ReplaceBlank templateId={template.id} />
        </CardContent>
      </Card>
    </div>
  );
}
