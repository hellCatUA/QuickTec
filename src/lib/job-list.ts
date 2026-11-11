import { placeLabel, siteLabelOnScreen } from "@/lib/address";
import {
  isoDateInZone,
  parseZonedDate,
  usTimeInZone,
  zonedParts,
} from "@/lib/datetime";
import {
  INTERNAL_STATUS_META,
  LIFECYCLE_META,
  OPEN_LIFECYCLES,
  OUTCOME_META,
} from "@/lib/job-status";
import type {
  JobInternalStatus,
  JobLifecycle,
  JobOutcome,
  Prisma,
} from "@prisma-client";

/**
 * The Jobs list: what its address asks for, which jobs that is, and how they
 * are laid out — kept apart from the page so the rules can be checked without
 * a browser.
 */

export const JOBS_TABS = [
  { key: "open", label: "Open" },
  // Its own tab rather than a badge to scan for: a job needing a return trip
  // is raised on site and then acted on days later by somebody else, and a
  // flag nobody can filter by is a flag nobody sees.
  { key: "revisit", label: "Revisit" },
  { key: "all", label: "All" },
  { key: "approved", label: "Approved" },
] as const;

export type JobsTab = (typeof JOBS_TABS)[number]["key"];

/** How many jobs one page of the list holds. */
export const JOBS_LIST_LIMIT = 100;

/** What the list was asked for, read off its address. */
export type JobsQuery = {
  tab: JobsTab;
  /** Words to find, each somewhere on the job. */
  q: string;
  /** "YYYY-MM-DD" on the site's calendar, both ends included. */
  from: string | null;
  to: string | null;
  /** Somebody on the crew. Only for those who see more than their own. */
  tech: string | null;
  /** The paying company. */
  company: string | null;
  customer: string | null;
};

type Params = Record<string, string | string[] | undefined>;

function realDay(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  // "2026-02-31" is a well-formed string and no day at all.
  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
  return date.getUTCDate() === Number(match[3]) &&
    date.getUTCMonth() === Number(match[2]) - 1
    ? value
    : null;
}

export function parseJobsQuery(params: Params): JobsQuery {
  const one = (key: string) => {
    const value = params[key];
    return ((Array.isArray(value) ? value[0] : value) ?? "").trim();
  };
  const id = (key: string) => {
    const value = one(key);
    return /^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : null;
  };

  const asked = one("filter");
  const tab = JOBS_TABS.find((option) => option.key === asked)?.key ?? "open";

  let from = realDay(one("from"));
  let to = realDay(one("to"));
  // Typed the wrong way round, it still means the days between them.
  if (from && to && from > to) [from, to] = [to, from];

  return {
    tab,
    q: one("q").replace(/\s+/g, " ").slice(0, 100),
    from,
    to,
    tech: id("tech"),
    company: id("company"),
    customer: id("customer"),
  };
}

/** The list's address with some of what it asks for changed. */
export function jobsHref(query: JobsQuery, change: Partial<JobsQuery> = {}) {
  const next = { ...query, ...change };
  const params = new URLSearchParams({ filter: next.tab });
  if (next.q) params.set("q", next.q);
  if (next.from) params.set("from", next.from);
  if (next.to) params.set("to", next.to);
  if (next.tech) params.set("tech", next.tech);
  if (next.company) params.set("company", next.company);
  if (next.customer) params.set("customer", next.customer);
  return `/jobs?${params}`;
}

const DAY_MS = 86_400_000;

/**
 * The filters as a database question, to be ANDed with what the person may
 * see at all. Nothing here widens that: each part only narrows it.
 */
