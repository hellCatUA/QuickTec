"use client";

import { Loader2, X } from "lucide-react";
import * as React from "react";
import { AddLocation, type KnownLocationOption } from "@/components/add-location";
import { LocationIcon } from "@/components/icon-picker";
import { MAX_MIN_PHOTOS } from "@/lib/deliverables";

/** A field photographed per location, as the plan shows it. */
export type PlanField = {
  key: string;
  label: string;
  /** What the field asks of each room that follows it. */
  minPhotos: number;
  /** Only a required field counts photos at all. */
  required: boolean;
};

export type PlanLocation = {
  id: string;
  name: string;
  icon: string | null;
  /** The fields it is photographed in, by key; empty is all of them. */
  fields: string[];
  /** False for a room added on site: it owes no field its count. */
  counted: boolean;
  /** Counts set for it alone, by field key. */
  minPhotos: Record<string, number>;
};

export type PlanChange = {
  fields: string[];
  minPhotos: Record<string, number>;
  counted?: boolean;
};

const inField = (location: PlanLocation, key: string) =>
  location.fields.length === 0 || location.fields.includes(key);

/**
 * The rooms a job is photographed at, planned before anybody is on site.
 *
 * One list for a job and for its project, whose rooms are copied onto every
 * job raised under it. Each room says which of the fields photographed per
 * location it is in — the MDF before and after, the closet the new cable
 * ends in after only — and how many photos it owes each: the field's own
 * number unless one is set for the room.
 *
 * Saved as it is changed, as the fields above it are: a tick at once, a count
 * when the person leaves the box.
 */
