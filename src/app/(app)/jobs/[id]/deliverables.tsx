"use client";

import {
  AlertTriangle,
  ArrowRightLeft,
  FileText,
  Loader2,
  Plus,
  Upload,
  X,
} from "lucide-react";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import {
  DELIVERABLE_META,
  type DeliverableRule,
  ruleKey,
} from "@/lib/deliverables";
import { prepareForUpload } from "@/lib/photo-upload";
import type { DeliverableCategory } from "@prisma-client";
import {
  deleteDeliverableItem,
  moveDeliverable,
  saveDeliverable,
} from "./upload-actions";

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
  const [moving, setMoving] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const remaining = photoLimit - photoCount;

  function move(itemId: string, target: DeliverableRule) {
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("itemId", itemId);
      formData.set("category", target.category);
      if (target.customLabel) formData.set("customLabel", target.customLabel);

      const result = await moveDeliverable(formData);
      if (!result.ok) return setError(result.error);
      setMoving(null);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? <p className="text-sm text-danger">{error}</p> : null}

      <p className="text-xs text-muted-foreground">
        {photoCount} of {photoLimit} photos used on this job.
      </p>

      {rules.map((rule) => {
        const key = ruleKey(rule);

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
                  {/* Photos land in whichever section was open on the phone,
                      and two of ten are of the old switch rather than the new
                      one. Deleting and re-uploading over a site's LTE is why
                      the wrong ones used to just stay put. */}
                  {(item.isOwn || canUpload) && rules.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="ml-auto"
                      aria-label={`Move from ${label}`}
                      disabled={pending}
                      onClick={() =>
                        setMoving(moving === item.id ? null : item.id)
                      }
                    >
                      <ArrowRightLeft /> Move
                    </Button>
                  )}
                  {(item.isOwn || canUpload) && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className={rules.length > 1 ? "" : "ml-auto"}
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

                {moving === item.id ? (
                  <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-raised p-2">
                    <Select
                      aria-label="Move to section"
                      defaultValue=""
                      disabled={pending}
                      onChange={(event) => {
                        const target = rules.find(
                          (option) => ruleKey(option) === event.target.value,
                        );
                        if (target) move(item.id, target);
                      }}
                    >
                      <option value="" disabled>
                        Move to…
                      </option>
                      {rules
                        .filter((option) => ruleKey(option) !== key)
                        .map((option) => (
                          <option
                            key={ruleKey(option)}
                            value={ruleKey(option)}
                          >
                            {option.category === "CUSTOM" && option.customLabel
                              ? option.customLabel
                              : DELIVERABLE_META[option.category].label}
                          </option>
                        ))}
                    </Select>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => setMoving(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                ) : null}

                {item.textValue ? (
                  item.category === "RETURN_LABELS" ? (
                    // One box, one number, one row. A pile of them run together
                    // in a paragraph is unreadable and unquotable.
                    <div className="flex flex-col gap-1">
                      {item.textValue
                        .split("\n")
                        .map((line) => line.trim())
                        .filter(Boolean)
                        .map((line, index) => (
                          <span
                            // The same number can legitimately appear twice —
                            // two boxes on one label run, a pasted repeat — and
                            // keying on the text drops one of them.
                            key={`${index}-${line}`}
                            className="tabular w-fit rounded border border-border px-2 py-0.5 text-sm"
                          >
                            {line}
                          </span>
                        ))}
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap text-sm">
                      {item.textValue}
                    </p>
                  )
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

  // A return usually goes back in more than one box, and the numbers are long
  // enough that typing them into one field separated by something is how a
  // digit gets lost. One field each, added as needed.
  const asTracking = rule.category === "RETURN_LABELS";
  const [numbers, setNumbers] = React.useState<
    { id: number; value: string }[]
  >([{ id: 0, value: "" }]);
  const nextId = React.useRef(1);

  const textValue = asTracking
    ? numbers
        .map((entry) => entry.value.trim())
        .filter(Boolean)
        // Stored one per line; the report joins them with commas.
        .join("\n")
    : text;

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
      if (textValue && index === 0) formData.set("textValue", textValue);
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
      if (textValue) formData.set("textValue", textValue);

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
        asTracking ? (
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Tracking numbers
            </span>

            {numbers.map((entry, index) => (
              <div key={entry.id} className="flex items-center gap-2">
                <Input
                  aria-label={`Tracking number ${index + 1}`}
                  value={entry.value}
                  autoComplete="off"
                  inputMode="text"
                  onChange={(event) =>
                    setNumbers((was) =>
                      was.map((row) =>
                        row.id === entry.id
                          ? { ...row, value: event.target.value }
                          : row,
                      ),
                    )
                  }
                />
                {numbers.length > 1 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove tracking number ${index + 1}`}
                    onClick={() =>
                      setNumbers((was) =>
                        was.filter((row) => row.id !== entry.id),
                      )
                    }
                  >
                    <X />
                  </Button>
                ) : null}
              </div>
            ))}

            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="self-start"
              onClick={() =>
                setNumbers((was) => [
                  ...was,
                  { id: nextId.current++, value: "" },
                ])
              }
            >
              <Plus /> Another tracking number
            </Button>

            <p className="text-xs text-muted-foreground">
              They reach “Return track #” on the report as one list, separated
              by commas.
            </p>
          </div>
        ) : (
          <Field label="Details" htmlFor="deliverable-text">
            <Textarea
              id="deliverable-text"
              value={text}
              rows={3}
              onChange={(event) => setText(event.target.value)}
            />
          </Field>
        )
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
          disabled={pending || (files.length === 0 && !textValue)}
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