export function jobsWhere(
  query: JobsQuery,
  options: {
    /** Whether they see more than their own jobs, and so may pick a tech. */
    wide: boolean;
    fallbackZone: string;
  },
): Prisma.JobWhereInput {
  const and: Prisma.JobWhereInput[] = [];

  if (query.tab === "open") and.push({ lifecycle: { in: OPEN_LIFECYCLES } });
  else if (query.tab === "approved") and.push({ lifecycle: "APPROVED" });
  else if (query.tab === "revisit") and.push({ internalStatus: "REVISIT_REQUIRED" });

  // Every word has to be found somewhere on the job, not all in one place:
  // "terry visalia" is Terry's job in Visalia.
  for (const word of query.q.split(" ").filter(Boolean).slice(0, 6)) {
    const has = { contains: word, mode: "insensitive" as const };
    and.push({
      OR: [
        { intWoId: has },
        { title: has },
        { externalAssignmentId: has },
        {
          site: {
            OR: [
              { siteNumber: has },
              { name: has },
              { addressLine1: has },
              { city: has },
              { postalCode: has },
            ],
          },
        },
        { client: { name: has } },
        { customer: { OR: [{ code: has }, { name: has }] } },
        { project: { is: { OR: [{ name: has }, { code: has }] } } },
        { assignments: { some: { user: { name: has } } } },
      ],
    });
  }

  if (options.wide && query.tech) {
    and.push({ assignments: { some: { userId: query.tech } } });
  }
  if (query.company) and.push({ clientId: query.company });
  if (query.customer) and.push({ customerId: query.customer });

  // Days are the site's, and sites sit in different zones, so the database is
  // asked for a day either side and `onDays` settles each job afterwards.
  if (query.from || query.to) {
    const range: Prisma.DateTimeFilter = {};
    const from = query.from && parseZonedDate(query.from, options.fallbackZone);
    const to = query.to && parseZonedDate(query.to, options.fallbackZone);
    if (from) range.gte = new Date(from.getTime() - DAY_MS);
    if (to) range.lt = new Date(to.getTime() + 2 * DAY_MS);
    and.push({ scheduledStart: range });
  }

  return { AND: and };
}

/** Whether a job falls on the days asked for, on its site's calendar. */
export function onDays(
  job: { scheduledStart: Date | null; site: { timeZone: string | null } },
  query: Pick<JobsQuery, "from" | "to">,
  fallbackZone: string,
): boolean {
  if (!query.from && !query.to) return true;
  if (!job.scheduledStart) return false;
  const day = isoDateInZone(
    job.scheduledStart,
    job.site.timeZone ?? fallbackZone,
  );
  return (!query.from || day >= query.from) && (!query.to || day <= query.to);
}

// --- laying it out -------------------------------------------------------------

type Variant = "neutral" | "primary" | "success" | "warning" | "danger";

export type ListedJob = {
  id: string;
  intWoId: string;
  title: string;
  scheduledStart: Date | null;
  lifecycle: JobLifecycle;
  outcome: JobOutcome | null;
  internalStatus: JobInternalStatus | null;
  revisitNumber: number | null;
  client: { name: string };
  customer: { code: string };
  site: {
    siteNumber: string;
    numberPending: boolean;
    city: string;
    state: string;
    timeZone: string | null;
  };
  assignments: { isLead: boolean; userId: string; user: { name: string } }[];
};

export type JobCard = {
  id: string;
  title: string;
  revisit: number | null;
  /** "7:30 AM" on the site's clock, or null when there is no date yet. */
  time: string | null;
  /** "Sat 11/7" or "Today", in a group that holds more than one day. */
  day: string | null;
  /** "SBUX #10542 · Visalia, CA" */
  place: string;
  badges: { label: string; variant: Variant }[];
  /** The lead and how many more: "Terry Tech +1", "You +2", or null. */
  crew: string | null;
  unassigned: boolean;
  /** "2611-SBX-POS-0005 · NetCom Sub" — ours, and who pays. */
  reference: string;
};

/** One day's jobs within a group; labelled when the group spans days. */
export type JobDay = { key: string; label: string | null; jobs: JobCard[] };

export type JobGroup = {
  key: string;
  label: string;
  count: number;
  days: JobDay[];
};

/** "Your jobs", "Other jobs", or the one unlabelled list. */
export type JobSection = {
  key: "mine" | "others" | "all";
  label: string | null;
  count: number;
  groups: JobGroup[];
};

