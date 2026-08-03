"use client";

import { Loader2, Upload } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { replaceBlank } from "./actions";

/**
 * Putting a revised blank behind an existing mapping.
 *
 * The one thing this screen must never do quietly. A company sends a new
 * version of their sheet with one extra line, the boxes all shift, and every
 * form after that goes out with the site number on the date line. So the
 * mapping survives only when the new file's own fields match by name, and when
 * it does not, the result says so in as many words rather than looking like it
 * worked.
 */
export function ReplaceBlank({ templateId }: { templateId: string }) {
  const [file, setFile] = React.useState<File | null>(null);
  const [message, setMessage] = React.useState<
    { kind: "ok" | "warn"; text: string } | null
  >(null);
  const [pending, startTransition] = React.useTransition();

  function run() {
    if (!file) return;
    setMessage(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("templateId", templateId);
      formData.set("file", file);

      const result = await replaceBlank(null, formData);
      setFile(null);
      setMessage(
        result.ok
          ? { kind: "ok", text: "Replaced. The mapping carried across." }
          : { kind: "warn", text: result.error },
      );
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">
        Jobs that already went out keep their own copy, so this cannot change
        what a finished job was sent on. The mapping is only kept if the new
        file has the same fields — otherwise every box has to be pointed at its
        value again.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-border px-3 text-sm">
          <Upload className="size-4" />
          {file ? file.name : "Choose the new blank"}
          <input
            type="file"
            accept="application/pdf,image/*"
            className="sr-only"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </label>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={!file || pending}
          onClick={run}
        >
          {pending ? <Loader2 className="animate-spin" /> : null}
          {pending ? "Replacing" : "Replace"}
        </Button>
      </div>

      {message ? (
        <p
          className={
            message.kind === "ok"
              ? "text-sm text-muted-foreground"
              : "text-sm text-danger"
          }
        >
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
