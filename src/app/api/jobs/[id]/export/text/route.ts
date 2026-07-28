import { NextResponse } from "next/server";
import { contentDisposition, loadExportable } from "@/lib/exports/guard";
import { reportFileName } from "@/lib/exports/job-zip";
import { buildTextReport } from "@/lib/exports/text-report";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const data = await loadExportable(id, "export.text");
  if (!data) return new NextResponse("Not found", { status: 404 });

  const report = buildTextReport(data);

  // ?inline=1 backs the on-page preview, which is what most people actually
  // use — the report is normally pasted into an email, not saved.
  const inline = new URL(request.url).searchParams.get("inline") === "1";

  return new NextResponse(report, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      ...(inline
        ? {}
        : { "Content-Disposition": contentDisposition(reportFileName(data)) }),
    },
  });
}