type LayoutOptions = {
  now: Date;
  fallbackZone: string;
  viewerId: string;
  tab: JobsTab;
};

/**
 * The jobs, laid out.
 *
 * For somebody who sees more than their own, their own come first under
 * "Your jobs" and everybody else's after a divider, each laid out by day the
 * same way. A supervisor who also works in the field was finding their own
 * morning among the whole team's. Nobody's job is listed twice, and somebody
 * with no jobs of their own in the list gets it as before, without headings.
 */
export function listJobs(
  jobs: ListedJob[],
  options: LayoutOptions & { split: boolean },
): JobSection[] {
  if (!options.split) {
    return [
      { key: "all", label: null, count: jobs.length, groups: groupByDay(jobs, options) },
    ];
  }

  const isMine = (job: ListedJob) =>
    job.assignments.some((one) => one.userId === options.viewerId);
  const mine = jobs.filter(isMine);
  const others = jobs.filter((job) => !isMine(job));

  const sections: JobSection[] = [];
  if (mine.length > 0) {
    sections.push({
      key: "mine",
      label: "Your jobs",
      count: mine.length,
      groups: groupByDay(mine, options),
    });
  }
  if (others.length > 0) {
    sections.push({
      key: "others",
      label: mine.length > 0 ? "Other jobs" : null,
      count: others.length,
      groups: groupByDay(others, options),
    });
  }
  return sections;
}

/**
 * The jobs under a heading for each day, today first.
 *
 * Each on the site's own calendar, the clock its times are shown on. Of what
 * is still to do: first anything somebody is on right now or has to put
 * right, whatever day it was booked for; then today and the days after it;
 * then jobs with no date; then the stragglers from days already gone. At the
 * top used to be a job from June that nobody closed, above this morning's.
 * The history tabs read the other way from today: what is coming, then each
 * day back.
 *
 * A group that holds several days — In progress, Sent back, Earlier — is cut
 * into runs of one day each, so the days are as plain there as anywhere.
 */
