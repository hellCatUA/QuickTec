import { MapPin } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/page-header";
import { formatAddress, mapsUrl, siteLabel } from "@/lib/address";
import { getCompanySettings } from "@/lib/company";
import { usDateInZone, usDateTimeInZone, usTimeInZone } from "@/lib/datetime";
import { db } from "@/lib/db";
import {
  INTERNAL_STATUS_META,
  LIFECYCLE_META,
  OUTCOME_META,
} from "@/lib/job-status";
import { jobScopeWhere } from "@/lib/scope";
import { getSessionUser } from "@/lib/session";
import { jobSpan } from "@/lib/time-tracking";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const site = await db.site.findUnique({
    where: { id },
    select: { siteNumber: true, customer: { select: { code: true } } },
  });
  return {
    title: site ? siteLabel(site.customer.code, site.siteNumber) : "Site",
  };
}

/**
 * Everything that has happened at one location.
 *
 * The question this answers is "what do we know about this site" — who has
 * been, what they found, whether anything needed a second trip. Scoped like
 * the job list, so a tech sees their own visits and a supervisor sees the
 * crew's.
 */
export default async function SiteHistoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/signin");

  const { id } = await params;
  const scopeWhere = await jobScopeWhere(user, "job.view");
  if (!scopeWhere) redirect("/dashboard");

  const company = await getCompanySettings();

  const site = await db.site.findUnique({
    where: { id },
    select: {
      id: true,
      siteNumber: true,
      name: true,
      addressLine1: true,
      addressLine2: true,
      city: true,
      state: true,
      postalCode: true,
      country: true,
      timeZone: true,
      notes: true,
      customer: { select: { id: true, name: true, code: true } },
    },
  });
  if (!site) notFound();

  const zone = site.timeZone ?? company.defaultTimeZone;

  const jobs = await db.job.findMany({
    where: { AND: [scopeWhere, { siteId: site.id }] },
    orderBy: [{ scheduledStart: "desc" }, { createdAt: "desc" }],
    take: 200,
    select: {
      id: true,
      intWoId: true,
      title: true,
      externalAssignmentId: true,
      scheduledStart: true,
      createdAt: true,
      lifecycle: true,
      outcome: true,
      internalStatus: true,
      revisitNumber: true,
      parentJobId: true,
      client: { select: { name: true } },
      project: { select: { name: true } },
      createdBy: { select: { name: true } },
      assignments: {
        orderBy: { isLead: "desc" },
        select: {
          isLead: true,
          user: { select: { name: true } },
          visits: {
            select: { clockInAt: true, clockOutAt: true, breaks: true },
          },
        },
      },
      _count: { select: { deliverables: true, revisits: true } },
    },
  });

  const visited = jobs.filter((job) =>
    job.assignments.some((assignment) => assignment.visits.length > 0),
  ).length;
  const revisits = jobs.filter((job) => job.revisitNumber !== null).length;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <PageHeader
        title={siteLabel(site.customer.code, site.siteNumber)}
        backHref={`/directory/customers/${site.customer.id}`}
        description={site.name ?? site.customer.name}
      />

      <Card>
        <CardContent className="flex flex-col gap-2">
          <a
            href={mapsUrl(site)}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-sm text-primary underline-offset-4 hover:underline"
          >
            <MapPin className="size-3.5 shrink-0" />
            {formatAddress(site)}
          </a>

          {site.notes ? (
            <p className="text-xs text-muted-foreground">{site.notes}</p>
          ) : null}

          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <span>
              <span className="text-muted-foreground">Jobs </span>
              <span className="tabular">{jobs.length}</span>
            </span>
            <span>
              <span className="text-muted-foreground">Visited </span>
              <span className="tabular">{visited}</span>
            </span>
            <span>
              <span className="text-muted-foreground">Revisits </span>
              <span className="tabular">{revisits}</span>
            </span>
            <span className="text-xs text-muted-foreground">{zone}</span>
          </div>
        </CardContent>
      </Card>

      {jobs.length === 0 ? (
        <EmptyState
          title="No visits recorded"
          description="Jobs dispatched to this site will appear here as they are created."
        />
      ) : null}

      {jobs.map((job) => {
        const span = jobSpan(
          job.assignments.flatMap((assignment) => assignment.visits),
        );

        return (
          <Card key={job.id}>
            <CardHeader>
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/jobs/${job.id}`}
                  className="text-sm font-semibold text-primary underline-offset-4 hover:underline"
                >
                  {job.title}
                </Link>
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
                    variant={INTERNAL_STATUS_META[job.internalStatus].variant}
                  >
                    {INTERNAL_STATUS_META[job.internalStatus].label}
                  </Badge>
                ) : null}
                {job.revisitNumber ? (
                  <Badge variant="warning">Revisit {job.revisitNumber}</Badge>
                ) : null}
              </div>

              <CardDescription>
                <span className="tabular">{job.intWoId}</span>
                {job.externalAssignmentId
                  ? ` · ${job.externalAssignmentId}`
                  : ""}{" "}
                · {job.client.name}
                {job.project ? ` · ${job.project.name}` : ""}
              </CardDescription>
            </CardHeader>

            <CardContent className="flex flex-col gap-2 text-sm">
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
                <span>
                  Scheduled{" "}
                  {job.scheduledStart
                    ? usDateTimeInZone(job.scheduledStart, zone)
                    : "not set"}
                </span>
                {span.onsiteAt ? (
                  <span>
                    On site {usDateInZone(span.onsiteAt, zone)}{" "}
                    {usTimeInZone(span.onsiteAt, zone)}
                    {span.offsiteAt
                      ? ` – ${usTimeInZone(span.offsiteAt, zone)}`
                      : " – still on site"}
                  </span>
                ) : (
                  <span>Never clocked in</span>
                )}
                {span.totalMinutes > 0 ? (
                  <span>{(span.totalMinutes / 60).toFixed(2)} hrs</span>
                ) : null}
              </div>

              <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
                <span>
                  Crew:{" "}
                  {job.assignments.length === 0
                    ? "nobody assigned"
                    : job.assignments
                        .map(
                          (assignment) =>
                            `${assignment.user.name}${assignment.isLead ? " (lead)" : ""}`,
                        )
                        .join(", ")}
                </span>
                <span>Raised by {job.createdBy.name}</span>
                {job._count.deliverables > 0 ? (
                  <span>{job._count.deliverables} deliverables</span>
                ) : null}
                {job._count.revisits > 0 ? (
                  <span className="text-warning">
                    {job._count.revisits} revisit
                    {job._count.revisits === 1 ? "" : "s"} followed
                  </span>
                ) : null}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
