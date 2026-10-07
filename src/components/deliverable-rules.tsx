"use client";

import { Loader2, Minus, Plus, X } from "lucide-react";
import * as React from "react";
import { LocationIcon } from "@/components/icon-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import {
  DELIVERABLE_META,
  locationInField,
  locationNeed,
  MAX_MIN_PHOTOS,
  MAX_RULE_NOTE,
  ruleKey,
} from "@/lib/deliverables";
import { cn } from "@/lib/utils";
import type { DeliverableCategory } from "@prisma-client";

/**
 * The checklist of deliverable sections. One list, three places: a project's
 * settings, a job that already exists, and the form that raises one.
 *
 * On a project or a job the row is saved the moment it is changed and rolled
 * back if the server refuses — a settings screen with a Save button collects a
 * page of edits and loses the lot on one failure. On the new-job form there is
 * nothing to save to yet, so the caller is handed the list instead and submits
 * it with the rest.
 */

export type EditableRule = {
  category: DeliverableCategory;
  customLabel: string | null;
  enabled: boolean;
  required: boolean;
  requiresPhoto: boolean;
  requiresText: boolean;
  /** Photos a required section needs — at each location when perLocation. */
  minPhotos: number;
  perLocation: boolean;
  /** Shown to the crew under the section's name. Up to 100 characters. */
  note: string | null;
};

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

/** A job's room, as the field list names it. */
type RuleLocation = {
  name: string;
  icon: string | null;
  /** The fields it is photographed in, by key; empty or absent is all. */
  fields?: string[];
  counted?: boolean;
  minPhotos?: Record<string, number>;
};

/**
 * A folded section, in one line: what it asks for and what the crew is told.
 * "2 photos at each of 3 locations · no note".
 */
function summary(rule: EditableRule, all: RuleLocation[]): string {
  const locations = all.filter((location) => locationInField(location, ruleKey(rule)));
  const takes = [
    rule.requiresPhoto ? "photos" : null,
    rule.requiresText ? "text" : null,
  ].filter(Boolean);

  const asks = !rule.required
    ? ["Optional", takes.join(" and ") || "nothing to fill in"].join(" · ")
    : rule.requiresPhoto
      ? rule.perLocation
        ? locations.length > 0
          ? `${plural(rule.minPhotos, "photo")} at each of ${plural(locations.length, "location")}`
          : `${plural(rule.minPhotos, "photo")} at each location`
        : plural(rule.minPhotos, "photo")
      : "Text";

  const note = rule.note ? `“${rule.note}”` : "no note";
  return `${asks} · ${note}`;
}

type SaveResult = { ok: true } | { ok: false; error: string };

