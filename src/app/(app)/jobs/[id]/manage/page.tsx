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
import { loadPunchBlocks } from "@/lib/punch-blocks";
import { getSessionUser } from "@/lib/session";
import { JobPay } from "../job-pay";
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
  return { title: job ? `${job.title} — Manager Portal` : "Manager Portal" };
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
    },
  });

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <PageHeader
        title={`${job.title} — Manager Portal`}
        backHref={`/jobs/${job.id}`}
        description={job.intWoId}
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
            <CardTitle>Pay</CardTitle>
            <CardDescription>
              What this job pays, for everybody on it. Normally inherited from
              the tech, the project or the company — set it here when this job is
              none of those.
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
