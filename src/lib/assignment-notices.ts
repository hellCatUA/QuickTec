import { placeLabel, siteLabelOnScreen } from "@/lib/address";
import { getCompanySettings } from "@/lib/company";
import { usDateTimeInZone } from "@/lib/datetime";
import { db } from "@/lib/db";
import { notify } from "@/lib/notifications";

/**
 * "You are on …", to whoever was just put on a job, and the news to the two
 * people who answer for their time there.
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
 * Who else is told, and why both:
 * - the job's approver for them (the assignment's supervisor — on a project,
 *   its manager), who signs off their time on this job;
 * - their direct supervisor, who pays them. Payroll follows that link
 *   whatever project the work is on, so on a project job this is somebody
 *   else, and it used to be the one person never told.
 * Each of those hears once per job, however many of their people were put on
 * it — a crew of four used to be four notices to acknowledge for one job.
 *
 * Nobody is told about their own doing (`notify` skips the actor). And nobody
 * is told that a tech put themselves on their own ad-hoc job: that job is
 * waiting in the same people's Approvals already, and the same news twice is
 * the second time noise.
 */
export async function announceAssignments(input: {
  jobId: string;
  actorId: string;
  /** Who was put on it, with the approver their assignment was given. */
  people: { userId: string; supervisorId: string | null }[];
}): Promise<void> {
  if (input.people.length === 0) return;

  try {
    const [job, company, users] = await Promise.all([
      db.job.findUniqueOrThrow({
        where: { id: input.jobId },
        select: {
          title: true,
          intWoId: true,
          lifecycle: true,
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
        select: { id: true, name: true, directSupervisorId: true },
      }),
    ]);

    const zone = job.site.timeZone ?? company.defaultTimeZone;
    const whenAndWhere = [
      job.intWoId,
      job.scheduledStart
        ? usDateTimeInZone(job.scheduledStart, zone)
        : "not scheduled yet",
      placeLabel(siteLabelOnScreen(job.customer.code, job.site), job.site),
    ].join(" · ");
    const byId = new Map(users.map((user) => [user.id, user]));

    // Who answers for whose time, gathered so each hears once.
    const toTell = new Map<string, string[]>();
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

      const raisedOwnAdHoc =
        person.userId === input.actorId && job.lifecycle === "PENDING_APPROVAL";
      if (raisedOwnAdHoc) continue;

      const user = byId.get(person.userId);
      const answerFor = new Set(
        [person.supervisorId, user?.directSupervisorId].filter(
          (id): id is string => Boolean(id) && id !== person.userId,
        ),
      );
      for (const id of answerFor) {
        toTell.set(id, [...(toTell.get(id) ?? []), user?.name ?? "Somebody"]);
      }
    }

    for (const [userId, names] of toTell) {
      await notify({
        userId,
        actorId: input.actorId,
        kind: "job_assigned",
        title: `${namesList(names)} ${names.length === 1 ? "was" : "were"} put on ${job.title}`,
        body: whenAndWhere,
        href: `/jobs/${input.jobId}`,
        jobId: input.jobId,
      });
    }
  } catch (error) {
    // Like every notice, never the point of what it accompanies: the crew are
    // on the job whether or not they were told so.
    console.error("[announceAssignments] could not notify:", error);
  }
}

/** "Terry", "Terry and Tina", "Terry, Tina and 2 others". */
function namesList(names: string[]): string {
  if (names.length <= 2) return names.join(" and ");
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} others`;
}
