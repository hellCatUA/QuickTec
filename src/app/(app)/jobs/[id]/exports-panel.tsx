"use client";

import { Check, Copy, FileArchive, FileText, Printer } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";

/**
 * The three ways a job leaves the system.
 *
 * The text report is rendered on the server and shipped with the page rather
 * than fetched, so it is there to copy even when the signal has gone — pasting
 * it into an email is what actually happens most days, and a spinner would be
 * the wrong answer at that moment.
 */
export function ExportsPanel({
  jobId,
  report,
  canText,
  canZip,
  canPdf,
}: {
  jobId: string;
  report: string | null;
  canText: boolean;
  canZip: boolean;
  canPdf: boolean;
}) {
  const [copied, setCopied] = React.useState(false);

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
            {copied ? "Copied" : "Copy report"}
          </Button>
        ) : null}

        {canText ? (
          <a href={`/api/jobs/${jobId}/export/text`}>
            <Button type="button" size="sm" variant="secondary">
              <FileText /> Report .txt
            </Button>
          </a>
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

      {canText && report ? (
        <textarea
          id="text-report"
          readOnly
          value={report}
          rows={19}
          // Monospace and no wrapping: this is a fixed-width form the client
          // reads line by line, and rewrapping it hides missing values.
          className="w-full resize-y overflow-x-auto whitespace-pre rounded-lg border border-border bg-input p-3 font-mono text-xs"
        />
      ) : null}
    </div>
  );
}
