"use client";

import { AlertTriangle, FileText, Loader2, Plus, Upload, X } from "lucide-react";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { DELIVERABLE_META, type DeliverableRule } from "@/lib/deliverables";
import { prepareForUpload } from "@/lib/photo-upload";
import type { DeliverableCategory } from "@prisma-client";
import { deleteDeliverableItem, saveDeliverable } from "./upload-actions";

export type DeliverableItemView = {
  id: string;
  category: DeliverableCategory;
  customLabel: string | null;
  textValue: string | null;
  uploadedBy: string | null;
  isOwn: boolean;
  attachments: { id: string; mimeType: string; originalName: string }[];
};

export function Deliverables({
  jobId,
  rules,
  items,
  canUpload,
  photoCount,
  photoLimit,
}: {
  jobId: string;
  rules: DeliverableRule[];
  items: DeliverableItemView[];
  canUpload: boolean;
  photoCount: number;
  photoLimit: number;
}) {
  const [openCategory, setOpenCategory] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const remaining = photoLimit - photoCount;

  return (
    <div className="flex flex-col gap-4">
      {error ? <p className="text-sm text-danger">{error}</p> : null}

      <p className="text-xs text-muted-foreground">
        {photoCount} of {photoLimit} photos used on this job.
      </p>

      {rules.map((rule) => {
        const key = rule.customLabel
          ? `${rule.category}:${rule.customLabel}`
          : rule.category;

        const mine = items.filter(
          (item) =>
            item.category === rule.category &&
            (rule.category !== "CUSTOM" ||
              item.customLabel === rule.customLabel),
        );

        const satisfied = mine.length > 0;
        const label =
          rule.category === "CUSTOM" && rule.customLabel
            ? rule.customLabel
            : DELIVERABLE_META[rule.category].label;

        return (
          <div key={key} className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{label}</span>
              {rule.required ? (
                satisfied ? (
                  <Badge variant="success">Done</Badge>
                ) : (
                  <Badge variant="warning">
                    <AlertTriangle className="size-3" /> Required
                  </Badge>
                )
              ) : null}

              {canUpload && openCategory !== key ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  // Several sections each have an "Add" button; without the
                  // section in the name they are indistinguishable to a screen
                  // reader.
                  aria-label={`Add to ${label}`}
                  onClick={() => setOpenCategory(key)}
                >
                  <Plus /> Add
                </Button>
              ) : null}
            </div>

            {mine.length === 0 && openCategory !== key ? (
              <p className="text-xs text-muted-foreground">
                {DELIVERABLE_META[rule.category].description}
              </p>
            ) : null}

            {mine.map((item) => (
              <div
                key={item.id}
                className="flex flex-col gap-2 rounded-lg border border-border p-2"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {item.uploadedBy ?? "unattributed"}
                  </span>
                  {(item.isOwn || canUpload) && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="ml-auto"
                      aria-label="Remove"
                      disabled={pending}
                      onClick={() => {
                        setError(null);
                        startTransition(async () => {
                          const formData = new FormData();
                          formData.set("id", item.id);
                          const result = await deleteDeliverableItem(formData);
                          if (!result.ok) setError(result.error);
                        });
                      }}
                    >
                      <X />
                    </Button>
                  )}
                </div>

                {item.textValue ? (
                  <p className="whitespace-pre-wrap text-sm">{item.textValue}</p>
                ) : null}

                {item.attachments.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {item.attachments.map((attachment) =>
                      attachment.mimeType === "application/pdf" ? (
                        <a
                          key={attachment.id}
                          href={`/api/files/${attachment.id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="flex size-20 flex-col items-center justify-center gap-1 rounded-lg border border-border text-[10px] text-muted-foreground"
                        >
                          <FileText className="size-6" />
                          PDF
                        </a>
                      ) : (
                        <a
                          key={attachment.id}
                          href={`/api/files/${attachment.id}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={`/api/files/${attachment.id}?w=200`}
                            alt={attachment.originalName}
                            loading="lazy"
                            className="size-20 rounded-lg border border-border object-cover"
                          />
                        </a>
                      ),
                    )}
                  </div>
                ) : null}
              </div>
            ))}

            {openCategory === key ? (
              <UploadForm
                jobId={jobId}
                rule={rule}
                remaining={remaining}
                onDone={() => setOpenCategory(null)}
                onError={setError}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function UploadForm({
  jobId,
  rule,
  remaining,
  onDone,
  onError,
}: {
  jobId: string;
  rule: DeliverableRule;
  remaining: number;
  onDone: () => void;
  onError: (message: string | null) => void;
}) {
  const [files, setFiles] = React.useState<File[]>([]);
  const [text, setText] = React.useState("");
  const [customLabel, setCustomLabel] = React.useState(rule.customLabel ?? "");
  const [pending, setPending] = React.useState(false);
  const [done, setDone] = React.useState(0);

  /**
   * One request per photo.
   *
   * Ten in a single request is 35 MB that has to arrive whole before anything
   * happens — minutes on a site's LTE, past the request size limit at the end
   * of it, with no sign of progress and all ten lost if the signal drops on
   * the last one. Each photo is also shrunk to what the server would have kept
   * anyway before it is sent, which is most of the wait.
   */
  async function submit() {
    onError(null);
    setPending(true);
    setDone(0);

    // The section is made by the first request and joined by the rest, so the
    // photos land together however many there are.
    let itemId: string | undefined;

    for (const [index, original] of files.entries()) {
      const prepared = await prepareForUpload(original);

      const formData = new FormData();
      formData.set("jobId", jobId);
      formData.set("category", rule.category);
      if (customLabel) formData.set("customLabel", customLabel);
      // Text belongs to the section, so it goes with the request that makes it.
      if (text && index === 0) formData.set("textValue", text);
      if (itemId) formData.set("itemId", itemId);
      formData.append("files", prepared.file);
      if (prepared.exif) formData.append("exif", prepared.exif, "exif.bin");

      const result = await saveDeliverable(null, formData);
      if (!result.ok) {
        setPending(false);
        // Named, because the ones before it are already saved and retrying
        // should not mean starting again.
        onError(
          `${original.name}: ${result.error}` +
            (index > 0 ? ` (${index} already saved)` : ""),
        );
        return;
      }

      itemId ??= result.id;
      setDone(index + 1);
    }

    // Text on its own, with no photos to carry it.
    if (files.length === 0) {
      const formData = new FormData();
      formData.set("jobId", jobId);
      formData.set("category", rule.category);
      if (customLabel) formData.set("customLabel", customLabel);
      if (text) formData.set("textValue", text);

      const result = await saveDeliverable(null, formData);
      setPending(false);
      if (!result.ok) return onError(result.error);
      return onDone();
    }

    setPending(false);
    onDone();
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-raised p-3">
      {rule.category === "CUSTOM" ? (
        <Field label="Section name" htmlFor="custom-label">
          <Input
            id="custom-label"
            value={customLabel}
            onChange={(event) => setCustomLabel(event.target.value)}
            placeholder="Rack elevation"
            autoComplete="off"
          />
        </Field>
      ) : null}

      {rule.requiresText ? (
        <Field
          label="Details"
          htmlFor="deliverable-text"
          hint={
            rule.category === "RETURN_LABELS"
              ? "Tracking numbers go into “Return track #” on the report."
              : undefined
          }
        >
          <Textarea
            id="deliverable-text"
            value={text}
            rows={3}
            onChange={(event) => setText(event.target.value)}
          />
        </Field>
      ) : null}

      {rule.requiresPhoto ? (
        <div className="flex flex-col gap-2">
          <label className="flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border px-3 text-sm">
            <Upload className="size-4" />
            {files.length > 0
              ? `${files.length} file${files.length === 1 ? "" : "s"} selected`
              : "Take a photo or choose files"}
            {/* No capture attribute: iOS then offers camera, library and
                Files from the same control. */}
            <input
              type="file"
              accept="image/*,application/pdf"
              multiple
              className="sr-only"
              onChange={(event) =>
                setFiles(Array.from(event.target.files ?? []))
              }
            />
          </label>

          {files.length > remaining ? (
            <p className="text-xs text-warning">
              Only {remaining} more photo{remaining === 1 ? "" : "s"} will fit on
              this job.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          disabled={pending || (files.length === 0 && !text)}
          onClick={submit}
        >
          {pending ? <Loader2 className="animate-spin" /> : null}
          {/* Counted, because a spinner on a two-minute upload is
              indistinguishable from one that has stopped. */}
          {pending
            ? files.length > 1
              ? `Uploading ${done + 1} of ${files.length}`
              : "Uploading"
            : "Save"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={onDone}
        >
          Cancel
        </Button>
      </div>

      {pending ? (
        <p className="text-xs text-muted-foreground">
          Converting and stamping photos — this can take a moment on a weak
          signal. Keep the app open.
        </p>
      ) : null}
    </div>
  );
}
