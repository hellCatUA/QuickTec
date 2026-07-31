"use client";

import { Loader2 } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { setSiteNumber } from "./actions";

/**
 * The site number, when nobody knew it at the time.
 *
 * Dispatch reads out a customer and a city often enough that demanding the
 * number up front means either a made-up one or no job at all. The person best
 * placed to supply it is standing in front of the door, so they are the one
 * asked — and asked here, on the page they already have open, rather than in
 * the directory.
 */
export function SiteNumberPrompt({
  jobId,
  canSet,
}: {
  jobId: string;
  canSet: boolean;
}) {
  const [value, setValue] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  if (!canSet) {
    return (
      <span className="text-warning">Site number not recorded yet</span>
    );
  }

  function save() {
    if (!value.trim()) return;
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("jobId", jobId);
      formData.set("siteNumber", value);
      const result = await setSiteNumber(formData);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="Site number"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              save();
            }
          }}
          placeholder="Read it off the door"
          className="max-w-44"
        />
        <Button type="button" size="sm" disabled={pending || !value.trim()} onClick={save}>
          {pending ? <Loader2 className="animate-spin" /> : null}
          Save
        </Button>
      </div>
      <span className="text-xs text-muted-foreground">
        Not known when this job was raised.
      </span>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
    </div>
  );
}
