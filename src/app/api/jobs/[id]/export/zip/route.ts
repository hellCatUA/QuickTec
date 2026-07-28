import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { contentDisposition, loadExportable } from "@/lib/exports/guard";
import { buildJobZip, zipFileName } from "@/lib/exports/job-zip";
import { recordAudit } from "@/lib/audit";
import { getSessionUser } from "@/lib/session";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const data = await loadExportable(id, "export.zip");
  if (!data) return new NextResponse("Not found", { status: 404 });

  const archive = await buildJobZip(data);

  // Worth a timeline entry: this is the moment a job's photos leave the
  // company, and someone will eventually ask who sent them.
  const user = await getSessionUser();
  await recordAudit({
    actorId: user?.id ?? null,
    entityType: "Job",
    entityId: id,
    jobId: id,
    action: "zip_exported",
    detail: { filename: zipFileName(data) },
  });

  // Streamed rather than buffered — thirty full-size photos should not sit in
  // memory while a phone pulls them down over Tailscale. No Content-Length is
  // possible for the same reason.
  return new NextResponse(
    Readable.toWeb(archive) as ReadableStream<Uint8Array>,
    {
      headers: {
        "Content-Type": "application/zip",
        "Cache-Control": "no-store",
        "Content-Disposition": contentDisposition(zipFileName(data)),
      },
    },
  );
}
