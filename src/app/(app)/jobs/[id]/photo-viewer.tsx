"use client";

import {
  ArrowRightLeft,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  MoreHorizontal,
  Tag,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import * as React from "react";
import { createPortal } from "react-dom";
import { LocationIcon } from "@/components/icon-picker";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import type { DeliverableCategory } from "@prisma-client";
import { PhotoLabelInput } from "./photo-label-input";
import {
  deleteDeliverablePhoto,
  labelDeliverablePhoto,
  moveDeliverablePhoto,
} from "./upload-actions";

/**
 * A photo opened from the job, in a window rather than a new tab.
 *
 * The thumbnails used to link straight to the file, which on a phone meant a
 * new tab, a 2400px image to pinch around, and a hunt for the way back. Here
 * the photo opens over the job, the arrows walk through the rest of the same
 * section — across every location in it, in the order they are shown — and
 * the original is one button away for anyone who needs it.
 *
 * What used to be Move and the cross on a whole upload is here as well, on
 * the one photo being looked at, because that is when somebody notices it is
 * of the IDF and not the MDF.
 */

export type ViewerPhoto = {
  id: string;
  mimeType: string;
  originalName: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  uploadedBy: string | null;
  taken: string;
  canMove: boolean;
  canDelete: boolean;
  /** What somebody wrote on it — drawn on it, and its name in the export. */
  label: string | null;
  /** Changes when the photo is drawn again, so it is not shown from cache. */
  version: string;
  /** Where it is filed, for a section photographed per location. */
  locationId: string | null;
  locationName: string | null;
  locationIcon: string | null;
};

export type MoveTarget = {
  key: string;
  label: string;
  category: DeliverableCategory;
  customLabel: string | null;
  /**
   * The rooms the field is photographed at, in the job's order. Empty for a
   * field not photographed per location, or one with no rooms in it yet.
   */
  locationIds: string[];
};

const isPdf = (photo: { mimeType: string }) =>
  photo.mimeType === "application/pdf";

/** The file, at a width when a smaller copy will do, as it is drawn now. */
export function fileUrl(photo: { id: string; version: string }, width?: number): string {
  return `/api/files/${photo.id}?${width ? `w=${width}&` : ""}v=${photo.version}`;
}

/** What a photo downloads as: its label when it has one. */
function downloadName(photo: ViewerPhoto): string {
  if (!photo.label) return photo.originalName;
  return `${photo.label}.${isPdf(photo) ? "pdf" : "jpg"}`;
}

function size(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Wide enough for the side panel. Below it the window is the phone one. */
function useWide(): boolean {
  const [wide, setWide] = React.useState(false);
  React.useEffect(() => {
    const query = window.matchMedia("(min-width: 1024px)");
    const update = () => setWide(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return wide;
}

export function PhotoViewer({
  title,
  photos,
  startId,
  grouped,
  targets,
  locations,
  labels,
  current: currentKey,
  onClose,
}: {
  /** The section's name. */
  title: string;
  /** Every photo in the section, in the order the arrows walk them. */
  photos: ViewerPhoto[];
  startId: string;
  /** Whether the strip is split by location. */
  grouped: boolean;
  /** Sections a photo can be moved to, this one included. */
  targets: MoveTarget[];
  locations: { id: string; name: string }[];
  /** The labels already used on this job's photos, offered when labelling. */
  labels: string[];
  /** The key of the section the photos are in. */
  current: string;
  onClose: () => void;
}) {
  const wide = useWide();
  // Where the window is, by photo and by position: the position is what it
  // falls back on when the photo itself has gone.
  const [at, setAt] = React.useState({
    id: startId,
    index: Math.max(0, photos.findIndex((photo) => photo.id === startId)),
  });
  const [menu, setMenu] = React.useState(false);
  const [moving, setMoving] = React.useState(false);
  const [labelling, setLabelling] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const dialog = React.useRef<HTMLDivElement>(null);

  // A photo moved out of the section, or deleted, leaves the list when the
  // page refreshes. The window steps to its neighbour rather than showing a
  // photo that is no longer there, and closes once there is nothing left.
  const found = photos.findIndex((photo) => photo.id === at.id);
  const index = found === -1 ? Math.min(at.index, photos.length - 1) : found;
  const photo = photos[index];
  React.useEffect(() => {
    if (photos.length === 0) onClose();
  }, [photos.length, onClose]);

  const go = React.useCallback(
    (step: number) => {
      if (photos.length < 2) return;
      const nextIndex = (index + step + photos.length) % photos.length;
      setAt({ id: photos[nextIndex].id, index: nextIndex });
      setMenu(false);
      setMoving(false);
      setLabelling(false);
      setError(null);
    },
    [index, photos],
  );

  // Keys on a laptop: Esc folds the window back, the arrows walk the photos.
  React.useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        if (menu) setMenu(false);
        else onClose();
      } else if (event.key === "ArrowRight") {
        go(1);
      } else if (event.key === "ArrowLeft") {
        go(-1);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [go, menu, onClose]);

  // The page underneath stays where it was, and focus goes back to the
  // thumbnail that opened this when it closes.
  React.useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      opener?.focus?.();
    };
  }, []);

  // The neighbours, fetched while this one is being looked at, so the arrow
  // is not a wait on a site's LTE.
  React.useEffect(() => {
    for (const step of [1, -1]) {
      const near = photos[(index + step + photos.length) % photos.length];
      if (near && !isPdf(near)) {
        const image = new Image();
        image.src = fileUrl(near, 800);
      }
    }
  }, [index, photos]);

  // The menu folds away on a tap anywhere else, as any menu does.
  const menuRoot = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!menu) return;
    function away(event: PointerEvent) {
      if (!menuRoot.current?.contains(event.target as Node)) setMenu(false);
    }
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [menu]);

  // A swipe across the photo on a phone.
  const swipe = React.useRef<{ x: number; y: number } | null>(null);

  if (!photo) return null;

  const where = photo.locationName ? `${photo.locationName} · ` : "";
  const position = `photo ${index + 1} of ${photos.length}`;
  const canAct = photo.canMove || photo.canDelete;

  function remove() {
    if (!window.confirm("Delete this photo? It cannot be brought back.")) return;
    setMenu(false);
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("attachmentId", photo.id);
      const result = await deleteDeliverablePhoto(formData);
      if (!result.ok) setError(result.error);
    });
  }

  const stage = (
    <div
      className={cn(
        "relative flex items-center justify-center bg-black",
        wide ? "h-[520px] flex-1" : "h-[min(52vh,420px)]",
      )}
      onPointerDown={(event) => {
        swipe.current = { x: event.clientX, y: event.clientY };
      }}
      onPointerUp={(event) => {
        const start = swipe.current;
        swipe.current = null;
        if (!start) return;
        const dx = event.clientX - start.x;
        const dy = event.clientY - start.y;
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
          go(dx < 0 ? 1 : -1);
        }
      }}
    >
      {isPdf(photo) ? (
        // A PDF is a tile in the strip and only previewed here, where there
        // is room to read it.
        <iframe
          key={photo.id}
          src={fileUrl(photo)}
          title={photo.originalName}
          className="size-full bg-white"
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={`${photo.id}-${photo.version}`}
          src={fileUrl(photo, 800)}
          alt={`${title}, ${where}${photo.label ? `${photo.label}, ` : ""}${position}`}
          draggable={false}
          className="max-h-full max-w-full select-none object-contain"
        />
      )}

      {photos.length > 1 ? (
        <>
          <button
            type="button"
            aria-label="Previous photo"
            onClick={() => go(-1)}
            className={cn(
              "absolute top-1/2 flex size-11 -translate-y-1/2 items-center justify-center",
              "rounded-full bg-black/60 text-white ring-1 ring-inset ring-white/15",
              wide ? "left-3.5" : "left-2",
            )}
          >
            <ChevronLeft className="size-5" />
          </button>
          <button
            type="button"
            aria-label="Next photo"
            onClick={() => go(1)}
            className={cn(
              "absolute top-1/2 flex size-11 -translate-y-1/2 items-center justify-center",
              "rounded-full bg-black/60 text-white ring-1 ring-inset ring-white/15",
              wide ? "right-3.5" : "right-2",
            )}
          >
            <ChevronRight className="size-5" />
          </button>
        </>
      ) : null}
    </div>
  );

  // The whole section, grouped by location when it is photographed per
  // location: the arrows walk it in this same order.
  type Group = { label: string | null; icon: string | null; items: ViewerPhoto[] };
  const groups: Group[] = grouped
    ? photos.reduce<Group[]>((list, one) => {
        const label = one.locationName ?? "Not at a location";
        const last = list[list.length - 1];
        if (last && last.label === label) last.items.push(one);
        else
          list.push({
            label,
            icon: one.locationName ? one.locationIcon : null,
            items: [one],
          });
        return list;
      }, [])
    : [{ label: null, icon: null, items: photos }];

  const strip = (
    <div
      className={cn(
        wide
          ? "flex flex-col gap-3"
          : "flex gap-3 overflow-x-auto border-b border-border px-3 py-2.5",
      )}
    >
      {groups.map((group) => (
        <div
          key={group.label ?? "all"}
          className="flex shrink-0 flex-col gap-1"
        >
          {group.label ? (
            <span
              className={cn(
                "flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider",
                group.items.some((one) => one.id === photo.id)
                  ? "text-warning"
                  : "text-muted-foreground",
              )}
            >
              {group.icon !== null ? (
                <LocationIcon icon={group.icon} className="size-3" />
              ) : null}
              {group.label}
            </span>
          ) : null}
          <div className={cn(wide ? "grid grid-cols-4 gap-1.5" : "flex gap-1")}>
            {group.items.map((one) => {
              const at = photos.indexOf(one) + 1;
              const current = one.id === photo.id;
              return (
                <button
                  key={one.id}
                  type="button"
                  aria-label={`Photo ${at}`}
                  aria-current={current ? "true" : undefined}
                  onClick={() => go(photos.indexOf(one) - index)}
                  className={cn(
                    "relative shrink-0 overflow-hidden rounded-md bg-muted",
                    wide ? "aspect-square" : "size-9",
                    // The ring is drawn over the picture: an inset ring on
                    // the button itself sits under the image and vanishes.
                    !current && "opacity-55 hover:opacity-100",
                  )}
                >
                  {isPdf(one) ? (
                    <span className="flex size-full items-center justify-center text-[9px] font-bold text-muted-foreground">
                      PDF
                    </span>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={fileUrl(one, 200)}
                      alt=""
                      loading="lazy"
                      className="size-full object-cover"
                    />
                  )}
                  {current ? (
                    <span className="absolute inset-0 rounded-md ring-2 ring-inset ring-primary" />
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );

  const links = (
    <div className={cn("flex gap-2", wide && "flex-col")}>
      <a
        href={`${fileUrl(photo)}&download=1`}
        download={downloadName(photo)}
        className={cn(
          "flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg",
          "bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary/90",
          wide ? "order-first min-h-10" : "order-last",
        )}
      >
        <Download className="size-4" />
        Download
      </a>
      <a
        href={fileUrl(photo)}
        target="_blank"
        rel="noreferrer"
        className={cn(
          "flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg",
          "border border-border bg-muted text-sm font-medium hover:bg-surface-raised",
          wide && "min-h-10",
        )}
      >
        <ExternalLink className="size-4" />
        {wide ? "Open full size" : "Full size"}
      </a>
    </div>
  );

  const menuButton = canAct ? (
    <div ref={menuRoot} className="relative">
      <button
        type="button"
        aria-label="Options for this photo"
        aria-expanded={menu}
        aria-haspopup="menu"
        disabled={pending}
        onClick={() => setMenu((was) => !was)}
        className={cn(
          "flex size-11 items-center justify-center rounded-lg transition-colors",
          menu ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted",
          wide && "size-10",
        )}
      >
        {pending ? (
          <Loader2 className="size-5 animate-spin" />
        ) : (
          <MoreHorizontal className="size-5" />
        )}
      </button>
      {menu ? (
        <div
          role="menu"
          className={cn(
            "absolute right-0 top-12 z-10 flex w-max flex-col rounded-xl p-1 whitespace-nowrap",
            "border border-border bg-surface-raised shadow-xl",
          )}
        >
          {photo.canMove ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenu(false);
                setMoving(false);
                setLabelling(true);
              }}
              className="flex min-h-11 items-center gap-2.5 rounded-lg px-3 text-left text-sm hover:bg-muted"
            >
              <Tag className="size-4" />
              {photo.label ? "Change the label" : "Add a label"}
            </button>
          ) : null}
          {photo.canMove ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenu(false);
                setLabelling(false);
                setMoving(true);
              }}
              className="flex min-h-11 items-center gap-2.5 rounded-lg px-3 text-left text-sm hover:bg-muted"
            >
              <ArrowRightLeft className="size-4" />
              Move to another field or location
            </button>
          ) : null}
          {photo.canDelete ? (
            <button
              type="button"
              role="menuitem"
              onClick={remove}
              className="flex min-h-11 items-center gap-2.5 rounded-lg px-3 text-left text-sm text-danger hover:bg-muted"
            >
              <Trash2 className="size-4" />
              Delete this photo
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  ) : null;

  const mover = moving ? (
    <MovePhoto
      key={photo.id}
      photo={photo}
      current={currentKey}
      targets={targets}
      locations={locations}
      onDone={() => setMoving(false)}
      onError={setError}
    />
  ) : labelling ? (
    <LabelPhoto
      key={photo.id}
      photo={photo}
      labels={labels}
      onDone={() => setLabelling(false)}
      onError={setError}
    />
  ) : null;

  const errorLine = error ? (
    <p role="alert" className="text-sm text-danger">
      {error}
    </p>
  ) : null;

  const window_ = wide ? (
    <div
      ref={dialog}
      role="dialog"
      aria-modal="true"
      aria-label={`${title}, ${where}${position}`}
      tabIndex={-1}
      className={cn(
        "relative flex w-full max-w-[940px] flex-col overflow-hidden rounded-2xl",
        "border border-border bg-surface shadow-2xl outline-none",
      )}
    >
      <div className="flex items-center gap-2.5 border-b border-border py-2.5 pl-5 pr-2.5">
        <span className="text-base font-semibold">{title}</span>
        <span className="text-[13px] text-muted-foreground">
          {photo.locationName ? `${photo.locationName} · ` : ""}
          Photo {index + 1} of {photos.length}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          {menuButton}
          {/* On a laptop the window folds back into the page rather than
              being shut. */}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onClose}
            title="Back to the job (Esc)"
            aria-label="Back to the job"
          >
            <Undo2 />
            Back
          </Button>
        </div>
      </div>
      <div className="flex">
        {stage}
        <div className="flex w-[280px] shrink-0 flex-col gap-4.5 overflow-y-auto border-l border-border p-4.5" style={{ maxHeight: 520 }}>
          {errorLine}
          {mover ?? (
            <dl className="grid grid-cols-[84px_minmax(0,1fr)] gap-x-2 gap-y-2 text-[13px]">
              {photo.label ? (
                <>
                  <dt className="text-muted-foreground">Label</dt>
                  <dd className="font-semibold [overflow-wrap:anywhere]">{photo.label}</dd>
                </>
              ) : null}
              <dt className="text-muted-foreground">Uploaded by</dt>
              <dd>{photo.uploadedBy ?? "Unattributed"}</dd>
              <dt className="text-muted-foreground">Taken</dt>
              <dd>{photo.taken}</dd>
              {photo.locationName ? (
                <>
                  <dt className="text-muted-foreground">Location</dt>
                  <dd>{photo.locationName}</dd>
                </>
              ) : null}
              <dt className="text-muted-foreground">File</dt>
              <dd className="[overflow-wrap:anywhere]">{photo.originalName}</dd>
              <dt className="text-muted-foreground">Size</dt>
              <dd>
                {photo.width && photo.height
                  ? `${photo.width} × ${photo.height} · `
                  : ""}
                {size(photo.sizeBytes)}
              </dd>
            </dl>
          )}
          {links}
          <div className="flex flex-col gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              In {title}
            </span>
            {strip}
          </div>
        </div>
      </div>
    </div>
  ) : (
    <div
      ref={dialog}
      role="dialog"
      aria-modal="true"
      aria-label={`${title}, ${where}${position}`}
      tabIndex={-1}
      className={cn(
        "absolute inset-x-2.5 top-12 flex max-h-[calc(100dvh-4rem)] flex-col overflow-y-auto rounded-2xl",
        "border border-border bg-surface shadow-2xl outline-none",
      )}
    >
      <div className="flex items-center gap-0.5 py-2 pl-4 pr-1.5">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-[15px] font-semibold">{title}</span>
          <span className="text-xs text-muted-foreground">
            {where}
            {position}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-0.5">
          {menuButton}
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="flex size-11 items-center justify-center rounded-lg hover:bg-muted"
          >
            <X className="size-5" />
          </button>
        </div>
      </div>
      {stage}
      {strip}
      <div className="flex flex-col gap-3 px-4 pb-4 pt-3">
        {errorLine}
        {mover ?? (
          <div className="flex flex-col gap-0.5">
            {photo.label ? (
              <span className="flex items-center gap-1.5 text-sm font-semibold [overflow-wrap:anywhere]">
                <Tag className="size-3.5 shrink-0 text-muted-foreground" />
                {photo.label}
              </span>
            ) : null}
            <span className="text-[13px]">
              {photo.uploadedBy ?? "Unattributed"} · {photo.taken}
            </span>
            <span className="text-xs text-muted-foreground">
              {photo.originalName} · {size(photo.sizeBytes)}
            </span>
          </div>
        )}
        {links}
      </div>
    </div>
  );

  return createPortal(
    <div
      className={cn(
        "fixed inset-0 z-50 bg-black/75",
        wide && "flex items-center justify-center p-8",
      )}
      onPointerDown={(event) => {
        // A tap on the dimmed page closes it, as the cross does.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {window_}
    </div>,
    document.body,
  );
}

/**
 * Where the photo goes: another section, another location, or both.
 *
 * The location is only asked for when the section is photographed per
 * location and has rooms in it, and only those rooms are offered — anywhere
 * else the photo has no location.
 */
function MovePhoto({
  photo,
  current,
  targets,
  locations,
  onDone,
  onError,
}: {
  photo: ViewerPhoto;
  current: string;
  targets: MoveTarget[];
  locations: { id: string; name: string }[];
  onDone: () => void;
  onError: (message: string | null) => void;
}) {
  const [key, setKey] = React.useState(current);
  const target = targets.find((one) => one.key === key) ?? targets[0];
  const offered = locations.filter((one) => target?.locationIds.includes(one.id));
  const asks = offered.length > 0;
  const [picked, setPicked] = React.useState(photo.locationId ?? "");
  // The room picked, while the field is photographed there; otherwise the
  // field's first, so changing field never leaves a room it does not have.
  const locationId = offered.some((one) => one.id === picked)
    ? picked
    : (offered[0]?.id ?? "");
  const [pending, startTransition] = React.useTransition();

  const same =
    target?.key === current &&
    (asks ? locationId : null) === (photo.locationId ?? null);

  function submit() {
    if (!target) return;
    onError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("attachmentId", photo.id);
      formData.set("category", target.category);
      if (target.customLabel) formData.set("customLabel", target.customLabel);
      if (asks && locationId) formData.set("locationId", locationId);
      const result = await moveDeliverablePhoto(formData);
      if (!result.ok) return onError(result.error);
      onDone();
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-raised p-3">
      <span className="text-sm font-medium">Move this photo to</span>
      <Select
        aria-label="Field"
        value={key}
        disabled={pending}
        onChange={(event) => setKey(event.target.value)}
      >
        {targets.map((one) => (
          <option key={one.key} value={one.key}>
            {one.label}
          </option>
        ))}
      </Select>
      {asks ? (
        <Select
          aria-label="Location"
          value={locationId}
          disabled={pending}
          onChange={(event) => setPicked(event.target.value)}
        >
          {offered.map((one) => (
            <option key={one.id} value={one.id}>
              {one.name}
            </option>
          ))}
        </Select>
      ) : null}
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          disabled={pending || same}
          onClick={submit}
        >
          {pending ? <Loader2 className="animate-spin" /> : null}
          Move
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={onDone}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

/**
 * A label on this one photo: written, changed, or taken off.
 *
 * The ones already used on the job are there to tap, so the third photo of a
 * damaged port is called what the first one was.
 */
function LabelPhoto({
  photo,
  labels,
  onDone,
  onError,
}: {
  photo: ViewerPhoto;
  labels: string[];
  onDone: () => void;
  onError: (message: string | null) => void;
}) {
  const [text, setText] = React.useState(photo.label ?? "");
  const [pending, startTransition] = React.useTransition();
  const id = React.useId();

  function save(label: string) {
    onError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("attachmentId", photo.id);
      formData.set("label", label);
      const result = await labelDeliverablePhoto(formData);
      if (!result.ok) return onError(result.error);
      onDone();
    });
  }

  const same = text.replace(/\s+/g, " ").trim() === (photo.label ?? "");

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-raised p-3">
      <label htmlFor={id} className="text-sm font-medium">
        {photo.label ? "Change the label" : "Label this photo"}
      </label>
      <PhotoLabelInput
        id={id}
        value={text}
        labels={labels}
        disabled={pending}
        autoFocus
        onChange={setText}
        onEnter={() => {
          if (!same && text.trim()) save(text);
        }}
      />
      <span className="text-xs text-muted-foreground">
        Written on the photo above its stamp, and its file name in the export.
      </span>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={pending || same || !text.trim()}
          onClick={() => save(text)}
        >
          {pending ? <Loader2 className="animate-spin" /> : null}
          Save label
        </Button>
        {photo.label ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => save("")}
          >
            Take the label off
          </Button>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={onDone}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** A PDF in a strip of photos: the same size, a label rather than a picture. */
export function PdfTile({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "flex flex-col items-center justify-center gap-px bg-surface-raised text-muted-foreground",
        className,
      )}
    >
      <FileText className="size-4" />
      <span className="text-[9px] font-bold tracking-wide">PDF</span>
    </span>
  );
}
