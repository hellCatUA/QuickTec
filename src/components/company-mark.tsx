import { brandSize } from "@/lib/brand";
import { cn } from "@/lib/utils";

/**
 * The company logo, or a fallback tile when none is set.
 *
 * The logo is drawn for the dark theme, which is the product default, so it is
 * inverted on light and left alone on dark. `invert` on the element with
 * `dark:invert-0` would be the obvious way round, but the dark variant here is
 * class-based and both `.dark` and `.light` are present on the root, so this
 * keys off `.light` explicitly and stays correct whichever one is applied.
 *
 * `size` is the box at 100% and `scale` is the deployment's adjustment to it,
 * which is why the size is a prop and not a `size-*` class on the caller: the
 * number is only known at runtime.
 */
export function CompanyMark({
  logoUrl,
  name,
  size,
  scale,
  className,
}: {
  logoUrl: string | null | undefined;
  name: string | null | undefined;
  /** The square's side in CSS pixels at 100%. */
  size: number;
  scale?: number | null;
  className?: string;
}) {
  if (!logoUrl) {
    // Deliberately unscaled. The knob exists to cancel out the padding baked
    // into a supplied file, and this tile is not a supplied file — scaling it
    // would only move the header around for a deployment that set no logo.
    return (
      <div
        style={{ width: size, height: size }}
        className={cn(
          "flex shrink-0 items-center justify-center rounded bg-primary font-bold text-primary-foreground",
          className,
        )}
        aria-hidden="true"
      >
        {(name ?? "QuickTec").trim().charAt(0).toUpperCase() || "Q"}
      </div>
    );
  }

  const px = brandSize(size, scale);

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={logoUrl}
      alt=""
      style={{ width: px, height: px }}
      className={cn("shrink-0 rounded object-contain light:invert", className)}
    />
  );
}
