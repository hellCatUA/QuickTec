import { cn } from "@/lib/utils";

/**
 * The company logo, or a fallback tile when none is set.
 *
 * The logo is drawn for the dark theme, which is the product default, so it is
 * inverted on light and left alone on dark. `invert` on the element with
 * `dark:invert-0` would be the obvious way round, but the dark variant here is
 * class-based and both `.dark` and `.light` are present on the root, so this
 * keys off `.light` explicitly and stays correct whichever one is applied.
 */
export function CompanyMark({
  logoUrl,
  name,
  className,
}: {
  logoUrl: string | null | undefined;
  name: string | null | undefined;
  className?: string;
}) {
  if (!logoUrl) {
    return (
      <div
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

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={logoUrl}
      alt=""
      className={cn("shrink-0 rounded object-contain light:invert", className)}
    />
  );
}
