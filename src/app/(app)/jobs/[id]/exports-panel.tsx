"use client";

import {
  Check,
  ChevronDown,
  Copy,
  FileArchive,
  FileText,
  Printer,
} from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type WmForms = {
  /** One per tech whose pay this person may see, their own first. */
  updated: { assignmentId: string; tech: string; own: boolean; text: string }[];
  legacy: string;
};

type Version = "updated" | "legacy";

const VERSIONS: { value: Version; label: string }[] = [
  { value: "updated", label: "Updated (10/2026)" },
  { value: "legacy", label: "Legacy" },
];

/**
 * The three ways a job leaves the system.
 *
 * The WM Form is rendered on the server and shipped with the page rather than
 * fetched, so it is there to copy even when the signal has gone — pasting it
 * into an email is what actually happens most days, and a spinner would be
 * the wrong answer at that moment.
 *
 * It comes in two versions. The updated one is what is sent now and what the
 * button gives; the arrow beside it opens the choice, for the odd job that
 * still wants the legacy form.
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
  const [copied, setCopied] = React.useState<"copied" | "selected" | null>(null);
  const hasUpdated = Boolean(forms && forms.updated.length > 0);
  // Null until somebody picks: the updated form whenever there is one, even
  // if there was not when the page first loaded.
  const [version, setVersion] = React.useState<Version | null>(null);
  const [techId, setTechId] = React.useState(forms?.updated[0]?.assignmentId ?? "");
  const [open, setOpen] = React.useState(false);
  const menuRoot = React.useRef<HTMLDivElement>(null);
  const arrow = React.useRef<HTMLButtonElement>(null);
  const items = React.useRef<(HTMLButtonElement | null)[]>([]);

  // The choice folds away on a tap anywhere else, as any menu does, and when
  // focus moves on past it.
  React.useEffect(() => {
    if (!open) return;
    function away(event: Event) {
      if (!menuRoot.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", away);
    document.addEventListener("focusin", away);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("focusin", away);
    };
  }, [open]);

  const shown: Version =
    (version ?? (hasUpdated ? "updated" : "legacy")) === "updated" && hasUpdated
      ? "updated"
      : "legacy";

  function openMenu() {
    setOpen(true);
    // Into the menu, on the version shown.
    requestAnimationFrame(() =>
      items.current[shown === "updated" ? 0 : 1]?.focus(),
    );
  }

  function closeMenu() {
    setOpen(false);
    arrow.current?.focus();
  }

  function onMenuKey(event: React.KeyboardEvent) {
    const list = items.current.filter(
      (item): item is HTMLButtonElement => Boolean(item && !item.disabled),
    );
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      list[(at + step + list.length) % list.length]?.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeMenu();
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  }
  const tech =
    forms?.updated.find((one) => one.assignmentId === techId) ?? forms?.updated[0];
  const report = !forms ? null : shown === "updated" ? (tech?.text ?? null) : forms.legacy;
  const download =
    shown === "updated" && tech
      ? `/api/jobs/${jobId}/export/text?tech=${tech.assignmentId}`
      : `/api/jobs/${jobId}/export/text?form=legacy`;

  async function copy() {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(report);
      setCopied("copied");
    } catch {
      // Safari refuses the clipboard API outside a user gesture chain and on
      // insecure origins; select the text so it can still be copied by hand —
      // and say so, rather than claim it was copied.
      const area = document.getElementById("text-report") as HTMLTextAreaElement | null;
      area?.select();
      setCopied("selected");
    }
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {canText && report ? (
          <Button type="button" size="sm" onClick={copy}>
            {copied === "copied" ? <Check /> : <Copy />}
            {copied === "copied"
              ? "Copied"
              : copied === "selected"
                ? "Selected — copy it"
                : "Copy WM Form"}
          </Button>
        ) : null}

        {canText && forms ? (
          // One button that gives the form, and an arrow beside it for which
          // version: the updated one unless somebody asks otherwise.
          <div ref={menuRoot} className="relative flex">
            <a
              href={download}
              className="inline-flex min-h-9 items-center gap-2 rounded-l-lg border border-border bg-surface-raised px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted [&_svg]:size-4 [&_svg]:shrink-0"
            >
              <FileText />
              WM Form
              {shown === "legacy" ? (
                <span className="text-xs text-muted-foreground">· Legacy</span>
              ) : null}
            </a>
            <button
              ref={arrow}
              type="button"
              aria-label="Which WM Form"
              aria-haspopup="menu"
              aria-expanded={open}
              onClick={() => (open ? closeMenu() : openMenu())}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  openMenu();
                }
              }}
              className="inline-flex min-h-9 items-center rounded-r-lg border border-l-0 border-border bg-surface-raised px-2 text-foreground transition-colors hover:bg-muted"
            >
              <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
            </button>
            {open ? (
              <div
                role="menu"
                aria-label="Which WM Form"
                onKeyDown={onMenuKey}
                className="absolute left-0 top-10 z-10 flex w-max min-w-full flex-col rounded-xl border border-border bg-surface-raised p-1 shadow-xl"
              >
                {VERSIONS.map((option, index) => {
                  const disabled = option.value === "updated" && !hasUpdated;
                  return (
                    <button
                      key={option.value}
                      ref={(node) => {
                        items.current[index] = node;
                      }}
                      type="button"
                      role="menuitemradio"
                      aria-checked={shown === option.value}
                      disabled={disabled}
                      onClick={() => {
                        setVersion(option.value);
                        closeMenu();
                      }}
                      className="flex min-h-10 items-center gap-2 rounded-lg px-3 text-left text-sm hover:bg-muted disabled:opacity-50"
                    >
                      <Check
                        className={cn(
                          "size-4",
                          shown === option.value ? "opacity-100" : "opacity-0",
                        )}
                      />
                      {option.label}
                    </button>
                  );
                })}
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

      {/* Why there is no updated form: it says what each tech is paid. */}
      {canText && forms && !hasUpdated ? (
        <p className="text-xs text-muted-foreground">
          The updated form says what each tech is paid, so it is only offered to
          the tech and to whoever may see the crew&rsquo;s rates (View pay rates,
          under Settings → Roles). This is the legacy form.
        </p>
      ) : null}

      {/* Whose form, on a job with more than one tech: each sends their own. */}
      {canText && shown === "updated" && forms && forms.updated.length > 1 ? (
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
              onClick={() => setTechId(one.assignmentId)}
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

      {canText && report ? (
        <textarea
          id="text-report"
          aria-label={shown === "updated" ? "WM Form" : "WM Form, legacy"}
          readOnly
          value={report}
          rows={Math.min(34, report.split("\n").length + 1)}
          // Monospace and no wrapping: this is a fixed-width form the client
          // reads line by line, and rewrapping it hides missing values.
          className="w-full resize-y overflow-x-auto whitespace-pre rounded-lg border border-border bg-input p-3 font-mono text-xs"
        />
      ) : null}
    </div>
  );
}
