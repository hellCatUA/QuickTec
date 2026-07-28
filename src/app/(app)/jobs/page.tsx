import { ChevronRight, Plus } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/page-header";
import { siteLabel } from "@/lib/address";
import { getCompanySettings } from "@/lib/company";
import { usDateTimeInZone } from "@/lib/datetime";
import { db } from "@/lib/db";
import {
  INTERNAL_STATUS_META,
  LIFECYCLE_META,
  OPEN_LIFECYCLES,
  OUTCOME_META,
} from "@/lib/job-status";
import { jobScopeWhere } from "@/lib/scope";
import { can, getSessionUser } from "@/lib/session";
import type { JobLifecycle } from "@prisma-client";

export const metadata = { title: "Jobs" };

const FILTERS = [
  { key: "open", label: "Open" },
  { key: "all", label: "All" },
  { key: "approved", label: "Approved" },
] as const;

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/signin");

  const where = await jobScopeWhere(user, "job.view");
  if (!where) redirect("/dashboard");

  const { filter = "open" } = await searchParams;
  const company = await getCompanySettings();

  const lifecycleFilter: { lifecycle?: { in: JobLifecycle[] } } =
    filter === "open"
      ? { lifecycle: { in: OPEN_LIFECYCLES } }
      : filter === "approved"
        ? { lifecycle: { in: ["APPROVED"] } }
        : {};

  const jobs = await db.job.findMany({
    where: { AND: [where, lifecycleFilter] },
    orderBy: [{ scheduledStart: "asc" }, { createdAt: "desc" }],
    take: 100,
    select: {
      id: true,
      intWoId: true,
      title: true,
      externalAssignmentId: true,
      scheduledStart: true,
      lifecycle: true,
      outcome: true,
      internalStatus: true,
      revisitNumber: true,
      client: { select: { name: true } },
      customer: { select: { code: true } },
      site: { select: { siteNumber: true, city: true, state: true, timeZone: true } },
      assignments: {
        select: { isLead: true, user: { select: { name: true } } },
      },
    },
  });

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <PageHeader
        title="Jobs"
        actions={
          can(user, "job.create") ? (
            <Link href="/jobs/new">
              <Button size="sm">
                <Plus /> New job
              </Button>
            </Link>
          ) : null
        }
      />

      <div className="flex gap-1 rounded-lg border border-border bg-surface p-1">
        {FILTERS.map((option) => (
          <Link
            key={option.key}
            href={`/jobs?filter=${option.key}`}
            className={`flex-1 rounded-md px-3 py-1.5 text-center text-sm font-medium transition-colors ${
              filter === option.key
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted"
            }`}
          >
            {option.label}
          </Link>
        ))}
      </div>

      {jobs.length === 0 ? (
        <EmptyState
          title="Nothing here"
          description={
            filter === "open"
              ? "No open jobs you can see. Try the All tab."
              : "No jobs match this filter yet."
          }
        />
      ) : null}

      <div className="flex flex-col gap-2">
        {jobs.map((job) => {
          const zone = job.site.timeZone ?? company.defaultTimeZone;
          const lead = job.assignments.find((a) => a.isLead)?.user.name;
          const others = job.assignments.filter((a) => !a.isLead).length;

          return (
            <Link key={job.id} href={`/jobs/${job.id}`}>
              <Card className="transition-colors hover:border-primary/50">
                <CardContent className="flex items-center gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-sm font-semibold">
                        {job.title}
                      </span>
                      {job.revisitNumber ? (
                        <Badge variant="warning">R{job.revisitNumber}</Badge>
                      ) : null}
                      <Badge variant={LIFECYCLE_META[job.lifecycle].variant}>
                        {LIFECYCLE_META[job.lifecycle].label}
                      </Badge>
                      {job.outcome ? (
                        <Badge variant={OUTCOME_META[job.outcome].variant}>
                          {OUTCOME_META[job.outcome].label}
                        </Badge>
                      ) : null}
                      {job.internalStatus ? (
                        <Badge
                          variant={
                            INTERNAL_STATUS_META[job.internalStatus].variant
                          }
                        >
                          {INTERNAL_STATUS_META[job.internalStatus].label}
                        </Badge>
                      ) : null}
                    </div>

                    <div className="mt-0.5 truncate text-xs text-muted-foreground">
                      {siteLabel(job.customer.code, job.site.siteNumber)} ·{" "}
                      {job.site.city}, {job.site.state} · {job.client.name}
                    </div>

                    <div className="mt-0.5 truncate text-xs text-muted-foreground">
                      <span className="tabular">{job.intWoId}</span>
                      {job.externalAssignmentId
                        ? ` · ${job.externalAssignmentId}`
                        : ""}
                      {job.scheduledStart
                        ? ` · ${usDateTimeInZone(job.scheduledStart, zone)}`
                        : " · not scheduled"}
                    </div>

                    {job.assignments.length > 0 ? (
                      <div className="mt-0.5 truncate text-xs text-muted-foreground">
                        {lead ? `Lead: ${lead}` : "No lead"}
                        {others > 0
                          ? ` +${others} tech${others === 1 ? "" : "s"}`
                          : ""}
                      </div>
                    ) : (
                      <div className="mt-0.5 text-xs text-warning">
                        Nobody assigned
                      </div>
                    )}
                  </div>

                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
