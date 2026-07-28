"use client";

import { AutosaveText } from "@/components/autosave-text";
import { saveMergedWorkPerformed, saveWorkPerformed } from "./actions";

/**
 * Work Performed is written per tech and merged afterwards.
 *
 * Each person owns their own entry; the lead tech (or a supervisor) assembles
 * the version that goes to the client. Until that merge exists, the export
 * prefixes each contribution with its author, which is why nobody edits anyone
 * else's text here.
 */
export function WorkPerformed({
  jobId,
  own,
  others,
  merged,
  canWrite,
  canMerge,
}: {
  jobId: string;
  own: string | null;
  others: { name: string; text: string }[];
  merged: string | null;
  canWrite: boolean;
  canMerge: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      {canWrite ? (
        <AutosaveText
          label="Your work performed"
          initialValue={own ?? ""}
          rows={5}
          placeholder="What you did, what you found, anything the client needs to know."
          save={async (value) => {
            const formData = new FormData();
            formData.set("jobId", jobId);
            formData.set("value", value);
            return saveWorkPerformed(formData);
          }}
        />
      ) : own ? (
        <Entry name="Your entry" text={own} />
      ) : null}

      {others.map((entry) => (
        <Entry key={entry.name} name={entry.name} text={entry.text} />
      ))}

      {canMerge ? (
        <AutosaveText
          label="Merged summary"
          hint="What actually goes to the client. Leave it blank to export each tech's entry prefixed with their name."
          initialValue={merged ?? ""}
          rows={6}
          save={async (value) => {
            const formData = new FormData();
            formData.set("jobId", jobId);
            formData.set("value", value);
            return saveMergedWorkPerformed(formData);
          }}
        />
      ) : merged ? (
        <Entry name="Merged summary" text={merged} />
      ) : null}
    </div>
  );
}

function Entry({ name, text }: { name: string; text: string }) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {name}
      </div>
      <p className="whitespace-pre-wrap text-sm">{text}</p>
    </div>
  );
}
