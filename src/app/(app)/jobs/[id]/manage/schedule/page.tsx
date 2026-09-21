import { redirect, notFound } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { db } from "@/lib/db";
import { toCents } from "@/lib/money";
import { loadPunchBlocks } from "@/lib/punch-blocks";
import { getSessionUser } from "@/lib/session";
import { JobPay } from "../../job-pay";
import { BudgetForm } from "./budget-form";
import { Punches } from "./punches";

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
  return { title: job ? `${job.title} — Schedule & Budget` : "Schedule & Budget" };
}

/**
 * The things done to a job rather than on it.
 *
 * A page, not a sheet over the job. On a phone the overlay scrolled the page
 * behind it as often as itself, and what it held — somebody's whole day, and
 * what the job pays — is not glanceable anyway. A page also means the browser's
 * Back means what it says.
 *
 * The blocks themselves are built in @/lib/punch-blocks, because the review
 * shows the same ones: a reviewer told a clock-out is wrong should be able to
 * fix it where they are told, not somewhere else and then start the read-through
 * again.
 */
export default async function ManagePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/signin");

  const { id } = await params;

  const blocks = await loadPunchBlocks(id, user);
  if (!blocks) notFound();
  if (!blocks.visible && !blocks.canSetPay) notFound();

  const job = await db.job.findUniqueOrThrow({
    where: { id },
    select: {
      id: true,
      title: true,
      intWoId: true,
      payType: true,
      payRate: true,
      travelReimbursement: true,
      budgetType: true,
      budgetFlat: true,
      budgetFlatHours: true,
      budgetHourly: true,
      budgetSplit: true,
      assignments: {
        orderBy: [{ isLead: "desc" }, { createdAt: "asc" }],
        select: {
          id: true,
          isLead: true,
          shareBasisPoints: true,
          user: { select: { name: true, defaultPayRate: true } },
        },
      },
    },
  });

  const crew = job.assignments.map((assignment) => ({
    assignmentId: assignment.id,
    name: assignment.user.name,
    isLead: assignment.isLead,
    defaultRateCents: assignment.user.defaultPayRate
      ? toCents(assignment.user.defaultPayRate)
      : 0,
    shareBasisPoints: assignment.shareBasisPoints,
  }));

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <PageHeader
        title="Schedule & Budget"
        backHref={`/jobs/${job.id}/manage`}
        description={`Manager Portal · ${job.intWoId}`}
      />

      {blocks.visible ? (
        <Card>
          <CardHeader>
            <CardTitle>TimeClock Punches</CardTitle>
          </CardHeader>
          <CardContent>
            <Punches
              punches={blocks.punches}
              companyName={blocks.companyName}
            />
          </CardContent>
        </Card>
      ) : null}

      {blocks.canSetPay ? (
        <Card>
          <CardHeader>
            <CardTitle>Total tech budget</CardTitle>
            <CardDescription>
              Everything the crew is paid from this job, and nothing else. It
              is not a ceiling held beside their lines — it is their lines
              added up, so payroll has one number to reconcile against.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <BudgetForm
              jobId={job.id}
              crew={crew}
              canEdit={blocks.canSetPay}
              budgetType={job.budgetType}
              budgetFlat={job.budgetFlat?.toString() ?? ""}
              budgetFlatHours={job.budgetFlatHours?.toString() ?? ""}
              budgetHourly={job.budgetHourly?.toString() ?? ""}
              splitMode={job.budgetSplit}
            />
          </CardContent>
        </Card>
      ) : null}

      {blocks.canSetPay && !job.budgetType ? (
        <Card>
          <CardHeader>
            <CardTitle>Pay, the old way</CardTitle>
            <CardDescription>
              One rate applied to everybody, rather than a total shared between
              them. Still here because every job raised before budgets is on
              it; setting a budget above replaces it.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <JobPay
              jobId={job.id}
              canEdit={blocks.canSetPay}
              payType={job.payType ?? "HOURLY"}
              payRate={job.payRate?.toString() ?? ""}
              travelReimbursement={job.travelReimbursement?.toString() ?? null}
              note={
                job.payType
                  ? "Applies to everybody on this job, including anybody added later. Somebody put on their own rate keeps it."
                  : "Not set — everybody keeps their own rate, or the project's default where they have none."
              }
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
