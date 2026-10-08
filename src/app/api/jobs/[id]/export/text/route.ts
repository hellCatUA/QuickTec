import { NextResponse } from "next/server";
import { contentDisposition, loadExportableWithForms } from "@/lib/exports/guard";
import {
  buildLegacyWmForm,
  buildWmForm,
  wmFormFileName,
} from "@/lib/exports/text-report";

/**
 * The WM Form as a file.
 *
 *   ?form=legacy        the form WorkMarket alone used to get
 *   ?tech=<assignment>  whose updated form; the caller's own when left out
 *
 * The updated form says what its tech is paid, so only whoever may see that
 * gets it — see wmFormAssignments. Anyone else is not handed someone else's.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const loaded = await loadExportableWithForms(id, "export.text");
  if (!loaded) return new NextResponse("Not found", { status: 404 });
  const { data, forms, own } = loaded;

  const query = new URL(request.url).searchParams;
  let report: string | null;
  let filename: string;
  if (query.get("form") === "legacy") {
    report = buildLegacyWmForm(data);
    filename = wmFormFileName(data, "legacy");
  } else {
    const asked = query.get("tech");
    const assignmentId = asked
      ? forms.includes(asked)
        ? asked
        : null
      : own && forms.includes(own)
        ? own
        : (forms[0] ?? null);
    if (!assignmentId) return new NextResponse("Not found", { status: 404 });
    report = buildWmForm(data, assignmentId);
    filename = wmFormFileName(data, { assignmentId });
  }
  if (report === null) return new NextResponse("Not found", { status: 404 });

  // ?inline=1 backs the on-page preview, which is what most people actually
  // use — the report is normally pasted into an email, not saved.
  const inline = query.get("inline") === "1";

  return new NextResponse(report, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      ...(inline ? {} : { "Content-Disposition": contentDisposition(filename) }),
    },
  });
}
