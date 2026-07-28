import { NextResponse } from "next/server";
import { contentDisposition, loadExportable } from "@/lib/exports/guard";
import { buildWorkOrderPdf } from "@/lib/exports/work-order-pdf";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const data = await loadExportable(id, "export.internal_wo");
  if (!data) return new NextResponse("Not found", { status: 404 });

  const pdf = await buildWorkOrderPdf(data);
  const inline = new URL(request.url).searchParams.get("inline") === "1";
  const filename = `${data.company.name} ${data.company.intWoLabel} ${data.job.intWoId}.pdf`;

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(pdf.byteLength),
      // Rendered fresh each time so it always matches the job as it stands;
      // caching would defeat the point.
      "Cache-Control": "no-store",
      "Content-Disposition": inline
        ? `inline; filename="work-order.pdf"`
        : contentDisposition(filename),
    },
  });
}
