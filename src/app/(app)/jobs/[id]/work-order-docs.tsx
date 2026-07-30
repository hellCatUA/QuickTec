"use client";

import { FileText, Loader2, Upload, X } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { deleteWorkOrder, uploadWorkOrder } from "./upload-actions";

export type WorkOrderDoc = {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
};

function readableSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The work order the representing company sent.
 *
 * Everybody on the job can open it — the tech at the door is the person most
 * likely to need it and least likely to have the email. Only whoever plans the
 * job can attach or remove one, because the document is the record of what was
 * agreed and not something to be tidied away from a phone.
 */
export function WorkOrderDocs({
  jobId,
  docs,
  canManage,
}: {
  jobId: string;
  docs: WorkOrderDoc[];
  canManage: boolean;
}) {
  const [files, setFiles] = React.useState<File[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const inputRef = React.useRef<HTMLInputElement>(null);

  function upload() {
    if (files.length === 0) return;
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("jobId", jobId);
      for (const file of files) formData.append("files", file);

      const result = await uploadWorkOrder(null, formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setFiles([]);
      if (inputRef.current) inputRef.current.value = "";
    });
  }

  function remove(id: string) {
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("id", id);
      const result = await deleteWorkOrder(formData);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {docs.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No work order attached yet.
        </p>
      ) : (
        docs.map((doc) => (
          <div
            key={doc.id}
            className="flex items-center gap-2 rounded-lg border border-border p-2 text-sm"
          >
            <FileText className="size-4 shrink-0 text-muted-foreground" />
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
            {canManage ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove ${doc.originalName}`}
                disabled={pending}
                onClick={() => remove(doc.id)}
              >
                <X />
              </Button>
            ) : null}
          </div>
        ))
      )}

      {error ? <p className="text-sm text-danger">{error}</p> : null}

      {canManage ? (
        <div className="flex flex-col gap-2">
          <label className="flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border px-3 text-sm">
            <Upload className="size-4" />
            {files.length > 0
              ? `${files.length} file${files.length === 1 ? "" : "s"} selected`
              : "Attach the WO (PDF or photo)"}
            <input
              ref={inputRef}
              type="file"
              accept="image/*,application/pdf"
              multiple
              className="sr-only"
              onChange={(event) =>
                setFiles(Array.from(event.target.files ?? []))
              }
            />
          </label>

          {files.length > 0 ? (
            <Button
              type="button"
              size="sm"
              className="self-start"
              disabled={pending}
              onClick={upload}
            >
              {pending ? <Loader2 className="animate-spin" /> : null}
              {pending ? "Uploading" : "Attach"}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
