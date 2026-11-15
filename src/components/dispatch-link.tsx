import { Link2 } from "lucide-react";
import { linkHost, normaliseLink } from "@/lib/links";
import { cn } from "@/lib/utils";

/**
 * A dispatch number's meeting link, shown as its host — "zoom.us",
 * "company.zoom.us" — and opened whole, in a new tab so the job page stays
 * where it was.
 *
 * Checked again here rather than trusted from the database: it is an href on
 * a page every tech on the job opens.
 */
export function DispatchLink({ href, className }: { href: string; className?: string }) {
  const safe = normaliseLink(href);
  if (!safe) return null;
  return (
    <a
      href={safe}
      target="_blank"
      rel="noopener noreferrer"
      title={safe}
      className={cn(
        "flex min-w-0 items-center gap-1 text-primary underline-offset-4 hover:underline",
        className,
      )}
    >
      <Link2 className="size-3.5 shrink-0" aria-hidden />
      <span className="truncate">{linkHost(safe)}</span>
      <span className="sr-only"> (link, opens in a new tab)</span>
    </a>
  );
}
