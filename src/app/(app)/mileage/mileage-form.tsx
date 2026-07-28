"use client";

import { Loader2, Plus, Upload } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { MILEAGE_META } from "@/lib/mileage";
import type { MileageCategory } from "@prisma-client";
import { saveMileage } from "./actions";

/**
 * Logging one leg of driving.
 *
 * The category list is already filtered by whether the tech is clocked in —
 * an on-clock supply run is not a thing you can log from your sofa — and the
 * server checks it again rather than trusting what the form sends.
 */
export function MileageForm({
  categories,
  clockedIn,
  currentJobId,
  jobs,
}: {
  categories: MileageCategory[];
  clockedIn: boolean;
  currentJobId: string | null;
  jobs: { id: string; label: string }[];
}) {
  const [open, setOpen] = React.useState(false);
  const [category, setCategory] = React.useState<MileageCategory>(
    categories[0] ?? "OTHER",
  );
  const [jobId, setJobId] = React.useState(currentJobId ?? "");
  const [startPhoto, setStartPhoto] = React.useState<File | null>(null);
  const [endPhoto, setEndPhoto] = React.useState<File | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  const formRef = React.useRef<HTMLFormElement>(null);
  const meta = MILEAGE_META[category];

  if (!open) {
    return (
      <Button
        type="button"
        variant="secondary"
        className="self-start"
        onClick={() => setOpen(true)}
      >
        <Plus /> Log a trip
      </Button>
    );
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const formData = new FormData(event.currentTarget);
    if (startPhoto) formData.set("startPhoto", startPhoto);
    if (endPhoto) formData.set("endPhoto", endPhoto);

    const result = await saveMileage(null, formData);
    setPending(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    formRef.current?.reset();
    setStartPhoto(null);
    setEndPhoto(null);
    setOpen(false);
  }

  return (
    <Card>
      <CardContent>
        <form ref={formRef} onSubmit={submit} className="flex flex-col gap-4">
          <Field label="Trip type" htmlFor="mileage-category" hint={meta.description}>
            <Select
              id="mileage-category"
              name="category"
              value={category}
              onChange={(event) =>
                setCategory(event.target.value as MileageCategory)
              }
            >
              {categories.map((option) => (
                <option key={option} value={option}>
                  {MILEAGE_META[option].label}
                </option>
              ))}
            </Select>
          </Field>

          {!clockedIn ? (
            <p className="text-xs text-muted-foreground">
              You are not clocked in, so the on-clock supply run option is
              hidden.
            </p>
          ) : null}

          {meta.requiresJob ? (
            <Field label="Job" htmlFor="mileage-job">
              <Select
                id="mileage-job"
                name="jobId"
                value={jobId}
                onChange={(event) => setJobId(event.target.value)}
                required
              >
                <option value="">Select a job…</option>
                {jobs.map((job) => (
                  <option key={job.id} value={job.id}>
                    {job.label}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Set off" htmlFor="mileage-start-at">
              <Input
                id="mileage-start-at"
                name="startedAt"
                type="datetime-local"
                required
              />
            </Field>
            <Field label="Arrived" htmlFor="mileage-end-at">
              <Input
                id="mileage-end-at"
                name="endedAt"
                type="datetime-local"
                required
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Field label="Start odometer" htmlFor="mileage-start">
                <Input
                  id="mileage-start"
                  name="startOdometer"
                  type="number"
                  step="0.1"
                  inputMode="decimal"
                  required
                />
              </Field>
              <PhotoInput
                id="mileage-start-photo"
                label="Photo of the start reading"
                file={startPhoto}
                onChange={setStartPhoto}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Field label="End odometer" htmlFor="mileage-end">
                <Input
                  id="mileage-end"
                  name="endOdometer"
                  type="number"
                  step="0.1"
                  inputMode="decimal"
                  required
                />
              </Field>
              <PhotoInput
                id="mileage-end-photo"
                label="Photo of the end reading"
                file={endPhoto}
                onChange={setEndPhoto}
              />
            </div>
          </div>

          <Field
            label="Note"
            htmlFor="mileage-note"
            hint={meta.requiresNote ? "Required for this trip type." : undefined}
          >
            <Input
              id="mileage-note"
              name="note"
              required={meta.requiresNote}
              autoComplete="off"
            />
          </Field>

          {error ? <p className="text-sm text-danger">{error}</p> : null}

          <div className="flex gap-2">
            <Button
              type="submit"
              disabled={pending || !startPhoto || !endPhoto}
            >
              {pending ? <Loader2 className="animate-spin" /> : null}
              Save trip
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function PhotoInput({
  id,
  label,
  file,
  onChange,
}: {
  id: string;
  label: string;
  file: File | null;
  onChange: (file: File | null) => void;
}) {
  return (
    <label
      htmlFor={id}
      className="flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border px-3 text-xs"
    >
      <Upload className="size-4 shrink-0" />
      {file ? file.name.slice(0, 24) : label}
      <input
        id={id}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(event) => onChange(event.target.files?.[0] ?? null)}
      />
    </label>
  );
}
