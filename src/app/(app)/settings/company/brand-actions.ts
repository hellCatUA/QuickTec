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
import { can, getSessionUser } from "@/lib/session";
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
  if ("error" in user) return user;
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
  if ("error" in user) return user;
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

/**
 * The person, when they may change the company settings, or why not.
 *
 * The same question requirePermission asks, answered as a sentence rather
 * than thrown: a throw reaches the browser as a bare rejection, and the field
 * could only guess at a dropped connection. The two answers are told apart
 * because their fixes are different. A settings page left open past the end
 * of the session is the likely one, and it needs a sign-in, not an
 * administrator.
 */
async function allowed() {
  const user = await getSessionUser();
  if (!user) {
    return {
      ok: false,
      error: "You have been signed out. Reload the page to sign in again.",
    } as const;
  }
  if (!can(user, "settings.company")) {
    return {
      ok: false,
      error: "You may not change the company settings any more. Reload the page.",
    } as const;
  }
  return user;
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
