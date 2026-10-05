"use client";

import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
  MapPin,
  MessageSquare,
  Plus,
  Search,
  Upload,
  X,
} from "lucide-react";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LocationIcon } from "@/components/icon-picker";
import { Field, Input, Textarea } from "@/components/ui/field";
import {
  type DeliverableRule,
  type FieldProgress,
  fieldProgress,
  itemMatchesRule,
  MAX_LOCATION_NAME,
  progressCount,
} from "@/lib/deliverables";
import { searchIcons } from "@/lib/location-icons";
import { prepareForUpload } from "@/lib/photo-upload";
import { cn } from "@/lib/utils";
import type { DeliverableCategory } from "@prisma-client";
import {
  type MoveTarget,
  PdfTile,
  PhotoViewer,
  type ViewerPhoto,
} from "./photo-viewer";
import {
  addJobLocation,
  removeDeliverableText,
  removeJobLocation,
  saveDeliverable,
} from "./upload-actions";

/**
 * What the crew has to bring back from the job, section by section.
 *
 * Folded, each section is one line — its name, whether it is done, how many
 * — over a strip of small thumbnails, so the whole list fits on a phone and
 * the one that still needs something stands out. Opened, it shows every photo
 * in a grid, by location when it is photographed at each one, with an empty
 * slot for every photo still owed. A photo opens in a window over the job.
 *
 * On a phone one section is open at a time: a second one opening below the
 * first is a second screen of scrolling to find the next. A laptop has the
 * room for several.
 */

export type PhotoView = Omit<
  ViewerPhoto,
  "locationId" | "locationName" | "locationIcon"
>;

export type DeliverableItemView = {
  id: string;
  category: DeliverableCategory;
  customLabel: string | null;
  textValue: string | null;
  locationId: string | null;
  uploadedBy: string | null;
  /** Whether this person may take the typed part away. */
  canRemoveText: boolean;
  attachments: PhotoView[];
};

export type LocationView = {
  id: string;
  name: string;
  /** A key from the icon collection; null draws the plain pin. */
  icon: string | null;
  /** Anything filed under it, in any section. A location in use stays. */
  inUse: boolean;
};

/** An entry from the dictionary in Settings → Company. */
export type KnownLocationView = { label: string; icon: string | null };

type Adding = { key: string; locationId: string | null };

/** Typed values that read as a list of short codes rather than a sentence. */
const CODES = new Set<DeliverableCategory>([
  "OLD_SERIALS",
  "NEW_SERIALS",
  "RETURN_LABELS",
]);

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

function lines(text: string | null): string[] {
  return (text ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function textCount(category: DeliverableCategory, items: DeliverableItemView[]) {
  const typed = items.filter((item) => lines(item.textValue).length > 0);
  if (typed.length === 0) return null;
  const codes = typed.flatMap((item) => lines(item.textValue)).length;
  if (category === "RETURN_LABELS") return plural(codes, "number");
  if (category === "OLD_SERIALS" || category === "NEW_SERIALS") {
    return plural(codes, "serial");
  }
  return plural(typed.length, "note");
}

/** Wide enough to keep several sections open at once. */
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

/** How many tiles of a size fit across the strip, measured rather than guessed. */
function useFit(tile: number, gap: number) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [fit, setFit] = React.useState(5);
  React.useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () =>
      setFit(Math.max(2, Math.floor((node.clientWidth + gap) / (tile + gap))));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [tile, gap]);
  return [ref, fit] as const;
}