export function DeliverableRules({
  owner,
  rules,
  save,
  onChange,
  canEdit = true,
  canRequire = true,
  locations = [],
}: {
  /** Which column the row hangs off, and the id to put in it. Saved rows only. */
  owner?: { field: "projectId" | "jobId"; id: string };
  rules: EditableRule[];
  save?: (formData: FormData) => Promise<SaveResult>;
  /** Told about every change, for a caller holding the list itself. */
  onChange?: (rules: EditableRule[]) => void;
  canEdit?: boolean;
  /**
   * Whether a section may be demanded, or switched back off.
   *
   * Turning one on is adding somewhere to put what is in front of you, and
   * anyone on the job can want that. Making it mandatory, or removing one that
   * was planned, decides what checkout will refuse — a different act.
   */
  canRequire?: boolean;
  /**
   * The job's locations, named on the pills under "Separately at each
   * location" — each field the rooms photographed in it. A project's are
   * planned in their own list, and show none here.
   */
  locations?: RuleLocation[];
}) {
  const [saving, setSaving] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<string | null>(null);
  const [naming, setNaming] = React.useState(false);
  const [newName, setNewName] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [override, setOverride] = React.useState<EditableRule[] | null>(null);
  const [, startTransition] = React.useTransition();

  // The saved-row callers hand over what is stored and let this hold the edits;
  // the form caller keeps the list and passes it back down. When what is
  // stored arrives again — after a save, or "Use the project's again" — it is
  // the truth, and the edits held here give way to it.
  const [stored, setStored] = React.useState(rules);
  if (stored !== rules) {
    setStored(rules);
    setOverride(null);
  }
  const shown = override ?? rules;

  function apply(next: EditableRule[]) {
    if (onChange) onChange(next);
    else setOverride(next);
  }

  /**
   * Rows are addressed by key rather than by category: a job may hold several
   * custom sections and "CUSTOM" no longer names one of them.
   */
  function write(rule: EditableRule, applied: EditableRule[], remove = false) {
    const key = ruleKey(rule);
    const before = shown.find((item) => ruleKey(item) === key);
    apply(applied);
    setError(null);

    if (!save || !owner) return;
    setSaving(key);

    startTransition(async () => {
      const formData = new FormData();
      formData.set(owner.field, owner.id);
      formData.set("category", rule.category);
      formData.set("customLabel", rule.customLabel ?? "");
      formData.set("enabled", String(rule.enabled));
      formData.set("required", String(rule.required));
      formData.set("requiresPhoto", String(rule.requiresPhoto));
      formData.set("requiresText", String(rule.requiresText));
      formData.set("minPhotos", String(rule.minPhotos));
      formData.set("perLocation", String(rule.perLocation));
      formData.set("note", rule.note ?? "");
      if (remove) formData.set("remove", "true");

      const result = await save(formData);
      setSaving(null);

      if (!result.ok) {
        setError(result.error);
        // Only the row that was refused goes back: another save may have
        // landed since this one set off, and rolling back the whole list
        // would undo that too.
        setOverride((current) => {
          const list = current ?? rules;
          if (!before) return list.filter((item) => ruleKey(item) !== key);
          return list.some((item) => ruleKey(item) === key)
            ? list.map((item) => (ruleKey(item) === key ? before : item))
            : [...list, before];
        });
      }
    });
  }

  function update(key: string, patch: Partial<EditableRule>) {
    const current = shown.find((rule) => ruleKey(rule) === key);
    if (!current) return;

    const next = { ...current, ...patch };
    // Turning a section off also drops its mandatory flag, so it can never sit
    // as "required but hidden" and block checkout on something invisible.
    if (!next.enabled) next.required = false;
    // Nothing to photograph means nowhere to photograph it.
    if (!next.requiresPhoto) next.perLocation = false;
    // Switched on is about to be set up; switched off has nothing to set.
    if (patch.enabled === true) setEditing(key);
    if (patch.enabled === false && editing === key) setEditing(null);

    write(
      next,
      shown.map((rule) => (ruleKey(rule) === key ? next : rule)),
    );
  }

  /**
   * A new custom section.
   *
   * Named when it is made and not renamed afterwards: the name is what tells
   * one from another and what the photos already filed under it are matched
   * on, so changing it would orphan them. Somebody who picked the wrong name
   * removes it and adds another, which costs nothing before anything is in it.
   */
  function addCustom() {
    const label = newName.trim();
    if (!label) return;

    if (shown.some((rule) => rule.category === "CUSTOM" && rule.customLabel === label)) {
      setError("There is already a section called that.");
      return;
    }

    const rule: EditableRule = {
      category: "CUSTOM",
      customLabel: label,
      enabled: true,
      required: false,
      requiresPhoto: true,
      requiresText: false,
      minPhotos: 1,
      perLocation: false,
      note: null,
    };
    setNewName("");
    setEditing(ruleKey(rule));
    setNaming(false);
    write(rule, [...shown, rule]);
  }

  function removeCustom(rule: EditableRule) {
    write(
      rule,
      shown.filter((item) => ruleKey(item) !== ruleKey(rule)),
      true,
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {error ? <p className="text-sm text-danger">{error}</p> : null}

      {shown.map((rule) => {
        const meta = DELIVERABLE_META[rule.category];
        const key = ruleKey(rule);
        const custom = rule.category === "CUSTOM";
        const name = custom ? rule.customLabel : meta.label;
        const open = rule.enabled && editing === key;
        return (
          <div
            key={key}
            data-section={key}
            className={cn(
              "flex flex-col rounded-xl border border-border p-3.5",
              open ? "gap-3.5" : "gap-1.5",
            )}
          >
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2.5 text-[15px] font-semibold">
                <input
                  type="checkbox"
                  checked={rule.enabled}
                  disabled={!canEdit || (rule.enabled && !canRequire)}
                  onChange={(event) =>
                    update(key, { enabled: event.target.checked })
                  }
                  className="size-5 accent-[var(--color-primary)]"
                />
                {name}
              </label>

              {rule.enabled && rule.required ? (
                <Badge variant="warning">Required</Badge>
              ) : null}

              {saving === key ? (
                <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
              ) : null}

              <div className="ml-auto flex items-center gap-1">
                {rule.enabled && canEdit ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-expanded={open}
                    aria-label={open ? `Done with ${name}` : `Set up ${name}`}
                    onClick={() => setEditing(open ? null : key)}
                  >
                    {open ? "Done" : "Edit"}
                  </Button>
                ) : null}

                {custom && canEdit && canRequire ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${rule.customLabel}`}
                    onClick={() => removeCustom(rule)}
                  >
                    <X />
                  </Button>
                ) : null}
              </div>
            </div>

            {rule.enabled && !open ? (
              <span className="pl-[30px] text-xs text-muted-foreground [overflow-wrap:anywhere]">
                {summary(rule, locations)}
              </span>
            ) : null}

            {open ? (
              <RuleSettings
                rule={rule}
                locations={locations}
                canEdit={canEdit}
                canRequire={canRequire}
                onChange={(patch) => update(key, patch)}
              />
            ) : null}
          </div>
        );
      })}

      {/* One job often wants several: somewhere for the rack elevation and
          somewhere else for the cable route. There used to be room for one,
          and the second name overwrote the first. */}
      {canEdit ? (
        naming ? (
          <div className="flex items-end gap-2">
            <Input
              value={newName}
              autoFocus
              maxLength={80}
              aria-label="Name of the new section"
              placeholder="Rack elevation"
              onChange={(event) => setNewName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addCustom();
                }
              }}
            />
            <Button
              type="button"
              size="sm"
              disabled={newName.trim() === ""}
              onClick={addCustom}
            >
              Add
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setNaming(false);
                setNewName("");
              }}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="self-start"
            onClick={() => setNaming(true)}
          >
            <Plus />
            Another section
          </Button>
        )
      ) : null}
    </div>
  );
}

/**
 * What a switched-on section asks for: whether it is required, what it
 * takes, how many photos and where, and a line for the crew.
 *
 * Everything past the three ticks decides what checkout refuses, or what the
 * crew is told, so it follows the Required switch: somebody who may not
 * demand a section may not change how much it demands either.
 */
function RuleSettings({
  rule,
  locations,
  canEdit,
  canRequire,
  onChange,
}: {
  rule: EditableRule;
  locations: RuleLocation[];
  canEdit: boolean;
  canRequire: boolean;
  onChange: (patch: Partial<EditableRule>) => void;
}) {
  const id = React.useId();
  const planning = canEdit && canRequire;
  // What a required section takes is part of what it demands.
  const kindLocked = !canEdit || (rule.required && !canRequire);
  const [note, setNote] = React.useState(rule.note ?? "");
  // What is stored wins when it changes underneath — a refused save rolled
  // back, or the sheet refreshed from the server.
  const [storedNote, setStoredNote] = React.useState(rule.note);
  if (storedNote !== rule.note) {
    setStoredNote(rule.note);
    setNote(rule.note ?? "");
  }

  // Saved when the person is done with it, not on every key: a save per
  // letter is a hundred requests and a field that fights the cursor.
  function commitNote() {
    const next = note.replace(/\s+/g, " ").trim();
    if (next !== (rule.note ?? "")) onChange({ note: next || null });
    if (next !== note) setNote(next);
  }

  const count = Math.max(1, rule.minPhotos);
  const here = locations.filter((location) => locationInField(location, ruleKey(rule)));

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-wrap gap-x-4.5 gap-y-2 text-[13px]">
        <label className="flex items-center gap-1.5" hidden={!canRequire}>
          <input
            type="checkbox"
            checked={rule.required}
            disabled={!canEdit}
            onChange={(event) => onChange({ required: event.target.checked })}
            className="size-4 accent-[var(--color-primary)]"
          />
          Required
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={rule.requiresPhoto}
            disabled={kindLocked}
            onChange={(event) =>
              onChange({ requiresPhoto: event.target.checked })
            }
            className="size-4 accent-[var(--color-primary)]"
          />
          Photo
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={rule.requiresText}
            disabled={kindLocked}
            onChange={(event) =>
              onChange({ requiresText: event.target.checked })
            }
            className="size-4 accent-[var(--color-primary)]"
          />
          Text entry
        </label>
      </div>

      {/* How many it takes. Only for a required section that takes photos:
          an optional one has nothing to fall short of. */}
      {rule.required && rule.requiresPhoto ? (
        <div className="flex flex-col gap-1.5">
          <span
            id={`${id}-needed`}
            className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
          >
            Photos needed
          </span>
          <div className="flex items-center gap-3">
            <div
              role="group"
              aria-labelledby={`${id}-needed`}
              className="flex h-11 items-center rounded-[10px] bg-input ring-1 ring-inset ring-border"
            >
              <button
                type="button"
                aria-label="One fewer photo"
                disabled={!planning || count <= 1}
                onClick={() => onChange({ minPhotos: count - 1 })}
                className="flex size-11 items-center justify-center text-muted-foreground disabled:opacity-40"
              >
                <Minus className="size-4" />
              </button>
              <span
                aria-live="polite"
                className="tabular min-w-9 text-center text-base font-semibold"
              >
                {count}
              </span>
              <button
                type="button"
                aria-label="One more photo"
                disabled={!planning || count >= MAX_MIN_PHOTOS}
                onClick={() => onChange({ minPhotos: count + 1 })}
                className="flex size-11 items-center justify-center disabled:opacity-40"
              >
                <Plus className="size-4" />
              </button>
            </div>
            {rule.perLocation ? (
              <span className="text-[13px] text-foreground/85">
                at each location
              </span>
            ) : null}
          </div>
          <span className="text-xs text-muted-foreground">
            More are welcome. Fewer leaves it incomplete, and checkout waits.
          </span>
        </div>
      ) : null}

      {rule.requiresPhoto ? (
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-[13px]">
            <input
              type="checkbox"
              checked={rule.perLocation}
              disabled={!planning}
              onChange={(event) =>
                onChange({ perLocation: event.target.checked })
              }
              className="size-4 accent-[var(--color-primary)]"
            />
            Separately at each location
          </label>
          {rule.perLocation ? (
            here.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 pl-6">
                {here.map((location) => (
                  <span
                    key={location.name}
                    className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ring-border"
                  >
                    <LocationIcon
                      icon={location.icon}
                      className="size-3.5 text-muted-foreground"
                    />
                    {location.name}
                    {rule.required ? (
                      <span className="tabular font-normal text-muted-foreground">
                        {locationNeed(location, rule)}
                      </span>
                    ) : null}
                  </span>
                ))}
              </div>
            ) : (
              <span className="pl-6 text-xs text-muted-foreground">
                The crew names the locations on the job — MDF, IDF, the
                install point — and photographs each one. Rooms known in
                advance can be named under Locations.
              </span>
            )
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline gap-2">
          <label
            htmlFor={`${id}-note`}
            className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
          >
            Note for the crew
          </label>
          <span className="tabular ml-auto text-xs text-muted-foreground">
            {note.length} / {MAX_RULE_NOTE}
          </span>
        </div>
        <Input
          id={`${id}-note`}
          value={note}
          maxLength={MAX_RULE_NOTE}
          disabled={!planning}
          placeholder="Shoot the rack front and the patch panel labels."
          onChange={(event) => setNote(event.target.value)}
          onBlur={commitNote}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitNote();
            }
          }}
        />
        <span className="text-xs text-muted-foreground">
          Optional. Shown on the job under the section’s name.
        </span>
      </div>
    </div>
  );
}
