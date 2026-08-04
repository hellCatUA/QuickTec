"use client";

import { Check, Loader2, RefreshCw, Undo2, Wand2 } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/field";
import { PdfPage } from "@/components/pdf-page";
import { boxFingerprint, type DraftBox } from "@/lib/forms/box";
import { cn } from "@/lib/utils";
import { attachFilledForm, saveFormEntries } from "./actions";

/**
 * Reading the sheet before it goes anywhere, one box at a time.
 *
 * The app fills what it knows. The rest of a real sign-off sheet is somebody's
 * judgement — a travel time, a tick against "site not ready", a phone number
 * we never held — and this is where that gets typed instead of written on a
 * printout.
 *
 * Boxes are ticked off as they are read, and a ticked box greys out and drops
 * to the bottom. What is left at the top is what still needs looking at, which
 * on a thirty-box form is the difference between checking it and scrolling
 * past it.
 */

const PAGE_WIDTH = 620;

type Box = DraftBox;

export function SignOffReview({
  jobId,
  templateId,
  pageCount,
  pageWidth,
  pageHeight,
  boxes: initial,
  attachedId,
}: {
  jobId: string;
  templateId: string;
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
  // Ticked boxes sink. Within each half the form's own order is kept, so the
  // list still reads down the page rather than jumping about.
  const ordered = [
    ...onThisPage.filter((box) => !box.approved),
    ...onThisPage.filter((box) => box.approved),
  ];

  const approved = boxes.filter((box) => box.approved).length;
  const left = boxes.length - approved;

  function patch(placementId: string, next: Partial<Box>) {
    setDone(null);
    setBoxes((current) =>
      current.map((box) =>
        box.placementId === placementId ? { ...box, ...next } : box,
      ),
    );
  }

  function change(placementId: string, value: string) {
    setDirty(true);
    // Typing into a box un-ticks it: what was approved is no longer what is
    // there, and a tick that outlives its value is worse than no tick.
    patch(placementId, { entered: value, approved: false });
  }

  /** Hands a box back to the mapping after somebody typed over it. */
  function reset(placementId: string) {
    setDirty(true);
    patch(placementId, { entered: null, approved: false });
  }

  function toggleApproved(box: Box) {
    setDirty(true);
    patch(box.placementId, { approved: !box.approved });
  }

  function approveAllOnPage() {
    setDirty(true);
    setDone(null);
    setBoxes((current) =>
      current.map((box) => (box.page === page ? { ...box, approved: true } : box)),
    );
  }

  /** The rows as the server wants them. */
  function payload(list: Box[]) {
    return JSON.stringify({
      jobId,
      templateId,
      entries: list
        .filter((box) => box.entered !== null || box.approved)
        .map((box) => ({
          placementId: box.placementId,
          value: box.entered,
          approvedValue: box.approved ? boxFingerprint(box) : null,
        })),
    });
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("payload", payload(boxes));
      const result = await saveFormEntries(null, formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDirty(false);
      setPreviewKey((key) => key + 1);
    });
  }

  function attach() {
    setError(null);
    setDone(null);
    startTransition(async () => {
      // Saved first, so what is attached is what is on screen rather than what
      // was on screen the last time somebody pressed save.
      const formData = new FormData();
      formData.set("payload", payload(boxes));
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
      setPreviewKey((key) => key + 1);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={left === 0 ? "success" : "neutral"}>
          {left === 0
            ? `All ${boxes.length} boxes checked`
            : `${left} of ${boxes.length} left to check`}
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
          {onThisPage.some((box) => !box.approved) ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={approveAllOnPage}
            >
              <Check /> Check the rest off
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={pending || !dirty}
            onClick={save}
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
        <div className="relative shrink-0 self-start overflow-auto rounded-xl border border-border lg:sticky lg:top-4">
          <div className="relative" style={{ width: PAGE_WIDTH }}>
            <PdfPage
              key={previewKey}
              url={`/api/jobs/${jobId}/sign-off/${templateId}/preview?v=${previewKey}`}
              page={page}
              width={PAGE_WIDTH}
            />

            {/* The box being read, marked on the page. A form has thirty of
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
          {ordered.map((box) => (
            <BoxRow
              key={box.placementId}
              box={box}
              selected={box.placementId === selected}
              pending={pending}
              onSelect={() => setSelected(box.placementId)}
              onChange={(value) => change(box.placementId, value)}
              onReset={() => reset(box.placementId)}
              onToggleApproved={() => toggleApproved(box)}
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
  pending,
  onSelect,
  onChange,
  onReset,
  onToggleApproved,
}: {
  box: Box;
  selected: boolean;
  pending: boolean;
  onSelect: () => void;
  onChange: (value: string) => void;
  onReset: () => void;
  onToggleApproved: () => void;
}) {
  const overridden = box.entered !== null;
  const value = overridden ? (box.entered ?? "") : (box.resolved ?? "");
  // A box for a paragraph gets a box to type a paragraph into.
  const long = box.height > 40;

  const name =
    box.sourceLabel ??
    box.fieldName ??
    `Box at ${Math.round(box.x)}, ${Math.round(box.y)}`;

  /** What the box will actually carry, which is what the badge should say. */
  const has = box.isImage ? box.hasImage : Boolean(value.trim());

  return (
    <div
      onFocus={onSelect}
      onClick={onSelect}
      className={cn(
        "flex flex-col gap-1.5 rounded-lg border p-3 transition-opacity",
        box.approved
          ? "border-border bg-muted/40 opacity-55"
          : selected
            ? "border-[var(--color-primary)] bg-surface-raised"
            : "border-border",
      )}
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-sm font-medium">{name}</span>

        {/* What the box actually holds, not merely where it would come from.
            Saying "filled" over an empty signature is how somebody attaches a
            sheet believing it has one. */}
        {box.source && has ? (
          <Badge variant="neutral">
            <Wand2 className="mr-1 size-3" />
            filled
          </Badge>
        ) : box.source ? (
          <Badge variant="warning">nothing to fill it with yet</Badge>
        ) : (
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

        <div className="ml-auto flex items-center gap-2">
          {overridden ? (
            <button
              type="button"
              onClick={onReset}
              className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              back to the filled value
            </button>
          ) : null}

          <Button
            type="button"
            size="sm"
            variant={box.approved ? "ghost" : "secondary"}
            disabled={pending}
            onClick={(event) => {
              event.stopPropagation();
              onToggleApproved();
            }}
          >
            {box.approved ? (
              <>
                <Undo2 /> Checked
              </>
            ) : (
              <>
                <Check /> Check off
              </>
            )}
          </Button>
        </div>
      </div>

      {box.isImage ? (
        <p className="text-sm text-muted-foreground">
          {box.hasImage
            ? "The signature captured on site goes here."
            : "Nothing signed yet — this box stays empty until it is."}
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
