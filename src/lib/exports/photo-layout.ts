import type { DeliverableCategory } from "@prisma-client";
import { deliverableLabel, locationInField, ruleKey } from "@/lib/deliverables";

/**
 * Where each deliverable photo goes in the export.
 *
 *   Pre-Install/MDF/001.jpg
 *   Pre-Install/MDF/002.jpg
 *   Pre-Install/IDF/001.jpg
 *   Pre-Install/No location/001.jpg     a per-location field's unfiled photos
 *   Post Install/001.jpg                a field not photographed per location
 *   Return Labels/notes.txt             what was typed into a field
 *
 * Field, then location, then the photo — numbered in the order the photos
 * were taken into the job, so a photo that was moved keeps its place by when
 * it was uploaded rather than by which upload it happens to sit in now. Who
 * took each one is not a folder any more; it is in the photo index beside
 * them.
 *
 * Whether a field has location folders is the field's own setting, not the
 * photo's: a photo that still carries a location from before the field
 * stopped being photographed per location lands in the field's folder like
 * the rest of them.
 *
 * Pure, so the layout is tested without building an archive.
 */

export type LayoutRule = {
  category: DeliverableCategory;
  customLabel: string | null;
  perLocation: boolean;
};

/** Fields it is photographed in, by key; empty or absent is all of them. */
export type LayoutLocation = { id: string; name: string; fields?: string[] };

export type LayoutAttachment = {
  id: string;
  mimeType: string;
  originalName: string;
  createdAt: Date;
};

export type LayoutItem = {
  category: DeliverableCategory;
  customLabel: string | null;
  locationId: string | null;
  textValue: string | null;
  createdAt: Date;
  attachments: LayoutAttachment[];
};

export type PlannedPhoto = {
  attachmentId: string;
  path: string;
  field: string;
  location: string | null;
};

export type PlannedNote = { path: string; text: string };

/** The folder for photos in a per-location field that are not at one. */
export const NO_LOCATION_FOLDER = "No location";

/** Names Windows will not create, whatever follows the dot. */
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/**
 * One path segment, safe on any machine the archive is opened on.
 *
 * Separators and the characters Windows refuses become dashes; "." and ".."
 * would climb out of the folder when extracted, and a trailing dot or space is
 * silently dropped by Windows, so two different names could land on one.
 */
