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
  const [copied, setCopied] = React.useState(false);
  const hasUpdated = Boolean(forms && forms.updated.length > 0);
  const [version, setVersion] = React.useState<Version>(
    hasUpdated ? "updated" : "legacy",
  );
  const [techId, setTechId] = React.useState(forms?.updated[0]?.assignmentId ?? "");
  const [open, setOpen] = React.useState(false);
  const menuRoot = React.useRef<HTMLDivElement>(null);

  // The choice folds away on a tap anywhere else, as any menu does.
  React.useEffect(() => {
    if (!open) return;
    function away(event: PointerEvent) {
      if (!menuRoot.current?.contains(event.target as Node)) setOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const shown = version === "updated" && hasUpdated ? "updated" : "legacy";
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
    } catch {
      // Safari refuses the clipboard API outside a user gesture chain and on
      // insecure origins; select the text so it can still be copied by hand.
      const area = document.getElementById("text-report") as HTMLTextAreaElement | null;
      area?.select();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {canText && report ? (
          <Button type="button" size="sm" onClick={copy}>
            {copied ? <Check /> : <Copy />}
            {copied ? "Copied" : "Copy WM Form"}
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
              type="button"
              aria-label="Which WM Form"
              aria-haspopup="menu"
              aria-expanded={open}
              onClick={() => setOpen((was) => !was)}
              className="inline-flex min-h-9 items-center rounded-r-lg border border-l-0 border-border bg-surface-raised px-2 text-foreground transition-colors hover:bg-muted"
            >
              <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
            </button>
            {open ? (
              <div
                role="menu"
                className="absolute left-0 top-10 z-10 flex w-max min-w-full flex-col rounded-xl border border-border bg-surface-raised p-1 shadow-xl"
              >
                {VERSIONS.map((option) => {
                  const disabled = option.value === "updated" && !hasUpdated;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="menuitemradio"
                      aria-checked={shown === option.value}
                      disabled={disabled}
                      onClick={() => {
                        setVersion(option.value);
                        setOpen(false);
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

      {/* Whose form, on a job with more than one tech: each sends their own. */}
      {canText && shown === "updated" && forms && forms.updated.length > 1 ? (
        <div role="radiogroup" aria-label="Whose WM Form" className="flex flex-wrap gap-1.5">
          {forms.updated.map((one) => (
            <button
              key={one.assignmentId}
              type="button"
              role="radio"
              aria-checked={one.assignmentId === tech?.assignmentId}
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
