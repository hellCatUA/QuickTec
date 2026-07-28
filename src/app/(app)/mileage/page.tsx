import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/page-header";
import { getCompanySettings } from "@/lib/company";
import { usDateInZone } from "@/lib/datetime";
import { db } from "@/lib/db";
import { MILEAGE_META, availableCategories } from "@/lib/mileage";
import { formatMoney } from "@/lib/money";
import { startOfWeekMonday } from "@/lib/datetime";
import { reportIds } from "@/lib/scope";
import { getSessionUser, permissionScope } from "@/lib/session";
import { MileageForm } from "./mileage-form";
import { MileageList } from "./mileage-list";

export const metadata = { title: "Mileage" };

export default async function MileagePage({
  searchParams,
}: {
  searchParams: Promise<{ user?: string }>;
}) {
  const viewer = await getSessionUser();
  if (!viewer) redirect("/signin");

  const canLog = Boolean(permissionScope(viewer, "mileage.submit"));
  const viewScope = permissionScope(viewer, "mileage.view");
  if (!canLog && !viewScope) redirect("/dashboard");

  const company = await getCompanySettings();
  const { user: requestedUser } = await searchParams;

  // A supervisor can look at their team's trips; everyone else sees their own.
  const visibleIds =
    viewScope === "ALL"
      ? null
      : viewScope
        ? [viewer.id, ...(await reportIds(viewer.id))]
        : [viewer.id];

  const subjectId =
    requestedUser && (visibleIds === null || visibleIds.includes(requestedUser))
      ? requestedUser
      : viewer.id;

  const [entries, openVisit, assignedJobs, team] = await Promise.all([
    db.mileageEntry.findMany({
      where: { userId: subjectId },
      orderBy: { startedAt: "desc" },
      take: 100,
      select: {
        id: true,
        category: true,
        reference: true,
        startOdometer: true,
        endOdometer: true,
        miles: true,
        rate: true,
        amount: true,
        startedAt: true,
        endedAt: true,
        note: true,
        startPhotoId: true,
        endPhotoId: true,
        job: { select: { id: true, title: true } },
      },
    }),
    db.visit.findFirst({
      where: { assignment: { userId: viewer.id }, clockOutAt: null },
      select: { id: true, assignment: { select: { jobId: true } } },
    }),
    db.jobAssignment.findMany({
      where: { userId: viewer.id, job: { lifecycle: { not: "APPROVED" } } },
      orderBy: { createdAt: "desc" },
      take: 25,
      select: {
        job: { select: { id: true, title: true, externalAssignmentId: true } },
      },
    }),
    visibleIds === null
      ? db.user.findMany({
          where: { active: true },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        })
      : db.user.findMany({
          where: { id: { in: visibleIds } },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        }),
  ]);

  const zone = company.defaultTimeZone;
  const weekStart = startOfWeekMonday(new Date(), zone);

  const thisWeek = entries.filter((entry) => entry.startedAt >= weekStart);
  const weekMiles = thisWeek.reduce((sum, entry) => sum + Number(entry.miles), 0);
  const weekValue = thisWeek.reduce((sum, entry) => sum + Number(entry.amount), 0);

  const isOwn = subjectId === viewer.id;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <PageHeader
        title="Mileage"
        description={`A write-off record, not a payment. Current rate ${formatMoney(company.mileageRate.toString())} per mile.`}
      />

      {team.length > 1 ? (
        <div className="flex flex-wrap gap-1.5">
          {team.map((person) => (
            <a key={person.id} href={`/mileage?user=${person.id}`}>
              <Badge variant={person.id === subjectId ? "primary" : "neutral"}>
                {person.id === viewer.id ? "You" : person.name}
              </Badge>
            </a>
          ))}
        </div>
      ) : null}

      <Card>
        <CardContent className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              This week
            </div>
            <div className="tabular text-2xl font-semibold">
              {weekMiles.toFixed(1)} mi
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Deductible
            </div>
            <div className="tabular text-2xl font-semibold">
              {formatMoney(weekValue)}
            </div>
          </div>
          <div className="text-xs text-muted-foreground">
            Week of {usDateInZone(weekStart, zone)}
          </div>
        </CardContent>
      </Card>

      {canLog && isOwn ? (
        <MileageForm
          categories={availableCategories(Boolean(openVisit))}
          clockedIn={Boolean(openVisit)}
          currentJobId={openVisit?.assignment.jobId ?? null}
          jobs={assignedJobs.map((assignment) => ({
            id: assignment.job.id,
            label: assignment.job.externalAssignmentId
              ? `${assignment.job.title} (${assignment.job.externalAssignmentId})`
              : assignment.job.title,
          }))}
        />
      ) : null}

      {entries.length === 0 ? (
        <EmptyState
          title="No trips logged"
          description={
            isOwn
              ? "Log each leg separately: out to the job, any supply run, and the drive home."
              : "This tech has not logged any trips."
          }
        />
      ) : (
        <MileageList
          entries={entries.map((entry) => ({
            id: entry.id,
            category: entry.category,
            categoryLabel: MILEAGE_META[entry.category].label,
            reference: entry.reference,
            jobTitle: entry.job?.title ?? null,
            startOdometer: entry.startOdometer.toString(),
            endOdometer: entry.endOdometer.toString(),
            miles: entry.miles.toString(),
            amount: entry.amount.toString(),
            date: usDateInZone(entry.startedAt, zone),
            note: entry.note,
            startPhotoId: entry.startPhotoId,
            endPhotoId: entry.endPhotoId,
          }))}
          canDelete={isOwn}
        />
      )}
    </div>
  );
}
