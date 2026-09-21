import { ShieldCheck } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { db } from "@/lib/db";
import { loadPortal } from "@/lib/job-portal";
import { getSessionUser } from "@/lib/session";

import { PortalGrid } from "./portal-grid";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const job = await db.job.findUnique({
    where: { id },
    select: { title: true },
  });
  return { title: job ? `${job.title} — Manager Portal` : "Manager Portal" };
}

/**
 * One door for everything done *to* a job.
 *
 * It used to be two pages and a drawer, and which one held a thing was
 * learned rather than guessed. Now there is one address, and everything
 * behind it is a page of its own with a Back that works.
 *
 * The screen is worth opening before anything has gone wrong, which is why
 * every destination carries its own state rather than only its name: "on the
 * clock 6h 12m" is worth a tap, "Schedule & Budget" is not.
 */
export default async function ManagerPortalPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/signin");

  const { id } = await params;
  const portal = await loadPortal(id, user);
  if (!portal) notFound();

  // A tech reaching this address by hand finds nothing: their one destination
  // keeps its own line on the job's menu, and a door into a corridor is worse
  // than no door.
  if (!portal.open || portal.items.length === 0) notFound();

  const waiting = portal.items.filter((item) => item.group === "action");
  const admin = portal.items.filter((item) => item.group === "admin");

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-3.5">
      <PageHeader
        title="Manager Portal"
        backHref={`/jobs/${portal.jobId}`}
        description={`${portal.title} · ${portal.intWoId}`}
        actions={<Badge variant="primary">{portal.stage}</Badge>}
      />

      {portal.reach ? (
        <div className="flex gap-2.5 rounded-xl border border-warning/40 bg-warning/10 p-3">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-warning" />
          <p className="text-xs leading-relaxed text-muted-foreground">
            <span className="font-semibold text-warning">Limited access. </span>
            {portal.reach}
          </p>
        </div>
      ) : null}

      <PortalGrid label="Requires action" items={waiting} />
      <PortalGrid label="Job administration" items={admin} />

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Locked items keep their place, so the grid never reshuffles as the job
        moves on. Nothing here is hidden from you — what you cannot change
        outright, you can ask for in the same place.
      </p>
    </div>
  );
}
