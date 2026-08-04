"use client";

import { Check, Loader2, RefreshCw, Wand2 } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/field";
import { PdfPage } from "@/components/pdf-page";
import type { DraftBox } from "@/lib/forms/draft";
import { cn } from "@/lib/utils";
import { attachFilledForm, saveFormEntries } from "./actions";

/**
 * Reading the sheet before it goes anywhere.
 *
 * The app fills what it knows. The rest of a real sign-off sheet is somebody's
 * judgement — a travel time, a tick against "site not ready", a phone number
 * we never held — and this is where that gets typed instead of written on a
 * printout. The page beside the list is the same document that will be
 * attached, produced the same way, so what is checked is what is signed.
 */

const PAGE_WIDTH = 620;

type Box = DraftBox;

export function SignOffReview({
  jobId,
  templateId,
  templateLabel,
  pageCount,
  pageWidth,
  pageHeight,
  boxes: initial,
  attachedId,
}: {
  jobId: string;
  templateId: string;
  templateLabel: string;
  pageCount: number;
  pageWidth: number;
  pageHeight: number;
  boxes: Box[];
  /** The filled copy already on the job, if this has been done before. */
  attachedId: string | null;
}) {
  const router = useRouter();
  const [boxes, setBoxes] = React.useState(initial);
  const [page, setPage] = React.useState(0);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<string | null>(null);
  const [dirty, setDirty] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  // Bumped to re-fetch the preview after a save, since the URL is otherwise
  // identical and the browser would show the last render.
  const [previewKey, setPreviewKey] = React.useState(0);

  const scale = PAGE_WIDTH / pageWidth;
  const onThisPage = boxes.filter((box) => box.page === page);

  /** What a box will actually say. */
  function valueOf(box: Box): string | null {
    if (box.entered !== null) return box.entered.trim() || null;
    return box.resolved;
  }

  const filled = boxes.filter((box) => box.isImage || valueOf(box)).length;

  function change(placementId: string, value: string) {
    setDirty(true);
    setDone(null);
    setBoxes((current) =>
      current.map((box) =>
        box.placementId === placementId ? { ...box, entered: value } : box,
      ),
    );
  }

  /** Hands a box back to the mapping after somebody typed over it. */
  function reset(placementId: string) {
    setDirty(true);
    setDone(null);
    setBoxes((current) =>
      current.map((box) =>
        box.placementId === placementId ? { ...box, entered: null } : box,
      ),
    );
  }

  function save(then?: () => void) {
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set(
        "payload",
        JSON.stringify({
          jobId,
          templateId,
          entries: boxes
            .filter((box) => box.entered !== null)
            .map((box) => ({ placementId: box.placementId, value: box.entered })),
        }),
      );

      const result = await saveFormEntries(null, formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDirty(false);
      setPreviewKey((key) => key + 1);
      then?.();
    });
  }

  function attach() {
    setError(null);
    setDone(null);
    startTransition(async () => {
      // Saved first, so what is attached is what is on screen rather than what
      // was on screen the last time somebody pressed save.
      const formData = new FormData();
      formData.set(
        "payload",
        JSON.stringify({
          jobId,
          templateId,
          entries: boxes
            .filter((box) => box.entered !== null)
            .map((box) => ({ placementId: box.placementId, value: box.entered })),
        }),
      );
      const saved = await saveFormEntries(null, formData);
      if (!saved.ok) {
        setError(saved.error);
        return;
      }
      setDirty(false);

      const attachData = new FormData();
      attachData.set("jobId", jobId);
      attachData.set("templateId", templateId);
      const result = await attachFilledForm(attachData);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDone(
        result.empty === 0
          ? "Attached to the job. Every box has something in it."
          : `Attached to the job. ${result.empty} box${result.empty === 1 ? "" : "es"} left blank for the site.`,
      );
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={filled === boxes.length ? "primary" : "neutral"}>
          {filled} of {boxes.length} boxes have a value
        </Badge>
        {attachedId ? (
          <a
            href={`/api/files/${attachedId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            The copy already on the job
          </a>
        ) : null}

        {pageCount > 1 ? (
          <div className="flex items-center gap-1">
            {Array.from({ length: pageCount }, (_, index) => (
              <Button
                key={index}
                type="button"
                size="sm"
                variant={index === page ? "primary" : "ghost"}
                onClick={() => setPage(index)}
              >
                Page {index + 1}
              </Button>
            ))}
          </div>
        ) : null}

        <div className="ml-auto flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={pending || !dirty}
            onClick={() => save()}
          >
            {pending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            Update the preview
          </Button>
          <Button type="button" size="sm" disabled={pending} onClick={attach}>
            {pending ? <Loader2 className="animate-spin" /> : <Check />}
            {attachedId ? "Replace the one on the job" : "Attach to the job"}
          </Button>
        </div>
      </div>

      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {done ? <p className="text-sm text-muted-foreground">{done}</p> : null}
      {dirty ? (
        <p className="text-sm text-muted-foreground">
          The preview is behind what you have typed — update it to see the
          change, or attach, which saves first either way.
        </p>
      ) : null}

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="relative shrink-0 overflow-auto rounded-xl border border-border">
          <div className="relative" style={{ width: PAGE_WIDTH }}>
            <PdfPage
              key={previewKey}
              url={`/api/jobs/${jobId}/sign-off/${templateId}/preview?v=${previewKey}`}
              page={page}
              width={PAGE_WIDTH}
            />

            {/* The box being edited, marked on the page. A form has thirty of
                them and half are called "Text19". */}
            {onThisPage.map((box) =>
              box.placementId === selected ? (
                <span
                  key={box.placementId}
                  aria-hidden
                  className="pointer-events-none absolute rounded-[2px] border-2 border-[var(--color-primary)] bg-[var(--color-primary)]/20"
                  style={{
                    left: box.x * scale,
                    top: (pageHeight - box.y - box.height) * scale,
                    width: Math.max(6, box.width * scale),
                    height: Math.max(6, box.height * scale),
                  }}
                />
              ) : null,
            )}
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {onThisPage.map((box) => (
            <BoxRow
              key={box.placementId}
              box={box}
              selected={box.placementId === selected}
              onSelect={() => setSelected(box.placementId)}
              onChange={(value) => change(box.placementId, value)}
              onReset={() => reset(box.placementId)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function BoxRow({
  box,
  selected,
  onSelect,
  onChange,
  onReset,
}: {
  box: Box;
  selected: boolean;
  onSelect: () => void;
  onChange: (value: string) => void;
  onReset: () => void;
}) {
  const overridden = box.entered !== null;
  const value = overridden ? (box.entered ?? "") : (box.resolved ?? "");
  // A box for a paragraph gets a box to type a paragraph into.
  const long = box.height > 40;

  const name =
    box.sourceLabel ??
    box.fieldName ??
    `Box at ${Math.round(box.x)}, ${Math.round(box.y)}`;

  return (
    <div
      onFocus={onSelect}
      onClick={onSelect}
      className={cn(
        "flex flex-col gap-1.5 rounded-lg border p-3",
        selected
          ? "border-[var(--color-primary)] bg-surface-raised"
          : "border-border",
      )}
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-sm font-medium">{name}</span>

        {box.source ? (
          <Badge variant="neutral">
            <Wand2 className="mr-1 size-3" />
            filled
          </Badge>
        ) : (
          // The boxes the mapping does not cover — the reason this screen
          // exists rather than a button that just produces a PDF.
          <Badge variant="warning">by hand</Badge>
        )}

        {box.fieldName && box.sourceLabel ? (
          <span className="text-xs text-muted-foreground">{box.fieldName}</span>
        ) : null}
        {box.sampleText && !box.sourceLabel ? (
          <span className="min-w-0 truncate text-xs text-muted-foreground">
            was “{box.sampleText.slice(0, 40)}”
          </span>
        ) : null}

        {overridden ? (
          <button
            type="button"
            onClick={onReset}
            className="ml-auto text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            back to the filled value
          </button>
        ) : null}
      </div>

      {box.isImage ? (
        <p className="text-sm text-muted-foreground">
          {box.resolved === null
            ? "The signature goes here once it is captured on site."
            : "The signature captured on site."}
        </p>
      ) : long ? (
        <Textarea
          rows={4}
          value={value}
          aria-label={name}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <Input
          value={value}
          aria-label={name}
          placeholder={box.source ? "" : "Left for the site"}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </div>
  );
}
