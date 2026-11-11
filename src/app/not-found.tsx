import { SearchX } from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export const metadata = { title: "Not found" };

/**
 * An address the app has no page for.
 *
 * Outside the signed-in pages, so there is no header or tab bar to stand
 * under and no telling who is asking: one way back, to the front door, which
 * sends a signed-in person to their dashboard and anybody else to sign in.
 *
 * Static, like the layout it sits in — the build prerenders it with no
 * database to ask.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
      <SearchX className="size-10 text-muted-foreground" />
      <h1 className="text-lg font-semibold">This page is not here</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        The address may be mistyped, or the page may have been removed.
      </p>
      <Link href="/" className={buttonVariants({ className: "mt-2" })}>
        Go to QuickTec
      </Link>
    </div>
  );
}
