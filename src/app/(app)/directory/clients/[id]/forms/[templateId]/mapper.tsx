"use client";

import { Loader2, Plus, Trash2, Upload } from "lucide-react";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { PdfPage } from "@/components/pdf-page";
import { cn } from "@/lib/utils";
import {
  addFormBox,
  deleteFormBox,
  importBoxesFromFilled,
  saveFormMapping,
} from "./actions";

/**
 * Pointing each box on a company's blank at the fact that fills it.
 *
 * The list and the page are one control, not two: a field called "Text19"
 * means nothing until you can see which box it is, and a box on the page means
 * nothing until you can see what the blank had in it last time. Selecting
 * either side highlights the other.
 */

export type PlacementRow = {
  id: string;
  fieldName: string | null;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  kind: "TEXT" | "CHECK" | "SIGNATURE";
  source: string | null;
  staticText: string | null;
  rowIndex: number | null;
  fontSize: number | null;
  sampleText: string | null;
};

export type SourceGroup = {
  group: string;
  sources: { key: string; label: string; list: boolean; image: boolean }[];
};

const STATIC_SOURCE = "static";

/** Rendered width of the page. Wide enough to read a form's small print. */
const PAGE_WIDTH = 720;

export function FormMapper({
  templateId,
  fileUrl,
  pageCount,
  pageWidth,
  pageHeight,
  groups,
  initial,
  drawn,
}: {
  templateId: string;
  fileUrl: string;
  pageCount: number;
  pageWidth: number;
  pageHeight: number;
  groups: SourceGroup[];
  initial: PlacementRow[];
  /** True when the blank had no fields and every box was placed by hand. */
  drawn: boolean;
}) {
  // Held locally from here on. Adding, importing and deleting boxes fold the
  // server's answer into this list rather than re-reading the page, because
  // somebody part way through a mapping should not lose it to a reload.
  const [rows, setRows] = React.useState(initial);
  const [page, setPage] = React.useState(0);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  const byKey = React.useMemo(() => {
    const map = new Map<string, { label: string; list: boolean; image: boolean }>();
    for (const group of groups) {
      for (const source of group.sources) map.set(source.key, source);
    }
    return map;
  }, [groups]);

  const scale = PAGE_WIDTH / pageWidth;
  const onThisPage = rows.filter((row) => row.page === page);
  const mapped = rows.filter((row) => row.source).length;

  // Boxes that arrived already pointed somewhere, from the initial load only.
  // Once somebody has saved, the mapping is theirs and the notice has served
  // its purpose.
  const [preMapped] = React.useState(
    () => initial.filter((row) => row.source).length,
  );

  function update(id: string, patch: Partial<PlacementRow>) {
    setSaved(false);
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    );
  }

  function pickSource(id: string, key: string) {
    const source = key ? byKey.get(key) : null;
    update(id, {
      source: key || null,
      // A signature is an image and can only be drawn as one; anything else
      // put in that box would come out as a file path.
      kind: source?.image ? "SIGNATURE" : key ? "TEXT" : "TEXT",
      rowIndex: source?.list ? 0 : null,
      staticText: key === STATIC_SOURCE ? "" : null,
    });
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set(
        "payload",
        JSON.stringify({
          templateId,
          placements: rows.map((row) => ({
            id: row.id,
            source: row.source,
            staticText: row.staticText,
            rowIndex: row.rowIndex,
            fontSize: row.fontSize,
            kind: row.kind,
            page: row.page,
            x: row.x,
            y: row.y,
            width: row.width,
            height: row.height,
          })),
        }),
      );

      const result = await saveFormMapping(null, formData);
      if (!result.ok) setError(result.error);
      else setSaved(true);
    });
  }

  function addBox() {
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set(
        "payload",
        JSON.stringify({
          templateId,
          page,
          // Dropped in the middle, then dragged where it belongs.
          x: pageWidth / 2 - 75,
          y: pageHeight / 2,
          width: 150,
          height: 18,
        }),
      );
      const result = await addFormBox(formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setRows((current) => [...current, ...result.placements]);
      setSelected(result.placements[0]?.id ?? null);
    });
  }

  function removeBox(id: string) {
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("id", id);
      const result = await deleteFormBox(formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setRows((current) => current.filter((row) => row.id !== id));
      setSelected(null);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={mapped === rows.length && mapped > 0 ? "primary" : "neutral"}>
          {mapped} of {rows.length} boxes mapped
        </Badge>
        {pageCount > 1 ? (
          <div className="flex items-center gap-1">
            {Array.from({ length: pageCount }, (_, index) => (
              <Button
                key={index}
                type="button"
                size="sm"
                variant={index === page ? "primary" : "ghost"}
                onClick={() => setPage(index)}
              >
                Page {index + 1}
              </Button>
            ))}
          </div>
        ) : null}

        <div className="ml-auto flex items-center gap-2">
          {drawn ? (
            <Button type="button" size="sm" variant="ghost" onClick={addBox} disabled={pending}>
              <Plus /> Add a box
            </Button>
          ) : null}
          <Button type="button" size="sm" onClick={save} disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : null}
            {pending ? "Saving" : "Save mapping"}
          </Button>
        </div>
      </div>

      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {saved && !error ? (
        <p className="text-sm text-muted-foreground">Mapping saved.</p>
      ) : null}

      {/* A blank prepared with its fields named after values sets itself up.
          That is the whole point of preparing one, and also the only way a box
          can end up pointed somewhere nobody chose — so it is said out loud,
          once, until somebody saves and takes ownership of it. */}
      {preMapped > 0 && !saved ? (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          {preMapped} box{preMapped === 1 ? "" : "es"} on this blank named the
          value {preMapped === 1 ? "it wants" : "they want"}, so{" "}
          {preMapped === 1 ? "it is" : "they are"} already pointed at{" "}
          {preMapped === 1 ? "it" : "them"}. Check{" "}
          {preMapped === 1 ? "it" : "each of them"} against the page before
          saving — this form goes to a customer.
        </p>
      ) : null}

      {drawn ? (
        <ImportFromFilled
          templateId={templateId}
          onImported={(placements) =>
            setRows((current) => [...current, ...placements])
          }
        />
      ) : null}

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        {/* ---------------------------------------------------------------
            The blank, with every box drawn over it. This is what makes a
            field called "Text19" mappable at all.
        ---------------------------------------------------------------- */}
        <div className="relative shrink-0 overflow-auto rounded-xl border border-border">
          <div className="relative" style={{ width: PAGE_WIDTH }}>
            <PdfPage url={fileUrl} page={page} width={PAGE_WIDTH} />

            {onThisPage.map((row) => (
              <BoxOverlay
                key={row.id}
                row={row}
                scale={scale}
                pageHeight={pageHeight}
                pageWidth={pageWidth}
                selected={row.id === selected}
                movable={drawn}
                onSelect={() => setSelected(row.id)}
                onMove={(patch) => update(row.id, patch)}
              />
            ))}
          </div>
        </div>

        {/* ---------------------------------------------------------------
            One row per box.
        ---------------------------------------------------------------- */}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {onThisPage.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {drawn
                ? "This blank has no form fields, so its boxes have to be placed once. Add them by hand, or import them from a copy somebody already filled in."
                : "Nothing on this page."}
            </p>
          ) : null}

          {onThisPage.map((row) => (
            <PlacementEditor
              key={row.id}
              row={row}
              groups={groups}
              source={row.source ? byKey.get(row.source) : undefined}
              selected={row.id === selected}
              removable={drawn}
              pending={pending}
              onSelect={() => setSelected(row.id)}
              onChange={(patch) => update(row.id, patch)}
              onPickSource={(key) => pickSource(row.id, key)}
              onRemove={() => removeBox(row.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * One box drawn over the page: where it is, and a handle to move it.
 *
 * Dragging is offered only on a blank whose boxes were placed by hand. Where
 * the file declared its own fields, the rectangles came out of the file and
 * are right by construction — a box nudged off its line there is somebody
 * introducing an error, not correcting one.
 *
 * Coordinates are kept in PDF points throughout and converted at the edges.
 * Storing screen pixels would tie a mapping to the width somebody's browser
 * happened to render at.
 */
function BoxOverlay({
  row,
  scale,
  pageHeight,
  pageWidth,
  selected,
  movable,
  onSelect,
  onMove,
}: {
  row: PlacementRow;
  scale: number;
  pageHeight: number;
  pageWidth: number;
  selected: boolean;
  movable: boolean;
  onSelect: () => void;
  onMove: (patch: Partial<PlacementRow>) => void;
}) {
  const dragRef = React.useRef<{
    pointerId: number;
    mode: "move" | "resize";
    startX: number;
    startY: number;
    origin: { x: number; y: number; width: number; height: number };
  } | null>(null);

  function begin(event: React.PointerEvent, mode: "move" | "resize") {
    if (!movable) return;
    event.preventDefault();
    event.stopPropagation();
    onSelect();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      origin: { x: row.x, y: row.y, width: row.width, height: row.height },
    };
  }

  function move(event: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const dx = (event.clientX - drag.startX) / scale;
    // Screen y grows downward, PDF y grows upward.
    const dy = -(event.clientY - drag.startY) / scale;

    if (drag.mode === "move") {
      onMove({
        x: clamp(drag.origin.x + dx, 0, pageWidth - drag.origin.width),
        y: clamp(drag.origin.y + dy, 0, pageHeight - drag.origin.height),
      });
      return;
    }

    // The handle is at the bottom-right, so widening keeps the left edge and
    // heightening keeps the top: the box grows the way the pointer moves.
    const width = clamp(drag.origin.width + dx, 6, pageWidth - drag.origin.x);
    const height = clamp(
      drag.origin.height - dy,
      6,
      drag.origin.y + drag.origin.height,
    );
    onMove({
      width,
      height,
      y: drag.origin.y + drag.origin.height - height,
    });
  }

  function end(event: React.PointerEvent) {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  }

  /** Arrow keys for the last point, where a pointer is hopeless. */
  function nudge(event: React.KeyboardEvent) {
    if (!movable) return;
    const step = event.shiftKey ? 10 : 1;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    };
    const delta = moves[event.key];
    if (!delta) return;
    event.preventDefault();
    onMove({
      x: clamp(row.x + delta[0], 0, pageWidth - row.width),
      y: clamp(row.y + delta[1], 0, pageHeight - row.height),
    });
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={nudge}
      onPointerDown={(event) => begin(event, "move")}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      aria-label={
        row.fieldName ?? `Box at ${Math.round(row.x)}, ${Math.round(row.y)}`
      }
      className={cn(
        "absolute rounded-[2px] border-2 transition-colors",
        movable ? "cursor-move touch-none" : "cursor-pointer",
        selected
          ? "border-[var(--color-primary)] bg-[var(--color-primary)]/25"
          : row.source
            ? "border-emerald-500/70 bg-emerald-500/15 hover:bg-emerald-500/30"
            : "border-amber-500/70 bg-amber-500/15 hover:bg-amber-500/30",
      )}
      style={{
        left: row.x * scale,
        // PDF coordinates run up from the bottom of the page; CSS runs down
        // from the top.
        top: (pageHeight - row.y - row.height) * scale,
        width: Math.max(6, row.width * scale),
        height: Math.max(6, row.height * scale),
      }}
    >
      {movable && selected ? (
        <span
          role="button"
          tabIndex={-1}
          aria-label="Resize this box"
          onPointerDown={(event) => begin(event, "resize")}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          className="absolute -bottom-1.5 -right-1.5 size-3 cursor-se-resize touch-none rounded-full border border-white bg-[var(--color-primary)]"
        />
      ) : null}
    </div>
  );
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), Math.max(low, high));
}

function PlacementEditor({
  row,
  groups,
  source,
  selected,
  removable,
  pending,
  onSelect,
  onChange,
  onPickSource,
  onRemove,
}: {
  row: PlacementRow;
  groups: SourceGroup[];
  source: { label: string; list: boolean; image: boolean } | undefined;
  selected: boolean;
  removable: boolean;
  pending: boolean;
  onSelect: () => void;
  onChange: (patch: Partial<PlacementRow>) => void;
  onPickSource: (key: string) => void;
  onRemove: () => void;
}) {
  return (
    <div
      onFocus={onSelect}
      onClick={onSelect}
      className={cn(
        "flex flex-col gap-2 rounded-lg border p-3",
        selected ? "border-[var(--color-primary)] bg-surface-raised" : "border-border",
      )}
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-sm font-medium">
          {row.fieldName ?? `Box at ${Math.round(row.x)}, ${Math.round(row.y)}`}
        </span>
        {/* What the blank had in this box, which is usually the only thing
            that says what a field called "Text19" is for. */}
        {row.sampleText ? (
          <span className="min-w-0 truncate text-xs text-muted-foreground">
            was “{row.sampleText.slice(0, 60)}”
          </span>
        ) : null}
        {removable ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="ml-auto"
            aria-label="Remove this box"
            disabled={pending}
            onClick={onRemove}
          >
            <Trash2 />
          </Button>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <Select
          aria-label="What goes in this box"
          className="min-w-0 flex-1"
          value={row.source ?? ""}
          onChange={(event) => onPickSource(event.target.value)}
        >
          <option value="">Leave blank — filled in by hand</option>
          {groups.map((group) => (
            <optgroup key={group.group} label={group.group}>
              {group.sources.map((entry) => (
                <option key={entry.key} value={entry.key}>
                  {entry.label}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>

        {row.source && !source?.image ? (
          <Select
            aria-label="How to draw it"
            className="w-32 shrink-0"
            value={row.kind}
            onChange={(event) =>
              onChange({ kind: event.target.value as PlacementRow["kind"] })
            }
          >
            <option value="TEXT">Text</option>
            <option value="CHECK">Tick</option>
          </Select>
        ) : null}
      </div>

      {row.source === STATIC_SOURCE ? (
        <Field label="Text to put in it" htmlFor={`static-${row.id}`}>
          <Input
            id={`static-${row.id}`}
            value={row.staticText ?? ""}
            onChange={(event) => onChange({ staticText: event.target.value })}
            placeholder="417 Group"
          />
        </Field>
      ) : null}

      {source?.list ? (
        <Field
          label="Which one"
          htmlFor={`row-${row.id}`}
          hint="A timesheet with a line per trip: the first line is 1."
        >
          <Input
            id={`row-${row.id}`}
            type="number"
            min={1}
            max={51}
            value={(row.rowIndex ?? 0) + 1}
            onChange={(event) =>
              onChange({
                rowIndex: Math.max(0, Number(event.target.value || 1) - 1),
              })
            }
          />
        </Field>
      ) : null}
    </div>
  );
}

/**
 * Lifting the boxes off a sheet somebody already filled in.
 *
 * On a flat blank this is the difference between twenty boxes placed from
 * memory and twenty already in the right place, drawn by the person who fills
 * the form every week.
 */
function ImportFromFilled({
  templateId,
  onImported,
}: {
  templateId: string;
  onImported: (placements: PlacementRow[]) => void;
}) {
  const [file, setFile] = React.useState<File | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function run() {
    if (!file) return;
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("templateId", templateId);
      formData.set("file", file);
      const result = await importBoxesFromFilled(null, formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onImported(result.placements);
      setFile(null);
    });
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-dashed border-border p-3">
      <p className="text-sm text-muted-foreground">
        If you have a copy of this form filled in with an annotation app, its
        boxes can be read straight off it — you then only have to say what goes
        in each.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-border px-3 text-sm">
          <Upload className="size-4" />
          {file ? file.name : "Choose a filled copy"}
          <input
            type="file"
            accept="application/pdf"
            className="sr-only"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </label>
        <Button type="button" size="sm" disabled={!file || pending} onClick={run}>
          {pending ? <Loader2 className="animate-spin" /> : null}
          {pending ? "Reading" : "Import its boxes"}
        </Button>
      </div>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
    </div>
  );
}
