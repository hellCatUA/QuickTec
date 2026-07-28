"use client";

import { AlertTriangle, MessageSquarePlus, Pencil } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/field";
import type { FieldAction } from "@/lib/job-fields";
import { cn } from "@/lib/utils";
import { saveJobField, suggestChange } from "./actions";

/**
 * One planned field on the job page.
 *
 * Scheduled work is read-only by default. What a person can do to a field
 * depends on both the field and them, and is decided on the server — this
 * component only renders the outcome:
 *
 *   edit     write it directly
 *   fill     the field is blank; anyone on the job may complete it
 *   suggest  it holds a value they cannot overwrite, so it goes to a supervisor
 *   none     read-only
 *
 * A blank required field is called out in amber rather than left looking
 * finished, because on site the difference matters.
 */
export function EditableField({
  jobId,
  field,
  label,
  value,
  displayValue,
  action,
  kind = "text",
  hint,
  className,
}: {
  jobId: string;
  field: string;
  label: string;
  value: string;
  displayValue?: string;
  action: FieldAction;
  kind?: "text" | "number" | "datetime" | "markdown";
  hint?: string;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState(value);
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [sent, setSent] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  const isEmpty = value.trim() === "";
  const suggesting = action === "suggest";

  function submit() {
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("jobId", jobId);
      formData.set("field", field);
      formData.set("value", draft);

      if (suggesting) {
        formData.set("reason", reason);
        const result = await suggestChange(null, formData);
        if (!result.ok) return setError(result.error);
        setSent(true);
        setOpen(false);
        return;
      }

      const result = await saveJobField(formData);
      if (!result.ok) return setError(result.error);
      setOpen(false);
    });
  }

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>

        {action !== "none" && !open ? (
          <button
            type="button"
            onClick={() => {
              setDraft(value);
              setOpen(true);
            }}
            className="text-muted-foreground transition-colors hover:text-primary"
            aria-label={
              suggesting ? `Suggest a change to ${label}` : `Edit ${label}`
            }
            title={suggesting ? "Suggest change" : "Edit"}
          >
            {suggesting ? (
              <MessageSquarePlus className="size-3.5" />
            ) : (
              <Pencil className="size-3.5" />
            )}
          </button>
        ) : null}
      </div>

      {open ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-raised p-2">
          {kind === "markdown" ? (
            <Textarea
              value={draft}
              rows={6}
              onChange={(event) => setDraft(event.target.value)}
              autoFocus
            />
          ) : (
            <Input
              value={draft}
              type={
                kind === "number"
                  ? "number"
                  : kind === "datetime"
                    ? "datetime-local"
                    : "text"
              }
              onChange={(event) => setDraft(event.target.value)}
              autoFocus
            />
          )}

          {suggesting ? (
            <Input
              value={reason}
              placeholder="Why? (optional, helps whoever reviews it)"
              onChange={(event) => setReason(event.target.value)}
            />
          ) : null}

          {error ? <p className="text-xs text-danger">{error}</p> : null}

          <div className="flex gap-2">
            <Button type="button" size="sm" disabled={pending} onClick={submit}>
              {suggesting ? "Send suggestion" : "Save"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => {
                setOpen(false);
                setError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-1.5 text-sm">
          {isEmpty ? (
            <span className="flex items-center gap-1 text-warning">
              <AlertTriangle className="size-3.5" />
              Missing
            </span>
          ) : (
            <span className="break-words">{displayValue ?? value}</span>
          )}
        </div>
      )}

      {sent ? (
        <p className="text-xs text-primary">
          Suggestion sent for approval.
        </p>
      ) : null}

      {hint && action !== "none" ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
