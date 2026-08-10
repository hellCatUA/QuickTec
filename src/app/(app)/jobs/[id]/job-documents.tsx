"use client";

import { FileText, Loader2, Upload, Wand2, X } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  deleteJobDocument,
  setNoWorkOrder,
  uploadJobDocument,
} from "./upload-actions";

export type JobDocumentKind = "CLIENT_WORK_ORDER" | "SIGN_OFF";

export type JobDocument = {
  id: string;
  kind: JobDocumentKind;
  originalName: string;
  sizeBytes: number;
  /** Produced by filling a blank in, rather than uploaded. */
  generated: boolean;
  /** How many of this blank's boxes the app knows how to fill. Zero means no. */
  fillableBoxes: number;
  /** The company form it came from, which is what the review screen needs. */
  templateId: string | null;
};

function readableSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The representing company's paperwork for this job.
 *
 * Two documents, and neither is ours. The work order is what the job answers
 * to, and it lived in somebody's inbox until now — the tech at the door is the
 * person most likely to need it and least likely to have the email. The
 * sign-off sheet is the blank they get signed on site, which is why anyone on
 * the job can add either: the PDF often arrives at eight in the morning, long
 * after whoever planned the job has moved on to the next one.
 */
export function JobDocuments({
  jobId,
  documents,
  noWorkOrder,
  canUpload,
  canDeclare,
  only,
}: {
  jobId: string;
  documents: JobDocument[];
  noWorkOrder: boolean;
  /**
   * Which of the two to render, when they are wanted in different places.
   *
   * The work order belongs with the job it answers to; the sign-off sheet is
   * one of the deliverables and belongs with them. They used to share a card
   * because they arrive from the same company, which is the least useful thing
   * about either of them.
   */
  only?: JobDocumentKind;
  /** On the job: allowed to attach, and to remove their own upload. */
  canUpload: boolean;
  /** Allowed to assert that there is no work order at all. */
  canDeclare: boolean;
}) {
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function upload(kind: JobDocumentKind, files: File[]) {
    if (files.length === 0) return;
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("jobId", jobId);
      formData.set("kind", kind);
      for (const file of files) formData.append("files", file);

      const result = await uploadJobDocument(null, formData);
      if (!result.ok) setError(result.error);
    });
  }

  function remove(id: string) {
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("id", id);
      const result = await deleteJobDocument(formData);
      if (!result.ok) setError(result.error);
    });
  }

  function declare(none: boolean) {
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("jobId", jobId);
      formData.set("none", String(none));
      const result = await setNoWorkOrder(formData);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? <p className="text-sm text-danger">{error}</p> : null}

      {only === "SIGN_OFF" ? null : (
      <Section
        jobId={jobId}
        title="Work order"
        hint="As the representing company issued it."
        kind="CLIENT_WORK_ORDER"
        documents={documents.filter(
          (doc) => doc.kind === "CLIENT_WORK_ORDER",
        )}
        empty={
          noWorkOrder
            ? "Marked as no work order issued for this job."
            : "Not attached yet. Whoever has the PDF can add it — the planner now, or the tech when it arrives."
        }
        canUpload={canUpload}
        pending={pending}
        onUpload={upload}
        onRemove={remove}
        footer={
          canDeclare ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => declare(!noWorkOrder)}
            >
              {noWorkOrder ? "There is one after all" : "No WO for this job"}
            </Button>
          ) : null
        }
      />
      )}

      {only === "CLIENT_WORK_ORDER" ? null : (
      <Section
        jobId={jobId}
        title="Sign-off sheet"
        hint="Their blank, filled in and signed on site at the end of the job."
        kind="SIGN_OFF"
        documents={documents.filter((doc) => doc.kind === "SIGN_OFF")}
        empty="Not attached. If this company has a standard one, add it to them in the directory and it comes across on every job."
        canUpload={canUpload}
        pending={pending}
        onUpload={upload}
        onRemove={remove}
      />
      )}
    </div>
  );
}