export function safeSegment(name: string): string {
  const cleaned = name
    .replace(/[/\\?%*:|"<>\x00-\x1f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120)
    .replace(/[. ]+$/, "");
  if (!cleaned || /^\.+$/.test(cleaned)) return "untitled";
  return RESERVED.test(cleaned) ? `${cleaned}_` : cleaned;
}

/**
 * The name, or the name with a counter, so no two siblings collide — compared
 * without case, as Windows and macOS compare them.
 */
export function uniqueSegment(name: string, taken: Set<string>): string {
  let candidate = name;
  for (let counter = 2; taken.has(candidate.toLowerCase()); counter++) {
    candidate = `${name} (${counter})`;
  }
  taken.add(candidate.toLowerCase());
  return candidate;
}

/** The extension the stored bytes actually are, whatever the phone called them. */
export function extensionFor(mimeType: string, originalName = ""): string {
  const known: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/heic": "heic",
    "image/heif": "heif",
    "image/gif": "gif",
    "application/pdf": "pdf",
  };
  if (known[mimeType]) return known[mimeType];
  const fromName = /\.([a-z0-9]{1,5})$/i.exec(originalName)?.[1];
  return fromName ? fromName.toLowerCase() : "bin";
}

/** 001, 002 … 999, then 1000: wide enough that a file browser sorts them. */
function numbered(index: number, count: number): string {
  return String(index + 1).padStart(Math.max(3, String(count).length), "0");
}

/**
 * Plans every deliverable photo and note.
 *
 * `rules` are the job's fields in the order they are shown; a field that
 * holds something but is no longer asked for still gets a folder, after the
 * others, because the photos in it were still taken on this job. `reserved`
 * are the top-level names the rest of the archive uses (Signatures, Receipts
 * and so on), so a custom field called "Receipts" cannot merge into them.
 */
export function planDeliverableExport(
  items: LayoutItem[],
  rules: LayoutRule[],
  locations: LayoutLocation[],
  reserved: string[] = [],
): { photos: PlannedPhoto[]; notes: PlannedNote[] } {
  const rootTaken = new Set(reserved.map((name) => name.toLowerCase()));
  const locationOrder = new Map(locations.map((location, index) => [location.id, index]));
  const locationName = new Map(locations.map((location) => [location.id, location.name]));

  // Fields in the order they are shown, then any that only have leftovers.
  const fieldOrder: string[] = rules.map((rule) => ruleKey(rule));
  const ruleByKey = new Map(rules.map((rule) => [ruleKey(rule), rule]));
  const itemsByField = new Map<string, LayoutItem[]>();
  for (const item of items) {
    const key = ruleKey(item);
    if (!itemsByField.has(key)) itemsByField.set(key, []);
    itemsByField.get(key)!.push(item);
    if (!fieldOrder.includes(key)) fieldOrder.push(key);
  }

  const photos: PlannedPhoto[] = [];
  const notes: PlannedNote[] = [];

  for (const key of fieldOrder) {
    const mine = itemsByField.get(key);
    if (!mine || mine.length === 0) continue;

    const first = mine[0];
    const label = deliverableLabel(first.category, first.customLabel);
    const folder = uniqueSegment(safeSegment(label), rootTaken);
    // Foldered by the rooms photographed in this field, as the job page
    // shows it: a photo still carrying a room the field is not taken at is
    // with the field's unfiled ones there, and here.
    const inField = new Set(
      locations
        .filter((location) => locationInField(location, key))
        .map((location) => location.id),
    );
    const byLocation = Boolean(ruleByKey.get(key)?.perLocation) && inField.size > 0;

    type Placed = LayoutAttachment & { locationId: string | null };
    const placed: Placed[] = mine.flatMap((item) =>
      item.attachments.map((attachment) => ({
        ...attachment,
        locationId:
          byLocation && item.locationId && inField.has(item.locationId)
            ? item.locationId
            : null,
      })),
    );

    // One group per sub-folder: each location in the job's order, then the
    // unfiled ones; or the whole field when it is not per location.
    const groups = new Map<string | null, Placed[]>();
    for (const photo of placed) {
      const group = byLocation ? photo.locationId : null;
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group)!.push(photo);
    }
    const groupKeys = [...groups.keys()].sort((a, b) => {
      const rank = (id: string | null) =>
        id === null ? Number.MAX_SAFE_INTEGER : (locationOrder.get(id) ?? Number.MAX_SAFE_INTEGER - 1);
      return rank(a) - rank(b);
    });

    const subTaken = new Set<string>(["notes.txt"]);
    for (const group of groupKeys) {
      const list = groups
        .get(group)!
        .sort(
          (a, b) =>
            a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
        );

      const sub = byLocation
        ? uniqueSegment(
            safeSegment(group === null ? NO_LOCATION_FOLDER : (locationName.get(group) ?? NO_LOCATION_FOLDER)),
            subTaken,
          )
        : null;

      list.forEach((photo, index) => {
        const file = `${numbered(index, list.length)}.${extensionFor(photo.mimeType, photo.originalName)}`;
        photos.push({
          attachmentId: photo.id,
          path: sub ? `${folder}/${sub}/${file}` : `${folder}/${file}`,
          field: label,
          location: group === null ? null : (locationName.get(group) ?? null),
        });
      });
    }

    // Serials and tracking numbers are text, not files, and would otherwise
    // vanish from the archive. One file per field, in the order typed.
    const typed = mine
      .filter((item) => item.textValue?.trim())
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    if (typed.length > 0) {
      notes.push({
        path: `${folder}/notes.txt`,
        text:
          typed
            .map((item) => {
              const where =
                byLocation && item.locationId && inField.has(item.locationId)
                  ? locationName.get(item.locationId)
                  : null;
              const text = item.textValue!.trim();
              return where ? `[${where}]\n${text}` : text;
            })
            .join("\n\n") + "\n",
      });
    }
  }

  return { photos, notes };
}