export function Deliverables({
  jobId,
  rules,
  items,
  locations,
  known,
  canUpload,
  canRemoveLocations,
  photoCount,
  photoLimit,
}: {
  jobId: string;
  /** The sections that are on. */
  rules: DeliverableRule[];
  items: DeliverableItemView[];
  locations: LocationView[];
  /** The locations offered by name when one is added. */
  known: KnownLocationView[];
  canUpload: boolean;
  /** A supervisor or the lead: the only ones who take a location away. */
  canRemoveLocations: boolean;
  photoCount: number;
  photoLimit: number;
}) {
  const wide = useWide();
  const [open, setOpen] = React.useState<string[]>([]);
  const [adding, setAdding] = React.useState<Adding | null>(null);
  const [viewing, setViewing] = React.useState<{
    key: string;
    id: string;
  } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const scrollTo = React.useRef<string | null>(null);

  const progress = React.useMemo(
    () =>
      fieldProgress(
        rules,
        items.map((item) => ({
          category: item.category,
          customLabel: item.customLabel,
          locationId: item.locationId,
          textValue: item.textValue,
          fileCount: item.attachments.length,
        })),
        locations,
      ),
    [rules, items, locations],
  );

  const remaining = photoLimit - photoCount;

  function toggle(key: string) {
    setOpen((was) =>
      was.includes(key)
        ? was.filter((one) => one !== key)
        : wide
          ? [...was, key]
          : [key],
    );
    if (adding && adding.key === key) setAdding(null);
  }

  function show(key: string, anchor?: string) {
    setOpen((was) => (was.includes(key) ? was : wide ? [...was, key] : [key]));
    if (anchor) scrollTo.current = anchor;
  }

  function startAdding(key: string, locationId: string | null) {
    show(key);
    setError(null);
    setAdding({ key, locationId });
  }

  // A tap on a location pill opens the section there, not at its top.
  React.useEffect(() => {
    const anchor = scrollTo.current;
    if (!anchor) return;
    scrollTo.current = null;
    document
      .getElementById(anchor)
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [open]);

  // Sections a photo can be moved to: any that takes photos or files.
  const targets: MoveTarget[] = progress
    .filter((field) => field.rule.requiresPhoto)
    .map((field) => ({
      key: field.key,
      label: field.label,
      category: field.rule.category,
      customLabel: field.rule.customLabel,
      perLocation: field.rule.perLocation,
    }));

  const viewed = viewing
    ? progress.find((field) => field.key === viewing.key)
    : null;

  return (
    <div className="flex flex-col">
      {error ? (
        <p role="alert" className="pb-2 text-sm text-danger">
          {error}
        </p>
      ) : null}

      <p className="pb-1.5 text-xs text-muted-foreground">
        {photoCount} of {photoLimit} photos used on this job.
      </p>

      {progress.map((field) => (
        <Section
          key={field.key}
          jobId={jobId}
          field={field}
          items={items.filter((item) => itemMatchesRule(item, field.rule))}
          locations={locations}
          known={known}
          isOpen={open.includes(field.key)}
          adding={adding?.key === field.key ? adding : null}
          canUpload={canUpload}
          canRemoveLocations={canRemoveLocations}
          remaining={remaining}
          onToggle={() => toggle(field.key)}
          onShowLocation={(locationId) =>
            show(field.key, `loc-${field.key}-${locationId}`)
          }
          onAdd={(locationId) => startAdding(field.key, locationId)}
          onAddDone={() => setAdding(null)}
          onView={(id) => setViewing({ key: field.key, id })}
          onError={setError}
        />
      ))}

      {viewing && viewed ? (
        <PhotoViewer
          title={viewed.label}
          photos={photosOf(viewed, items, locations)}
          startId={viewing.id}
          grouped={viewed.locations !== null}
          targets={targets}
          locations={locations}
          current={viewed.key}
          onClose={() => setViewing(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * A section's photos in the order they are shown and walked: location by
 * location as the job lists them, then any not filed under one, each in the
 * order they arrived.
 */
function photosOf(
  field: FieldProgress,
  items: DeliverableItemView[],
  locations: LocationView[],
): ViewerPhoto[] {
  const mine = items.filter((item) => itemMatchesRule(item, field.rule));
  const byId = new Map(locations.map((location) => [location.id, location]));
  const flat = mine.flatMap((item) =>
    item.attachments.map((attachment) => {
      const location = item.locationId ? byId.get(item.locationId) : undefined;
      return {
        ...attachment,
        locationId: item.locationId,
        locationName: location?.name ?? null,
        locationIcon: location?.icon ?? null,
      };
    }),
  );
  // A section not photographed per location says nothing about where.
  if (!field.locations) {
    return flat.map((photo) => ({ ...photo, locationName: null }));
  }

  const order = new Map(field.locations.map((location, index) => [location.id, index]));
  const rank = (photo: ViewerPhoto) =>
    photo.locationId !== null && order.has(photo.locationId)
      ? (order.get(photo.locationId) as number)
      : order.size;
  return flat
    .map((photo, index) => ({ photo, index }))
    .sort((a, b) => rank(a.photo) - rank(b.photo) || a.index - b.index)
    .map((entry) => ({
      ...entry.photo,
      // Filed under a location this section does not count — say so, rather
      // than naming a place the section is not photographed at.
      locationName: rank(entry.photo) === order.size ? null : entry.photo.locationName,
    }));
}

function StateBadge({ field }: { field: FieldProgress }) {
  if (field.state === "done") {
    return (
      <Badge variant="success" className="rounded-[7px] px-1.5 py-px text-[11px] font-semibold">
        <Check className="size-3" />
        Done
      </Badge>
    );
  }
  if (field.state === "incomplete") {
    return (
      <Badge variant="warning" className="rounded-[7px] px-1.5 py-px text-[11px] font-semibold">
        Incomplete
      </Badge>
    );
  }
  if (field.state === "required") {
    return (
      <Badge variant="warning" className="rounded-[7px] px-1.5 py-px text-[11px] font-semibold">
        <AlertTriangle className="size-3" />
        Required
      </Badge>
    );
  }
  return null;
}

/** What whoever set the job up wants the crew to know, as they wrote it. */
function Note({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg bg-surface-raised px-2.5 py-2 text-[13px] text-foreground/85">
      <MessageSquare className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      <span className="[overflow-wrap:anywhere]">{text}</span>
    </div>
  );
}

function Thumb({
  photo,
  label,
  onOpen,
  className,
}: {
  photo: PhotoView;
  label: string;
  onOpen: () => void;
  className?: string;
}) {
  const pdf = photo.mimeType === "application/pdf";
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onOpen}
      className={cn(
        "relative shrink-0 overflow-hidden rounded-lg bg-muted ring-1 ring-inset ring-white/5",
        className,
      )}
    >
      {pdf ? (
        <PdfTile className="size-full" />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/files/${photo.id}?w=200`}
          alt={photo.originalName}
          loading="lazy"
          className="size-full object-cover"
        />
      )}
    </button>
  );
}

function Section({
  jobId,
  field,
  items,
  locations,
  known,
  isOpen,
  adding,
  canUpload,
  canRemoveLocations,
  remaining,
  onToggle,
  onShowLocation,
  onAdd,
  onAddDone,
  onView,
  onError,
}: {
  jobId: string;
  field: FieldProgress;
  items: DeliverableItemView[];
  locations: LocationView[];
  known: KnownLocationView[];
  isOpen: boolean;
  adding: Adding | null;
  canUpload: boolean;
  canRemoveLocations: boolean;
  remaining: number;
  onToggle: () => void;
  onShowLocation: (locationId: string) => void;
  onAdd: (locationId: string | null) => void;
  onAddDone: () => void;
  onView: (id: string) => void;
  onError: (message: string | null) => void;
}) {
  const { rule, label } = field;
  const photos = photosOf(field, items, locations);
  const typed = items.filter((item) => lines(item.textValue).length > 0);
  const empty = photos.length === 0 && typed.length === 0;
  const byLocation = field.locations !== null;

  const count = [
    textCount(rule.category, items),
    rule.requiresPhoto || photos.length > 0 ? progressCount(field) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  // Shown folded only while the section still needs something: once it is
  // done the crew has read it, and it is one more line between them and the
  // next section.
  const note =
    rule.note && (isOpen || field.state !== "done") ? (
      <Note text={rule.note} />
    ) : null;

  // Nothing in it and nowhere to tap through to: just its name and Add.
  if (empty && !byLocation && !isOpen) {
    return (
      <div
        data-deliverable={field.key}
        className="flex flex-col gap-1.5 border-t border-border pb-3 pt-2.5"
      >
        <div className="flex min-h-8 items-center gap-2">
          <span className="text-sm font-semibold">{label}</span>
          <StateBadge field={field} />
          {canUpload ? (
            <button
              type="button"
              aria-label={`Add to ${label}`}
              onClick={() => onAdd(null)}
              className={cn(
                "ml-auto flex min-h-8 items-center gap-1 rounded-lg px-2.5 text-[13px] font-semibold",
                field.state === "optional"
                  ? "text-muted-foreground hover:bg-muted"
                  : "bg-primary/15 text-primary hover:bg-primary/20",
              )}
            >
              <Plus className="size-3.5" />
              Add
            </button>
          ) : null}
        </div>
        {note}
      </div>
    );
  }

  return (
    <div
      data-deliverable={field.key}
      className={cn(
        "flex flex-col border-t border-border pt-2.5",
        isOpen ? "gap-3 pb-3.5" : "gap-2 pb-3",
      )}
    >
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={onToggle}
        className="flex min-h-8 w-full items-center gap-2 text-left"
      >
        <span className="text-sm font-semibold">{label}</span>
        <StateBadge field={field} />
        <span className="ml-auto text-xs text-muted-foreground">{count}</span>
        {isOpen ? (
          <ChevronDown className="size-4.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-4.5 shrink-0 text-muted-foreground" />
        )}
      </button>

      {note}

      {isOpen ? (
        <Opened
          jobId={jobId}
          field={field}
          photos={photos}
          typed={typed}
          locations={locations}
          known={known}
          adding={adding}
          canUpload={canUpload}
          canRemoveLocations={canRemoveLocations}
          remaining={remaining}
          onAdd={onAdd}
          onAddDone={onAddDone}
          onView={onView}
          onError={onError}
        />
      ) : (
        <Folded
          field={field}
          photos={photos}
          typed={typed}
          onToggle={onToggle}
          onShowLocation={onShowLocation}
          onView={onView}
        />
      )}
    </div>
  );
}

function Folded({
  field,
  photos,
  typed,
  onToggle,
  onShowLocation,
  onView,
}: {
  field: FieldProgress;
  photos: ViewerPhoto[];
  typed: DeliverableItemView[];
  onToggle: () => void;
  onShowLocation: (locationId: string) => void;
  onView: (id: string) => void;
}) {
  const [strip, fit] = useFit(48, 6);
  const codes = CODES.has(field.rule.category);
  const values = typed.flatMap((item) =>
    codes ? lines(item.textValue) : [lines(item.textValue).join(" ")],
  );

  // One pill per location: what each still owes, and a way straight to it.
  if (field.locations) {
    return (
      <div className="flex flex-wrap gap-1.5">
        {field.locations.map((location) => {
          const counted = location.needed > 0;
          const done = counted && location.short === 0;
          return (
            <button
              key={location.id}
              type="button"
              onClick={() => onShowLocation(location.id)}
              className={cn(
                "flex min-h-[30px] items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold ring-1 ring-inset",
                done
                  ? "bg-success/12 text-success ring-success/30"
                  : counted
                    ? "bg-warning/12 text-warning ring-warning/35"
                    : "text-foreground ring-border",
              )}
            >
              <LocationIcon icon={location.icon} className="size-3.5" />
              {location.name}
              {done ? <Check className="size-3" strokeWidth={3} /> : null}
              {counted && !done ? (
                <span className="tabular">
                  {location.files}/{location.needed}
                </span>
              ) : !counted ? (
                <span className="tabular text-muted-foreground">{location.files}</span>
              ) : null}
            </button>
          );
        })}
        {field.unfiled > 0 ? (
          <button
            type="button"
            onClick={onToggle}
            className="flex min-h-[30px] items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-muted-foreground ring-1 ring-inset ring-border"
          >
            No location
            <span className="tabular">{field.unfiled}</span>
          </button>
        ) : null}
      </div>
    );
  }

  const shown =
    photos.length > fit ? photos.slice(0, fit - 1) : photos;
  const more = photos.length - shown.length;

  return (
    <>
      {photos.length > 0 ? (
        <div ref={strip} className="flex gap-1.5">
          {shown.map((photo, index) => (
            <Thumb
              key={photo.id}
              photo={photo}
              label={`Open photo ${index + 1} of ${photos.length}`}
              onOpen={() => onView(photo.id)}
              className="size-12"
            />
          ))}
          {more > 0 ? (
            <button
              type="button"
              aria-label={`Show all ${photos.length} photos in ${field.label}`}
              onClick={onToggle}
              className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-muted text-sm font-semibold ring-1 ring-inset ring-border"
            >
              +{more}
            </button>
          ) : null}
        </div>
      ) : null}

      {values.length > 0 ? (
        codes ? (
          <div className="flex flex-wrap gap-1.5">
            {values.slice(0, 4).map((value, index) => (
              <span
                // The same number can legitimately appear twice — two boxes
                // on one label run — and keying on the text drops one.
                key={`${index}-${value}`}
                className="rounded-md px-2 py-1 font-mono text-xs ring-1 ring-inset ring-border"
              >
                {value}
              </span>
            ))}
            {values.length > 4 ? (
              <button
                type="button"
                onClick={onToggle}
                className="px-1 text-xs font-semibold text-muted-foreground"
              >
                +{values.length - 4}
              </button>
            ) : null}
          </div>
        ) : (
          <p className="line-clamp-2 text-[13px] text-foreground/85">
            {values.join(" · ")}
          </p>
        )
      ) : null}
    </>
  );
}

function Opened({
  jobId,
  field,
  photos,
  typed,
  locations,
  known,
  adding,
  canUpload,
  canRemoveLocations,
  remaining,
  onAdd,
  onAddDone,
  onView,
  onError,
}: {
  jobId: string;
  field: FieldProgress;
  photos: ViewerPhoto[];
  typed: DeliverableItemView[];
  locations: LocationView[];
  known: KnownLocationView[];
  adding: Adding | null;
  canUpload: boolean;
  canRemoveLocations: boolean;
  remaining: number;
  onAdd: (locationId: string | null) => void;
  onAddDone: () => void;
  onView: (id: string) => void;
  onError: (message: string | null) => void;
}) {
  const { rule, label } = field;
  const position = (photo: ViewerPhoto) =>
    `Open photo ${photos.indexOf(photo) + 1} of ${photos.length}`;

  const form = (locationId: string | null, place: string) =>
    adding && adding.locationId === locationId ? (
      <UploadForm
        jobId={jobId}
        rule={rule}
        place={place}
        locationId={locationId}
        remaining={remaining}
        onDone={onAddDone}
        onError={onError}
      />
    ) : null;

  const grid = (list: ViewerPhoto[], missing: number, locationId: string | null, place: string) =>
    list.length > 0 || missing > 0 ? (
      <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6 lg:grid-cols-8">
        {list.map((photo) => (
          <Thumb
            key={photo.id}
            photo={photo}
            label={position(photo)}
            onOpen={() => onView(photo.id)}
            className="aspect-square w-full"
          />
        ))}
        {/* What is still owed, as somewhere to tap. Capped: a section that
            asks for twenty does not need twenty empty boxes to say so. */}
        {canUpload
          ? Array.from({ length: Math.min(missing, 8) }, (_, index) => (
              <button
                key={`missing-${index}`}
                type="button"
                aria-label={`Add the missing photo${missing > 1 ? ` (${index + 1} of ${missing})` : ""} at ${place}`}
                onClick={() => onAdd(locationId)}
                className="flex aspect-square w-full items-center justify-center rounded-lg border-[1.5px] border-dashed border-warning/55 text-warning hover:bg-warning/10"
              >
                <Plus className="size-5" />
              </button>
            ))
          : null}
      </div>
    ) : null;

  return (
    <div className="flex flex-col gap-3">
      {field.locations ? (
        <>
          {field.locations.map((location) => {
            const here = photos.filter((photo) => photo.locationId === location.id);
            const counted = location.needed > 0;
            const short = location.short;
            const place = `${label} at ${location.name}`;
            const removable =
              canRemoveLocations &&
              !locations.find((one) => one.id === location.id)?.inUse;
            return (
              <div
                key={location.id}
                id={`loc-${field.key}-${location.id}`}
                className="flex scroll-mt-24 flex-col gap-2"
              >
                <div className="flex min-h-8 items-center gap-2">
                  <span className="flex items-center gap-1.5 text-[13px] font-semibold">
                    <LocationIcon
                      icon={location.icon}
                      className="size-4 text-muted-foreground"
                    />
                    {location.name}
                  </span>
                  {counted ? (
                    short === 0 ? (
                      <span className="flex items-center gap-0.5 text-xs text-success">
                        <Check className="size-3" strokeWidth={3} />
                        {location.files} of {location.needed}
                      </span>
                    ) : (
                      <span className="text-xs font-semibold text-warning">
                        {location.files} of {location.needed}
                      </span>
                    )
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {plural(location.files, "photo")}
                    </span>
                  )}
                  <div className="ml-auto flex items-center gap-1">
                    {removable ? (
                      <RemoveLocation
                        id={location.id}
                        name={location.name}
                        onError={onError}
                      />
                    ) : null}
                    {canUpload && rule.requiresPhoto ? (
                      short > 0 ? (
                        <button
                          type="button"
                          aria-label={`Add to ${place}`}
                          onClick={() => onAdd(location.id)}
                          className="flex min-h-8 items-center gap-1 rounded-lg bg-primary/15 px-2.5 text-[13px] font-semibold text-primary hover:bg-primary/20"
                        >
                          <Plus className="size-3.5" />
                          Add
                        </button>
                      ) : (
                        <button
                          type="button"
                          aria-label={`Add to ${place}`}
                          onClick={() => onAdd(location.id)}
                          className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
                        >
                          <Plus className="size-4" />
                        </button>
                      )
                    ) : null}
                  </div>
                </div>
                {grid(here, short, location.id, location.name)}
                {form(location.id, place)}
              </div>
            );
          })}

          {/* Taken before the locations were named, or filed under one this
              section no longer counts. Not lost: moved from the photo. */}
          {photos.some((photo) => photo.locationName === null) ? (
            <div className="flex flex-col gap-2">
              <div className="flex min-h-8 items-center gap-2">
                <span className="text-[13px] font-semibold text-muted-foreground">
                  Not at a location
                </span>
                <span className="text-xs text-muted-foreground">
                  Open a photo to move it to one.
                </span>
              </div>
              {grid(
                photos.filter((photo) => photo.locationName === null),
                0,
                null,
                label,
              )}
            </div>
          ) : null}

          {canUpload ? <AddLocation
              jobId={jobId}
              known={known}
              onJob={locations}
              onError={onError}
            /> : null}
        </>
      ) : (
        <>
          {grid(
            photos,
            rule.requiresPhoto && field.needed !== null
              ? Math.max(0, field.needed - field.files)
              : 0,
            null,
            label,
          )}

          {canUpload && !adding ? (
            <button
              type="button"
              onClick={() => onAdd(null)}
              className="flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] border border-dashed border-border text-sm font-semibold text-primary hover:bg-primary/5"
            >
              <Plus className="size-4" />
              {rule.requiresPhoto ? `Add photos to ${label}` : `Add to ${label}`}
            </button>
          ) : null}
          {form(null, label)}

          {/* Per location, but nobody has named a location yet: the first
              one is named from here. */}
          {canUpload && rule.perLocation ? (
            <AddLocation
              jobId={jobId}
              known={known}
              onJob={locations}
              onError={onError}
            />
          ) : null}
        </>
      )}

      {typed.length > 0 ? (
        <div className="flex flex-col gap-2">
          {typed.map((item) => (
            <TypedEntry
              key={item.id}
              item={item}
              codes={CODES.has(rule.category)}
              onError={onError}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function TypedEntry({
  item,
  codes,
  onError,
}: {
  item: DeliverableItemView;
  codes: boolean;
  onError: (message: string | null) => void;
}) {
  const [pending, startTransition] = React.useTransition();
  const values = lines(item.textValue);

  return (
    <div className="flex items-start gap-2 rounded-lg border border-border p-2">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">
          {item.uploadedBy ?? "Unattributed"}
        </span>
        {codes ? (
          <div className="flex flex-wrap gap-1.5">
            {values.map((value, index) => (
              <span
                key={`${index}-${value}`}
                className="rounded-md px-2 py-1 font-mono text-xs ring-1 ring-inset ring-border"
              >
                {value}
              </span>
            ))}
          </div>
        ) : (
          <p className="whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">
            {item.textValue}
          </p>
        )}
      </div>
      {item.canRemoveText ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-9"
          aria-label="Remove this entry"
          disabled={pending}
          onClick={() => {
            onError(null);
            startTransition(async () => {
              const formData = new FormData();
              formData.set("itemId", item.id);
              const result = await removeDeliverableText(formData);
              if (!result.ok) onError(result.error);
            });
          }}
        >
          {pending ? <Loader2 className="animate-spin" /> : <X />}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * A room found on the day — the second IDF nobody mentioned.
 *
 * Picked from the list in Settings → Company, which carries the icon with it,
 * or typed when the room is not there. What is already on the job is left off
 * the list, so the same room cannot be added twice by picking it twice.
 */
function AddLocation({
  jobId,
  known,
  onJob,
  onError,
}: {
  jobId: string;
  known: KnownLocationView[];
  onJob: LocationView[];
  onError: (message: string | null) => void;
}) {
  const [naming, setNaming] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [pending, startTransition] = React.useTransition();

  const typed = query.replace(/\s+/g, " ").trim();
  const lower = typed.toLowerCase();
  const taken = new Set(onJob.map((location) => location.name.toLowerCase()));
  const offered = known.filter(
    (entry) =>
      !taken.has(entry.label.toLowerCase()) &&
      (!lower || entry.label.toLowerCase().includes(lower)),
  );
  const already = typed && taken.has(lower) ? typed : null;
  const exact = known.some((entry) => entry.label.toLowerCase() === lower);
  const custom = typed && !already && !exact ? typed : null;
  // A room the list does not know still gets a picture: the one its list
  // namesake has — "IDF 2" the IDF's — or failing that the one its words
  // suggest, and the plain pin if they suggest nothing.
  const namesake = custom
    ? known.find((entry) => lower.startsWith(`${entry.label.toLowerCase()} `))
    : undefined;
  const customIcon = custom
    ? (namesake?.icon ?? searchIcons(custom)[0]?.key ?? null)
    : null;

  function add(name: string, icon: string | null) {
    onError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("jobId", jobId);
      formData.set("name", name);
      if (icon) formData.set("icon", icon);
      const result = await addJobLocation(formData);
      if (!result.ok) return onError(result.error);
      setQuery("");
      setNaming(false);
    });
  }

  if (!naming) {
    return (
      <button
        type="button"
        onClick={() => setNaming(true)}
        className="flex min-h-9 items-center gap-1.5 self-start rounded-[9px] border border-dashed border-border px-3 text-[13px] font-semibold text-muted-foreground hover:text-foreground"
      >
        <MapPin className="size-3.5" />
        Add a location
      </button>
    );
  }

  const row =
    "flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm hover:bg-muted disabled:opacity-50";

  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface-raised p-2">
      <div className="flex items-center gap-1">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            autoFocus
            maxLength={MAX_LOCATION_NAME}
            aria-label="Name of the location"
            placeholder="Search or type a location…"
            disabled={pending}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                if (offered[0]) add(offered[0].label, offered[0].icon);
                else if (custom) add(custom, customIcon);
              } else if (event.key === "Escape") {
                setNaming(false);
              }
            }}
            className="min-h-10 w-full rounded-lg border border-border bg-input pl-9 pr-3 text-sm placeholder:text-muted-foreground"
          />
        </div>
        <button
          type="button"
          aria-label="Cancel adding a location"
          disabled={pending}
          onClick={() => {
            setNaming(false);
            setQuery("");
          }}
          className="flex size-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />}
        </button>
      </div>

      <div className="flex max-h-64 flex-col overflow-y-auto">
        {custom ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => add(custom, customIcon)}
            className={cn(row, "text-primary")}
          >
            <Plus className="size-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate">Add “{custom}”</span>
            <LocationIcon icon={customIcon} className="size-4 text-muted-foreground" />
          </button>
        ) : null}
        {already ? (
          <p className="px-2.5 py-2 text-sm text-muted-foreground">
            “{already}” is already on this job.
          </p>
        ) : null}
        {offered.map((entry) => (
          <button
            key={entry.label}
            type="button"
            disabled={pending}
            onClick={() => add(entry.label, entry.icon)}
            className={row}
          >
            <LocationIcon icon={entry.icon} className="size-4 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{entry.label}</span>
          </button>
        ))}
        {offered.length === 0 && !custom && !already ? (
          <p className="px-2.5 py-2 text-sm text-muted-foreground">
            Everything on the list is on this job. Type a name to add another.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function RemoveLocation({
  id,
  name,
  onError,
}: {
  id: string;
  name: string;
  onError: (message: string | null) => void;
}) {
  const [pending, startTransition] = React.useTransition();
  return (
    <button
      type="button"
      aria-label={`Remove the location ${name}`}
      disabled={pending}
      onClick={() => {
        if (!window.confirm(`Remove ${name} from this job?`)) return;
        onError(null);
        startTransition(async () => {
          const formData = new FormData();
          formData.set("locationId", id);
          const result = await removeJobLocation(formData);
          if (!result.ok) onError(result.error);
        });
      }}
      className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-danger disabled:opacity-50"
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />}
    </button>
  );
}

function UploadForm({
  jobId,
  rule,
  place,
  locationId,
  remaining,
  onDone,
  onError,
}: {
  jobId: string;
  rule: DeliverableRule;
  /** "Pre-Install at MDF" — where these are going, said on the button. */
  place: string;
  locationId: string | null;
  remaining: number;
  onDone: () => void;
  onError: (message: string | null) => void;
}) {
  const [files, setFiles] = React.useState<File[]>([]);
  const [text, setText] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [done, setDone] = React.useState(0);
  const textId = React.useId();

  // A return usually goes back in more than one box, and the numbers are long
  // enough that typing them into one field separated by something is how a
  // digit gets lost. One field each, added as needed.
  const asTracking = rule.category === "RETURN_LABELS";
  const [numbers, setNumbers] = React.useState<
    { id: number; value: string }[]
  >([{ id: 0, value: "" }]);
  const nextId = React.useRef(1);

  const textValue = asTracking
    ? numbers
        .map((entry) => entry.value.trim())
        .filter(Boolean)
        // Stored one per line; the report joins them with commas.
        .join("\n")
    : text;

  function base(): FormData {
    const formData = new FormData();
    formData.set("jobId", jobId);
    formData.set("category", rule.category);
    if (rule.customLabel) formData.set("customLabel", rule.customLabel);
    if (locationId) formData.set("locationId", locationId);
    return formData;
  }

  /**
   * One request per photo.
   *
   * Ten in a single request is 35 MB that has to arrive whole before anything
   * happens — minutes on a site's LTE, past the request size limit at the end
   * of it, with no sign of progress and all ten lost if the signal drops on
   * the last one. Each photo is also shrunk to what the server would have kept
   * anyway before it is sent, which is most of the wait.
   */
  async function submit() {
    onError(null);
    setPending(true);
    setDone(0);

    // The upload is made by the first request and joined by the rest, so the
    // photos land together however many there are.
    let itemId: string | undefined;

    for (const [index, original] of files.entries()) {
      const prepared = await prepareForUpload(original);

      const formData = base();
      // Text belongs to the upload, so it goes with the request that makes it.
      if (textValue && index === 0) formData.set("textValue", textValue);
      if (itemId) formData.set("itemId", itemId);
      formData.append("files", prepared.file);
      if (prepared.exif) formData.append("exif", prepared.exif, "exif.bin");

      const result = await saveDeliverable(null, formData);
      if (!result.ok) {
        setPending(false);
        // Named, because the ones before it are already saved and retrying
        // should not mean starting again.
        onError(
          `${original.name}: ${result.error}` +
            (index > 0 ? ` (${index} already saved)` : ""),
        );
        return;
      }

      itemId ??= result.id;
      setDone(index + 1);
    }

    // Text on its own, with no photos to carry it.
    if (files.length === 0) {
      const formData = base();
      if (textValue) formData.set("textValue", textValue);

      const result = await saveDeliverable(null, formData);
      setPending(false);
      if (!result.ok) return onError(result.error);
      return onDone();
    }

    setPending(false);
    onDone();
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-raised p-3">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Adding to {place}
      </span>

      {rule.requiresText ? (
        asTracking ? (
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Tracking numbers
            </span>

            {numbers.map((entry, index) => (
              <div key={entry.id} className="flex items-center gap-2">
                <Input
                  aria-label={`Tracking number ${index + 1}`}
                  value={entry.value}
                  autoComplete="off"
                  inputMode="text"
                  onChange={(event) =>
                    setNumbers((was) =>
                      was.map((row) =>
                        row.id === entry.id
                          ? { ...row, value: event.target.value }
                          : row,
                      ),
                    )
                  }
                />
                {numbers.length > 1 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove tracking number ${index + 1}`}
                    onClick={() =>
                      setNumbers((was) =>
                        was.filter((row) => row.id !== entry.id),
                      )
                    }
                  >
                    <X />
                  </Button>
                ) : null}
              </div>
            ))}

            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="self-start"
              onClick={() =>
                setNumbers((was) => [
                  ...was,
                  { id: nextId.current++, value: "" },
                ])
              }
            >
              <Plus /> Another tracking number
            </Button>

            <p className="text-xs text-muted-foreground">
              They reach “Return track #” on the report as one list, separated
              by commas.
            </p>
          </div>
        ) : (
          <Field label="Details" htmlFor={textId}>
            <Textarea
              id={textId}
              value={text}
              rows={3}
              onChange={(event) => setText(event.target.value)}
            />
          </Field>
        )
      ) : null}

      {rule.requiresPhoto ? (
        <div className="flex flex-col gap-2">
          <label className="flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border px-3 text-sm">
            <Upload className="size-4" />
            {files.length > 0
              ? `${files.length} file${files.length === 1 ? "" : "s"} selected`
              : "Take a photo or choose files"}
            {/* No capture attribute: iOS then offers camera, library and
                Files from the same control. */}
            <input
              type="file"
              accept="image/*,application/pdf"
              multiple
              className="sr-only"
              onChange={(event) =>
                setFiles(Array.from(event.target.files ?? []))
              }
            />
          </label>

          {files.length > remaining ? (
            <p className="text-xs text-warning">
              Only {remaining} more photo{remaining === 1 ? "" : "s"} will fit on
              this job.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          disabled={pending || (files.length === 0 && !textValue)}
          onClick={submit}
        >
          {pending ? <Loader2 className="animate-spin" /> : null}
          {/* Counted, because a spinner on a two-minute upload is
              indistinguishable from one that has stopped. */}
          {pending
            ? files.length > 1
              ? `Uploading ${done + 1} of ${files.length}`
              : "Uploading"
            : "Save"}
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

      {pending ? (
        <p className="text-xs text-muted-foreground">
          Converting and stamping photos — this can take a moment on a weak
          signal. Keep the app open.
        </p>
      ) : null}
    </div>
  );
}