/**
 * Opens the sheet to be checked over before it goes anywhere.
 *
 * A link rather than a button that produces the document, because what the
 * app can fill is most of a real sign-off sheet and never all of it — the
 * travel time, the tick against "site not ready", the phone number we never
 * held. Those get typed there instead of written on a printout, and nothing
 * reaches the job until somebody has looked at the page.
 */
function ReviewLink({
  jobId,
  document,
  filled,
}: {
  jobId: string;
  document: JobDocument;
  /** Whether a filled copy is already on the job. */
  filled: boolean;
}) {
  return (
    <Link
      href={`/jobs/${jobId}/sign-off/${document.templateId}`}
      className="inline-flex min-h-9 w-fit items-center gap-2 rounded-lg border border-border px-3 text-sm hover:bg-muted"
    >
      <Wand2 className="size-4 text-[var(--color-primary)]" />
      {filled ? "Check it again" : "Fill it in and check it"}
      <span className="text-xs text-muted-foreground">
        {document.fillableBoxes} box{document.fillableBoxes === 1 ? "" : "es"} fill
        themselves
      </span>
    </Link>
  );
}

function Section({
  jobId,
  title,
  hint,
  kind,
  documents,
  empty,
  canUpload,
  pending,
  onUpload,
  onRemove,
  footer,
}: {
  jobId: string;
  title: string;
  hint: string;
  kind: JobDocumentKind;
  documents: JobDocument[];
  empty: string;
  canUpload: boolean;
  pending: boolean;
  onUpload: (kind: JobDocumentKind, files: File[]) => void;
  onRemove: (id: string) => void;
  footer?: React.ReactNode;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);

  return (
    <div className="flex flex-col gap-2">
      <div>
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {title}
        </div>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>

      {documents.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        documents.map((doc) => (
          <div
            key={doc.id}
            className="flex flex-col gap-2 rounded-lg border border-border p-2 text-sm"
          >
            <div className="flex items-center gap-2">
              {doc.generated ? (
                <Wand2 className="size-4 shrink-0 text-[var(--color-primary)]" />
              ) : (
                <FileText className="size-4 shrink-0 text-muted-foreground" />
              )}
              <a
                href={`/api/files/${doc.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="min-w-0 flex-1 truncate underline-offset-2 hover:underline"
              >
                {doc.originalName}
              </a>
              <span className="shrink-0 text-xs text-muted-foreground">
                {readableSize(doc.sizeBytes)}
              </span>
              {canUpload ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${doc.originalName}`}
                  disabled={pending}
                  onClick={() => onRemove(doc.id)}
                >
                  <X />
                </Button>
              ) : null}
            </div>

            {/* Fill it in from the job, rather than by hand in a lobby. Offered
                only on the blank itself: the filled copy is regenerated from
                this one, never from itself. */}
            {canUpload && !doc.generated && doc.fillableBoxes > 0 && doc.templateId ? (
              <ReviewLink
                jobId={jobId}
                document={doc}
                filled={documents.some(
                  (other) =>
                    other.generated && other.templateId === doc.templateId,
                )}
              />
            ) : null}
          </div>
        ))
      )}

      {canUpload ? (
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border px-3 text-sm">
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Upload className="size-4" />
            )}
            {pending ? "Uploading" : `Attach ${title.toLowerCase()}`}
            {/* No capture attribute: iOS then offers camera, library and Files
                from the same control, and this arrives as all three. */}
            <input
              ref={inputRef}
              id={`doc-${kind}`}
              type="file"
              accept="image/*,application/pdf"
              multiple
              className="sr-only"
              onChange={(event) => {
                onUpload(kind, Array.from(event.target.files ?? []));
                if (inputRef.current) inputRef.current.value = "";
              }}
            />
          </label>
          {footer}
        </div>
      ) : (
        footer
      )}
    </div>
  );
}
