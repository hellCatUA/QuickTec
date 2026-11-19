"use server";

import { revalidatePath } from "next/cache";
import { recordAudit } from "@/lib/audit";
import { BRAND_ASSET_MAX_BYTES, isBrandAsset, type BrandAsset } from "@/lib/brand";
import {
  brandAssetColumn,
  brandAssetSrc,
  prepareBrandAsset,
  swapBrandAsset,
} from "@/lib/brand-assets";
import { PermissionError, requirePermission } from "@/lib/session";
import { deleteFile, storageErrorMessage, storeBrandFile } from "@/lib/storage";

export type BrandAssetResult =
  | { ok: true; src: string | null; notice: string | null }
  | { ok: false; error: string };

/**
 * Uploads one brand asset and puts it up at once.
 *
 * Its own action rather than a field of the company form: a file is the one
 * part of that form that can be refused for what it is, and refused on save it
 * would take every other change on the page down with it. Uploaded on its own,
 * it is right or wrong before anything else is touched, and the preview beside
 * it shows what was actually kept.
 */
export async function uploadBrandAsset(
  asset: BrandAsset,
  formData: FormData,
): Promise<BrandAssetResult> {
  const user = await allowed();
  if (!user) return NOT_ALLOWED;
  // The argument comes from the browser like any other.
  if (!isBrandAsset(asset)) return { ok: false, error: "Unknown brand asset." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Pick a file first." };
  }
  if (file.size > BRAND_ASSET_MAX_BYTES) {
    return { ok: false, error: "That file is too large. Pick one under 10 MB." };
  }

  const prepared = await prepareBrandAsset(asset, Buffer.from(await file.arrayBuffer()));
  if (!prepared.ok) return prepared;

  let storagePath: string;
  try {
    storagePath = await storeBrandFile(asset, prepared.data);
  } catch (error) {
    console.error(`[brand] could not store the ${asset}:`, error);
    return { ok: false, error: storageErrorMessage(error) };
  }

  let previous: string | null;
  try {
    previous = await swapBrandAsset(asset, storagePath);
  } catch (error) {
    // Nothing points at the new file, so it goes rather than sitting on the
    // volume for good.
    await deleteFile(storagePath).catch(() => {});
    console.error(`[brand] could not save the ${asset}:`, error);
    return { ok: false, error: "The file could not be saved. Try again." };
  }

  await settled(user.id, asset, previous, storagePath);
  return { ok: true, src: brandAssetSrc(asset, storagePath), notice: prepared.notice };
}

/** Takes a brand asset down, back to whatever stands in for it. */
export async function removeBrandAsset(asset: BrandAsset): Promise<BrandAssetResult> {
  const user = await allowed();
  if (!user) return NOT_ALLOWED;
  if (!isBrandAsset(asset)) return { ok: false, error: "Unknown brand asset." };

  let previous: string | null;
  try {
    previous = await swapBrandAsset(asset, null);
  } catch (error) {
    console.error(`[brand] could not remove the ${asset}:`, error);
    return { ok: false, error: "It could not be removed. Try again." };
  }

  if (previous) await settled(user.id, asset, previous, null);
  return { ok: true, src: null, notice: null };
}

const NOT_ALLOWED = {
  ok: false,
  error: "You may not change the company settings. Reload the page.",
} as const;

/**
 * The person, when they may change the company settings.
 *
 * Asked the same way as the rest of the page, but answered as a sentence: the
 * thrown PermissionError reaches the browser as a bare rejection, and the field
 * could only guess that the connection dropped. The likely case is somebody
 * whose role changed while the page sat open.
 */
async function allowed() {
  try {
    return await requirePermission("settings.company");
  } catch (error) {
    if (error instanceof PermissionError) return null;
    throw error;
  }
}

/**
 * Everything after the row has moved: the file it no longer points at, the
 * record, and the pages that draw it.
 *
 * The old file is deleted only now, after the row has let go of it, so a
 * failed save never leaves the row pointing at nothing. A file that cannot be
 * deleted is a few kilobytes left on the volume, not a reason to report a
 * save that happened as one that did not.
 */
async function settled(
  actorId: string,
  asset: BrandAsset,
  previous: string | null,
  next: string | null,
) {
  if (previous && previous !== next) {
    await deleteFile(previous).catch((error) =>
      console.error(`[brand] could not delete the replaced ${asset}:`, error),
    );
  }

  await recordAudit({
    actorId,
    entityType: "CompanySettings",
    entityId: "singleton",
    action: "updated",
    detail: { [brandAssetColumn(asset)]: { from: previous, to: next } },
  });

  revalidatePath("/settings/company");
  // The header on every page, and the sign-in pages outside the app's layout.
  revalidatePath("/", "layout");
}
