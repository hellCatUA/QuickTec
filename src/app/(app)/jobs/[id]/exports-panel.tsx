"use client";

import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  FileArchive,
  Printer,
} from "lucide-react";
import * as React from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type WmForms = {
  /** One per tech whose pay this person may see, their own first. */
  updated: { assignmentId: string; tech: string; own: boolean; text: string }[];
  legacy: string;
};

type Version = "current" | "legacy";

/**
 * The three ways a job leaves the system.
 *
 * The WM Form is rendered on the server and shipped with the page rather than
 * fetched, so it is there to copy even when the signal has gone — pasting it
 * into an email is what actually happens most days, and a spinner would be
 * the wrong answer at that moment.
 *
 * One button copies it. Opened, the button itself becomes "Current" — the
 * form sent now — with "Legacy" under it for the odd job that still wants the
 * old one; either copies, and the button folds back to what it was.
 */
export function ExportsPanel({
  jobId,
  forms,
  canText,
  canZip,
  canPdf,
}: {
  jobId: string;
  forms: WmForms | null;
  canText: boolean;
  canZip: boolean;
  canPdf: boolean;
}) {
  const hasCurrent = Boolean(forms && forms.updated.length > 0);
  const [techId, setTechId] = React.useState(forms?.updated[0]?.assignmentId ?? "");
  const [open, setOpen] = React.useState(false);
  // What the box below shows: the last thing copied, the current form until
  // anything has been.
  const [shown, setShown] = React.useState<Version>("current");
  const [copied, setCopied] = React.useState<"copied" | "selected" | null>(null);
  const root = React.useRef<HTMLDivElement>(null);
  const button = React.useRef<HTMLButtonElement>(null);
  const legacyItem = React.useRef<HTMLButtonElement>(null);

  // The list folds away on a tap anywhere else, as any menu does, and when
  // focus moves on past it.
  React.useEffect(() => {
    if (!open) return;
    function away(event: Event) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", away);
    document.addEventListener("focusin", away);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("focusin", away);
    };
  }, [open]);

  const tech =
    forms?.updated.find((one) => one.assignmentId === techId) ?? forms?.updated[0];
  const current = tech?.text ?? null;
  const textOf = (version: Version) =>
    !forms ? null : version === "current" && current ? current : forms.legacy;
  const preview = textOf(hasCurrent ? shown : "legacy");

  async function copy(version: Version) {
    const text = textOf(version);
    setOpen(false);
    button.current?.focus();
    if (!text) return;
    setShown(version);
    try {
      await navigator.clipboard.writeText(text);
      setCopied("copied");
    } catch {
      // Safari refuses the clipboard API outside a user gesture chain and on
      // insecure origins; the form is put in the box below and selected so it
      // can still be copied by hand — and the button says so, rather than
      // claiming it was copied.
      requestAnimationFrame(() => {
        const area = document.getElementById("text-report") as HTMLTextAreaElement | null;
        area?.focus();
        area?.select();
      });
      setCopied("selected");
    }
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start gap-2">
        {canText && forms ? (
          <div ref={root} className="relative">
            {/* Closed, it opens the choice; open, it is the current form and
                copies it. Without a current form to offer — it shows pay this
                person may not see — it copies the legacy one straight away. */}
            <button
              ref={button}
              type="button"
              aria-haspopup={hasCurrent ? "menu" : undefined}
              aria-expanded={hasCurrent ? open : undefined}
              aria-label={
                open ? "Copy the current WM Form" : hasCurrent ? "WM Form" : "Copy the WM Form"
              }
              onClick={() => {
                if (!hasCurrent) return void copy("legacy");
                if (open) return void copy("current");
                setOpen(true);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape" && open) {
                  event.preventDefault();
                  setOpen(false);
                } else if (event.key === "ArrowDown" && open) {
                  event.preventDefault();
                  legacyItem.current?.focus();
                } else if (event.key === "ArrowDown" && hasCurrent) {
                  event.preventDefault();
                  setOpen(true);
                }
              }}
              className={buttonVariants({ size: "sm" })}
            >
              {copied === "copied" ? <Check /> : <Copy />}
              {copied === "selected" ? (
                "Selected — copy it"
              ) : (
                // Both words take the same room, so the button keeps its
                // width as it opens and the list under it does not jump.
                <span className="grid">
                  <span className={cn("col-start-1 row-start-1", open && "invisible")}>
                    WM Form
                  </span>
                  <span
                    aria-hidden={!open}
                    className={cn("col-start-1 row-start-1", !open && "invisible")}
                  >
                    Current
                  </span>
                </span>
              )}
              {hasCurrent ? open ? <ChevronUp /> : <ChevronDown /> : null}
            </button>

            {open ? (
              <div
                role="menu"
                aria-label="Other WM Form"
                className="absolute left-0 top-full z-10 mt-1 flex w-max min-w-full flex-col rounded-lg border border-border bg-surface-raised p-1 shadow-xl"
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setOpen(false);
                    button.current?.focus();
                  } else if (event.key === "ArrowUp") {
                    event.preventDefault();
                    button.current?.focus();
                  }
                }}
              >
                <button
                  ref={legacyItem}
                  type="button"
                  role="menuitem"
                  onClick={() => void copy("legacy")}
                  className="flex min-h-9 items-center rounded-md px-3 text-left text-xs font-medium hover:bg-muted"
                >
                  Legacy
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        {canZip ? (
          <a href={`/api/jobs/${jobId}/export/zip`}>
            <Button type="button" size="sm" variant="secondary">
              <FileArchive /> Full ZIP
            </Button>
          </a>
        ) : null}

        {canPdf ? (
          <a
            href={`/api/jobs/${jobId}/export/pdf?inline=1`}
            target="_blank"
            rel="noreferrer"
          >
            <Button type="button" size="sm" variant="secondary">
              <Printer /> Internal WO
            </Button>
          </a>
        ) : null}
      </div>

      {/* Why there is no current form: it says what each tech is paid. */}
      {canText && forms && !hasCurrent ? (
        <p className="text-xs text-muted-foreground">
          The current WM Form says what each tech is paid, so it is only offered
          to the tech and to whoever may see the crew&rsquo;s rates (View pay
          rates, under Settings → Roles). This copies the legacy form.
        </p>
      ) : null}

      {/* Whose form, on a job with more than one tech: each sends their own. */}
      {canText && forms && forms.updated.length > 1 ? (
        <div
          role="radiogroup"
          aria-label="Whose WM Form"
          className="flex flex-wrap gap-1.5"
          onKeyDown={(event) => {
            if (!["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(event.key)) {
              return;
            }
            event.preventDefault();
            const at = forms.updated.findIndex((one) => one.assignmentId === tech?.assignmentId);
            const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
            const next = forms.updated[(at + step + forms.updated.length) % forms.updated.length];
            setTechId(next.assignmentId);
            setShown("current");
            requestAnimationFrame(() =>
              document.getElementById(`wm-tech-${next.assignmentId}`)?.focus(),
            );
          }}
        >
          {forms.updated.map((one) => (
            <button
              key={one.assignmentId}
              id={`wm-tech-${one.assignmentId}`}
              type="button"
              role="radio"
              aria-checked={one.assignmentId === tech?.assignmentId}
              tabIndex={one.assignmentId === tech?.assignmentId ? 0 : -1}
              onClick={() => {
                setTechId(one.assignmentId);
                setShown("current");
              }}
              className={cn(
                "min-h-8 rounded-lg px-3 text-sm ring-1 ring-inset",
                one.assignmentId === tech?.assignmentId
                  ? "bg-primary/15 font-semibold text-primary ring-primary/40"
                  : "ring-border hover:bg-muted",
              )}
            >
              {one.tech}
            </button>
          ))}
        </div>
      ) : null}

      {canText && preview ? (
        <div className="flex flex-col gap-1">
          {hasCurrent ? (
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {shown === "current" ? "Current" : "Legacy"}
            </span>
          ) : null}
          <textarea
            id="text-report"
            aria-label={
              hasCurrent && shown === "current" ? "WM Form, current" : "WM Form, legacy"
            }
            readOnly
            value={preview}
            rows={Math.min(34, preview.split("\n").length + 1)}
            // Monospace and no wrapping: this is a fixed-width form the client
            // reads line by line, and rewrapping it hides missing values.
            className="w-full resize-y overflow-x-auto whitespace-pre rounded-lg border border-border bg-input p-3 font-mono text-xs"
          />
        </div>
      ) : null}
    </div>
  );
}
