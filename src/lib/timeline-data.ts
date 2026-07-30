import type { TimelineRow } from "@/components/timeline";
import { usDateTimeInZone } from "@/lib/datetime";
import { db } from "@/lib/db";
import {
  groupTimeline,
  timelineSubject,
  type TimelineDetail,
  type TimelineEvent,
} from "@/lib/timeline";

/**
 * Loads a history and shapes it for the client component.
 *
 * Formatting happens here rather than in the component so every timestamp is
 * rendered in the site's zone by the server — the same instant must not read
 * differently depending on where the phone thinks it is.
 */
export async function loadTimeline(
  where: { jobId: string } | { projectId: string },
  timeZone: string,
  { take = 200 }: { take?: number } = {},
): Promise<TimelineRow[]> {
  const events = await db.auditEvent.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      action: true,
      detail: true,
      createdAt: true,
      actor: { select: { name: true } },
    },
  });

  const shaped: TimelineEvent[] = events.map((event) => ({
    id: event.id,
    action: event.action,
    createdAt: event.createdAt,
    actorName: event.actor?.name ?? null,
    detail: (event.detail as TimelineDetail | null) ?? null,
  }));

  return groupTimeline(shaped).map((group) => ({
    key: group.key,
    action: group.action,
    entries: group.events.map((event) => ({
      id: event.id,
      when: usDateTimeInZone(event.createdAt, timeZone),
      subject: timelineSubject(event.detail),
      actor: event.actorName,
      from: event.detail?.from ?? null,
      to: event.detail?.to ?? null,
      reason: event.detail?.reason ?? null,
    })),
  }));
}
