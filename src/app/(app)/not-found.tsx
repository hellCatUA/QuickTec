import { SearchX } from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export const metadata = { title: "Not found" };

/**
 * A page that is not there, said inside the app.
 *
 * Without this the framework's own answer was shown: a white page with "404"
 * in black, in the middle of a dark app, whose stylesheet also turned the
 * company's name in the header black on its dark bar. And it is not a rare
 * page. Every job, project and person somebody may not open answers with it,
 * so a tech taken off a job meets it by tapping yesterday's notification.
 *
 * Nothing here asks the database anything: it is prerendered with the build.
 */
export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center">
      <SearchX className="size-10 text-muted-foreground" />
      <h1 className="text-lg font-semibold">This page is not here</h1>
      <p className="text-sm text-muted-foreground">
        It may have been removed, or it is not one you can open — a job you
        were taken off is no longer yours to see.
      </p>
      <div className="mt-2 flex flex-wrap justify-center gap-2">
        <Link href="/jobs" className={buttonVariants()}>
          Jobs
        </Link>
        <Link
          href="/dashboard"
          className={buttonVariants({ variant: "secondary" })}
        >
          Dashboard
        </Link>
      </div>
    </div>
  );
}
