"use client";

import { FileText, Loader2, Upload, Wand2, X } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { deleteClientTemplate, saveClientTemplate } from "../actions";

export type TemplateRecord = {
  id: string;
  kind: "CLIENT_WORK_ORDER" | "SIGN_OFF";
  label: string;
  isDefault: boolean;
  attachmentId: string;
  /** Boxes on the blank, and how many of them are pointed at a value. */
  boxCount: number;
  mappedCount: number;
};

const KIND_LABELS = {
  CLIENT_WORK_ORDER: "Work order",
  SIGN_OFF: "Sign-off sheet",
} as const;

/**
 * The blank forms this company always uses.
 *
 * Mostly the sign-off sheet: the same PDF every time, filled in on site and
 * signed by whoever is on duty. Keeping it here means a job is raised with the
 * current one attached instead of whichever copy happened to be in the tech's
 * downloads folder.
 */
export function ClientTemplates({
  clientId,
  templates,
}: {
  clientId: string;
  templates: TemplateRecord[];
}) {
  const [adding, setAdding] = React.useState(false);
  const [kind, setKind] =
    React.useState<TemplateRecord["kind"]>("SIGN_OFF");
  const [label, setLabel] = React.useState("");
  const [isDefault, setIsDefault] = React.useState(true);
  const [file, setFile] = React.useState<File | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function save() {
    if (!file) return;
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("clientId", clientId);
      formData.set("kind", kind);
      formData.set("label", label);
      if (isDefault) formData.set("isDefault", "on");
      formData.set("file", file);

      const result = await saveClientTemplate(null, formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setFile(null);
      setLabel("");
      setAdding(false);
    });
  }

  function remove(id: string) {
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("id", id);
      const result = await deleteClientTemplate(formData);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Default forms
      </div>

      {templates.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          None yet. Add their sign-off sheet and every job for them starts with
          it attached.
        </p>
      ) : (
        templates.map((template) => (
          <div
            key={template.id}
            className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-sm"
          >
            <FileText className="size-4 shrink-0 text-muted-foreground" />
            <a
              href={`/api/files/${template.attachmentId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="min-w-0 flex-1 truncate underline-offset-2 hover:underline"
            >
              {template.label}
            </a>
            <Badge variant="neutral">{KIND_LABELS[template.kind]}</Badge>
            {template.isDefault ? (
              <Badge variant="primary">Default</Badge>
            ) : null}

            {/* Whether this form fills itself, and what is left to do about
                it. A blank nobody mapped is a blank the tech types out by
                hand, which is the thing worth surfacing here. */}
            <Link
              href={`/directory/clients/${clientId}/forms/${template.id}`}
              className="flex min-h-9 items-center gap-1 rounded-lg px-2 text-xs text-muted-foreground underline-offset-2 hover:bg-muted hover:text-foreground hover:underline"
            >
              <Wand2 className="size-3.5" />
              {template.mappedCount > 0
                ? `Fills ${template.mappedCount} of ${template.boxCount} boxes`
                : "Set up autofill"}
            </Link>

            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remove ${template.label}`}
              disabled={pending}
              onClick={() => remove(template.id)}
            >
              <X />
            </Button>
          </div>
        ))
      )}

      {error ? <p className="text-sm text-danger">{error}</p> : null}

      {adding ? (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-raised p-3">
          <Field label="What is it" htmlFor={`tpl-kind-${clientId}`}>
            <Select
              id={`tpl-kind-${clientId}`}
              value={kind}
              onChange={(event) =>
                setKind(event.target.value as TemplateRecord["kind"])
              }
            >
              <option value="SIGN_OFF">Sign-off sheet</option>
              <option value="CLIENT_WORK_ORDER">Work order</option>
            </Select>
          </Field>

          <Field
            label="Name"
            htmlFor={`tpl-label-${clientId}`}
            hint="What it is called when it is offered on a job. Defaults to the file name."
          >
            <Input
              id={`tpl-label-${clientId}`}
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="NetCom sign-off 2026"
            />
          </Field>

          <label className="flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border px-3 text-sm">
            <Upload className="size-4" />
            {file ? file.name : "Choose the blank (PDF or photo)"}
            <input
              type="file"
              accept="image/*,application/pdf"
              className="sr-only"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isDefault}
              onChange={(event) => setIsDefault(event.target.checked)}
              className="size-5 accent-[var(--color-primary)]"
            />
            Offer it already ticked on a new job
          </label>

          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={pending || !file}
              onClick={save}
            >
              {pending ? <Loader2 className="animate-spin" /> : null}
              {pending ? "Uploading" : "Add form"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setAdding(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={() => setAdding(true)}
        >
          <Upload /> Add a default form
        </Button>
      )}
    </div>
  );
}