export function LocationPlan({
  locations,
  fields,
  known,
  where,
  empty,
  canEdit,
  onAdd,
  onSave,
  onRemove,
}: {
  locations: PlanLocation[];
  fields: PlanField[];
  known: KnownLocationOption[];
  /** "on this job", "on this project". */
  where: string;
  /** Said when there are no rooms yet. */
  empty: string;
  canEdit: boolean;
  /** Each resolves to an error message, or null when it went through. */
  onAdd: (name: string, icon: string | null) => Promise<string | null>;
  onSave: (id: string, change: PlanChange) => Promise<string | null>;
  onRemove: (id: string) => Promise<string | null>;
}) {
  const [error, setError] = React.useState<string | null>(null);

  return (
    <div data-location-plan className="flex flex-col gap-2">
      {fields.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No field is photographed at each location yet. Tick &ldquo;Separately
          at each location&rdquo; on one, and it is photographed at these.
        </p>
      ) : null}

      {locations.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        locations.map((location) => (
          <PlanRow
            key={location.id}
            location={location}
            fields={fields}
            canEdit={canEdit}
            onSave={onSave}
            onRemove={onRemove}
            onError={setError}
          />
        ))
      )}

      {canEdit ? (
        <AddLocation
          known={known}
          taken={locations.map((location) => location.name)}
          where={where}
          onError={setError}
          onAdd={onAdd}
        />
      ) : null}

      {fields.some((field) => field.required) && locations.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          A blank count is the field&rsquo;s own. 0 lets a room go without photos
          there; more than the field asks is fine.
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function PlanRow({
  location,
  fields,
  canEdit,
  onSave,
  onRemove,
  onError,
}: {
  location: PlanLocation;
  fields: PlanField[];
  canEdit: boolean;
  onSave: (id: string, change: PlanChange) => Promise<string | null>;
  onRemove: (id: string) => Promise<string | null>;
  onError: (message: string | null) => void;
}) {
  const [pending, startTransition] = React.useTransition();
  // What is being typed into a count, until the person leaves the box.
  const [drafts, setDrafts] = React.useState<Record<string, string>>({});

  function save(change: Partial<PlanChange>, done?: () => void) {
    onError(null);
    startTransition(async () => {
      const error = await onSave(location.id, {
        fields: change.fields ?? location.fields,
        minPhotos: change.minPhotos ?? location.minPhotos,
        ...(change.counted !== undefined ? { counted: change.counted } : {}),
      });
      if (error) onError(error);
      done?.();
    });
  }

  function toggle(key: string, on: boolean) {
    // Fields not on the sheet just now keep what was asked of them.
    const elsewhere = location.fields.filter(
      (one) => !fields.some((field) => field.key === one),
    );
    const now = fields.filter((field) => inField(location, field.key)).map((field) => field.key);
    const next = on ? [...now, key] : now.filter((one) => one !== key);
    if (next.length === 0) {
      onError(
        `${location.name} has to be photographed in at least one field. Take it off instead.`,
      );
      return;
    }
    save({ fields: [...elsewhere, ...next] });
  }

  function commit(key: string) {
    const text = drafts[key];
    if (text === undefined) return;
    const forget = () =>
      setDrafts((current) => {
        const rest = { ...current };
        delete rest[key];
        return rest;
      });
    const own = location.minPhotos[key];
    const typed = text.trim();
    if (typed === "") {
      if (own === undefined) return forget();
      const rest = { ...location.minPhotos };
      delete rest[key];
      return save({ minPhotos: rest }, forget);
    }
    const count = Number(typed);
    if (!Number.isInteger(count) || count < 0 || count > MAX_MIN_PHOTOS) {
      onError(`Photos needed at ${location.name} is a whole number from 0 to ${MAX_MIN_PHOTOS}.`);
      return forget();
    }
    if (count === own) return forget();
    save({ minPhotos: { ...location.minPhotos, [key]: count } }, forget);
  }

  return (
    <div
      data-location={location.name}
      className="flex flex-col gap-2 rounded-xl border border-border p-3"
    >
      <div className="flex min-h-8 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="flex min-w-0 items-center gap-1.5 text-sm font-semibold">
          <LocationIcon icon={location.icon} className="size-4 text-muted-foreground" />
          <span className="min-w-0 [overflow-wrap:anywhere]">{location.name}</span>
        </span>
        {!location.counted ? (
          <span className="text-xs text-muted-foreground">
            Added on site — photos optional
          </span>
        ) : null}
        {!location.counted && canEdit ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => save({ counted: true })}
            className="text-xs font-semibold text-primary hover:underline disabled:opacity-50"
          >
            Count it like the rest
          </button>
        ) : null}
        {pending ? (
          <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
        ) : null}
        {canEdit ? (
          <button
            type="button"
            aria-label={`Take ${location.name} off the list`}
            disabled={pending}
            onClick={() => {
              onError(null);
              startTransition(async () => {
                const error = await onRemove(location.id);
                if (error) onError(error);
              });
            }}
            className="ml-auto flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted disabled:opacity-50"
          >
            <X className="size-4" />
          </button>
        ) : null}
      </div>

      {fields.length > 0 ? (
        <div className="flex flex-col gap-1.5 pl-5.5">
          {fields.map((field) => {
            const on = inField(location, field.key);
            const own = location.minPhotos[field.key];
            const fallback = location.counted ? Math.max(1, field.minPhotos) : 0;
            return (
              <div
                key={field.key}
                className="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-1 text-[13px]"
              >
                <label className="flex min-w-0 flex-1 items-center gap-2">
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={!canEdit || pending}
                    aria-label={`Photograph ${location.name} in ${field.label}`}
                    onChange={(event) => toggle(field.key, event.target.checked)}
                    className="size-4 accent-[var(--color-primary)]"
                  />
                  <span className="[overflow-wrap:anywhere]">{field.label}</span>
                </label>
                {on && field.required ? (
                  <span className="flex items-center gap-1.5">
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={MAX_MIN_PHOTOS}
                      step={1}
                      disabled={!canEdit || pending}
                      aria-label={`Photos needed in ${field.label} at ${location.name}`}
                      value={drafts[field.key] ?? (own !== undefined ? String(own) : "")}
                      placeholder={String(fallback)}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [field.key]: event.target.value,
                        }))
                      }
                      onBlur={() => commit(field.key)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          commit(field.key);
                        }
                      }}
                      className="h-9 w-16 rounded-lg border border-border bg-input px-2 text-center text-sm tabular placeholder:text-muted-foreground"
                    />
                    <span className="text-xs text-muted-foreground">
                      {own !== undefined
                        ? "photos"
                        : location.counted
                          ? "photos, as the field"
                          : "photos, none needed"}
                    </span>
                  </span>
                ) : on ? (
                  <span className="text-xs text-muted-foreground">Optional field</span>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