export function groupByDay(jobs: ListedJob[], options: LayoutOptions): JobGroup[] {
  const stillOpen = options.tab === "open" || options.tab === "revisit";

  type Entry = { at: number; day: string; dayLabel: string; card: JobCard };
  const buckets = new Map<
    string,
    {
      label: string;
      rank: number;
      day: string;
      mixed: boolean;
      newestFirst: boolean;
      entries: Entry[];
    }
  >();

  for (const job of jobs) {
    const zone = job.site.timeZone ?? options.fallbackZone;
    const at = job.scheduledStart;
    const dayOf = (offset: number) =>
      isoDateInZone(new Date(options.now.getTime() + offset * DAY_MS), zone);
    const today = dayOf(0);
    const day = at ? isoDateInZone(at, zone) : null;
    const named = at ? dayName(at, zone, options.now) : null;
    const spoken =
      !day || !named
        ? "No date"
        : day === today
          ? `Today · ${named}`
          : day === dayOf(-1)
            ? `Yesterday · ${named}`
            : day === dayOf(1)
              ? `Tomorrow · ${named}`
              : named;

    let key: string;
    let label: string;
    let rank: number;
    let mixed = false;
    let newestFirst = false;
    if (stillOpen && job.lifecycle === "IN_PROGRESS") {
      key = "in-progress";
      label = LIFECYCLE_META.IN_PROGRESS.label;
      rank = 0;
      mixed = true;
    } else if (stillOpen && job.lifecycle === "CHANGES_REQUESTED") {
      key = "sent-back";
      label = LIFECYCLE_META.CHANGES_REQUESTED.label;
      rank = 1;
      mixed = true;
    } else if (!day) {
      key = "none";
      label = "No date yet";
      rank = 3;
    } else if (day >= today) {
      key = day;
      label = spoken;
      rank = 2;
    } else if (stillOpen) {
      key = "earlier";
      label = "Earlier — still open";
      rank = 4;
      mixed = true;
      newestFirst = true;
    } else {
      key = day;
      label = spoken;
      rank = 5;
      newestFirst = true;
    }

    // Only what the heading and the tab have not said already: "Scheduled"
    // on every card under a day still to come, or "Approved" on every card of
    // the Approved tab, is the same word thirty times.
    const upcoming = day !== null && day >= today;
    const sayLifecycle =
      key !== "in-progress" &&
      key !== "sent-back" &&
      options.tab !== "approved" &&
      // Nor "Scheduled" under "No date yet", where it is not true either.
      !(job.lifecycle === "SCHEDULED" && (upcoming || day === null));
    const badges = [
      ...(sayLifecycle ? [LIFECYCLE_META[job.lifecycle]] : []),
      ...(job.outcome ? [OUTCOME_META[job.outcome]] : []),
      ...(job.internalStatus &&
      !(options.tab === "revisit" && job.internalStatus === "REVISIT_REQUIRED")
        ? [INTERNAL_STATUS_META[job.internalStatus]]
        : []),
    ];

    const count = job.assignments.length;
    const lead = job.assignments.find((one) => one.isLead);
    // On somebody's own list their own name is the one thing they do not
    // need telling, and leading a job alone says nothing at all.
    const crew =
      count === 0
        ? null
        : lead?.userId === options.viewerId
          ? count > 1
            ? `You +${count - 1}`
            : null
          : lead
            ? `${lead.user.name}${count > 1 ? ` +${count - 1}` : ""}`
            : `${count} tech${count === 1 ? "" : "s"}`;

    const card: JobCard = {
      id: job.id,
      title: job.title,
      revisit: job.revisitNumber,
      time: at ? usTimeInZone(at, zone) : null,
      day: mixed && day ? (day === today ? "Today" : named) : null,
      place: placeLabel(siteLabelOnScreen(job.customer.code, job.site), job.site),
      badges,
      crew,
      unassigned: count === 0,
      reference: `${job.intWoId} · ${job.client.name}`,
    };

    const bucket = buckets.get(key) ?? {
      label,
      rank,
      day: day ?? "",
      mixed,
      newestFirst,
      entries: [],
    };
    bucket.entries.push({
      at: at?.getTime() ?? 0,
      day: day ?? "",
      dayLabel: spoken,
      card,
    });
    buckets.set(key, bucket);
  }

  // Days to come run forward from today; days gone, back from yesterday.
  // Within one day, always morning first.
  const byDay = (a: string, b: string, newestFirst: boolean) => {
    const forward = a < b ? -1 : a > b ? 1 : 0;
    return newestFirst ? -forward : forward;
  };

  return [...buckets.entries()]
    .map(([key, bucket]) => ({ key, ...bucket }))
    .sort((a, b) => a.rank - b.rank || byDay(a.day, b.day, a.newestFirst))
    .map((bucket) => {
      const entries = bucket.entries.sort(
        (a, b) => byDay(a.day, b.day, bucket.newestFirst) || a.at - b.at,
      );
      const days: JobDay[] = [];
      for (const entry of entries) {
        const runKey = bucket.mixed ? entry.day || "none" : bucket.key;
        const last = days.at(-1);
        if (last && last.key === runKey) last.jobs.push(entry.card);
        else {
          days.push({
            key: runKey,
            label: bucket.mixed ? entry.dayLabel : null,
            jobs: [entry.card],
          });
        }
      }
      return {
        key: bucket.key,
        label: bucket.label,
        count: entries.length,
        days,
      };
    });
}

/**
 * "Thu 11/12", like the days of the dashboard's week. From another year,
 * "6/25/2025": the year matters more than the weekday then, and both do not
 * fit above a time.
 */
export function dayName(date: Date, zone: string, now: Date): string {
  const { year, month, day } = zonedParts(date, zone);
  if (year !== zonedParts(now, zone).year) return `${month}/${day}/${year}`;
  const weekday = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    timeZone: zone,
  }).format(date);
  return `${weekday} ${month}/${day}`;
}

/** "11/1/2026" for a "YYYY-MM-DD" from the filters. */
export function shortDay(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return `${month}/${day}/${year}`;
}
