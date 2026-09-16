/**
 * How big the brand artwork is drawn.
 *
 * Two logos, two knobs, because a supplied file carries padding of its own and
 * how much is invisible from the outside. One lockup fills its canvas edge to
 * edge, the next leaves a fifth of it empty, and dropped into the same box the
 * second reads noticeably smaller. The scale is what lets a deployment cancel
 * that out without asking anyone to re-cut the file.
 *
 * Percent against a base the code owns, rather than a raw pixel height, so the
 * default stays 100 everywhere and the header and the sign-in page can keep
 * their own sizes while still moving together.
 *
 * The app icon has no scale: a favicon is drawn by the browser and a home
 * screen icon by the OS, and neither takes our opinion on the matter.
 */

export const BRAND_SCALE_DEFAULT = 100;
export const BRAND_SCALE_MIN = 50;
export const BRAND_SCALE_MAX = 200;
export const BRAND_SCALE_STEP = 5;

/** The company logo's square, where each surface draws it at 100%. */
export const COMPANY_MARK_BASE = { header: 40, auth: 64 } as const;

/** The header wordmark's height at 100%. Width follows the artwork. */
export const HEADER_WORDMARK_BASE = 28;

/**
 * Held to the range the form offers.
 *
 * The form validates on the way in, so this is for the way out: the column is
 * a plain integer and nothing stops a hand-edited row from holding 5000, which
 * would take the header off the screen on every page of the app.
 */
export function clampBrandScale(scale: number | null | undefined): number {
  if (typeof scale !== "number" || !Number.isFinite(scale)) {
    return BRAND_SCALE_DEFAULT;
  }
  return Math.min(BRAND_SCALE_MAX, Math.max(BRAND_SCALE_MIN, Math.round(scale)));
}

/** The drawn size in CSS pixels, for a style attribute. */
export function brandSize(
  basePx: number,
  scale: number | null | undefined,
): number {
  return Math.round((basePx * clampBrandScale(scale)) / 100);
}
