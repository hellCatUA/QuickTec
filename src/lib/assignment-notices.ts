import { siteLabelOnScreen } from "@/lib/address";
import { getCompanySettings } from "@/lib/company";
import { usDateTimeInZone } from "@/lib/datetime";
import { db } from "@/lib/db";
import { notify } from "@/lib/notifications";

/**
 * "You are on …", to whoever was just put on a job, and the same news to the
 * supervisor who pays for their time.
 *
 * One place for it, because there are three ways onto a job and only one of
 * them used to say anything. Somebody added to a job afterwards was told;
 * somebody put on it as it was raised — which is most people, most of the
 * time — or sent on a revisit found out by noticing their week had changed.
 *
 * The body says when and where, not only which: a project's jobs share a
 * title, so a tech put on five of them read five notices that differed by a
 * work order number and said nothing about which morning or which town.
 *
 * Nobody is told about their own doing (`notify` skips the actor). And a
 * supervisor is not told that somebody put themselves on a job: that is a tech
 * raising their own ad-hoc job, which reaches the supervisor as a job to
 * approve already — the same news twice, the second time as noise.
 */
export async function announceAssignments(input: {
  jobId: string;
  actorId: string;
  people: { userId: string; supervisorId: string | null }[];
}): Promise<void> {
  if (input.people.length === 0) return;

  try {
    const [job, company, names] = await Promise.all([
      db.job.findUniqueOrThrow({
        where: { id: input.jobId },
        select: {
          title: true,
          intWoId: true,
          scheduledStart: true,
          customer: { select: { code: true } },
          site: {
            select: {
              siteNumber: true,
              numberPending: true,
              city: true,
              state: true,
              timeZone: true,
            },
          },
        },
      }),
      getCompanySettings(),
      db.user.findMany({
        where: { id: { in: input.people.map((person) => person.userId) } },
        select: { id: true, name: true },
      }),
    ]);

    const zone = job.site.timeZone ?? company.defaultTimeZone;
    const whenAndWhere = [
      job.intWoId,
      job.scheduledStart
        ? usDateTimeInZone(job.scheduledStart, zone)
        : "not scheduled yet",
      `${siteLabelOnScreen(job.customer.code, job.site)} · ${job.site.city}, ${job.site.state}`,
    ].join(" · ");
    const nameOf = new Map(names.map((person) => [person.id, person.name]));

    for (const person of input.people) {
      await notify({
        userId: person.userId,
        actorId: input.actorId,
        kind: "job_assigned",
        title: `You are on ${job.title}`,
        body: whenAndWhere,
        href: `/jobs/${input.jobId}`,
        jobId: input.jobId,
      });

      if (
        person.supervisorId &&
        person.supervisorId !== person.userId &&
        person.userId !== input.actorId
      ) {
        await notify({
          userId: person.supervisorId,
          actorId: input.actorId,
          kind: "job_assigned",
          title: `${nameOf.get(person.userId) ?? "Somebody"} was put on ${job.title}`,
          body: whenAndWhere,
          href: `/jobs/${input.jobId}`,
          jobId: input.jobId,
        });
      }
    }
  } catch (error) {
    // Like every notice, never the point of what it accompanies: the crew are
    // on the job whether or not they were told so.
    console.error("[announceAssignments] could not notify:", error);
  }
}
