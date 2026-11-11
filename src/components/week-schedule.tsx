"use client";

import { ChevronRight, MapPin } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { LIFECYCLE_META } from "@/lib/job-status";
import { cn } from "@/lib/utils";
import type { JobLifecycle } from "@prisma-client";

export type ScheduledJob = {
  id: string;
  intWoId: string;
  title: string;
  siteLabel: string;
  city: string;
  state: string;
  /** "08:30", in the site's zone. Null when the job has no time on it yet. */
  time: string | null;
  lifecycle: JobLifecycle;
  crew: string[];
  /** How many hours it is planned to take, for the eye rather than for maths. */
  estimateHours: number | null;
};

export type ScheduleDay = {
  /** "2026-08-03" in the company's zone — the key, not for display. */
  date: string;
  weekday: string;
  dayLabel: string;
  isToday: boolean;
  isPast: boolean;
  jobs: ScheduledJob[];
};

/**
 * The week ahead.
 *
 * Two shapes of the same data. A phone gets a vertical run of days, because a
 * seven-column grid on a 390px screen is seven unreadable slivers and the
 * question there is "what am I doing next". A desktop gets the seven columns
 * side by side, because the question there is "is Thursday full".
 *
 * Days with nothing on them are kept rather than skipped: a gap in the week is
 * information, and a list that silently omits Wednesday reads as a week with
 * no Wednesday in it.
 */
export function WeekSchedule({
  days,
  selfName,
}: {
  days: ScheduleDay[];
  /**
   * Whose week this is, when it is one person's. Their own name on every row
   * of their own schedule says nothing; who else is coming does.
   */
  selfName?: string;
}) {
  const total = days.reduce((count, day) => count + day.jobs.length, 0);

  if (total === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nothing scheduled this week.
      </p>
    );
  }

  return (
    <>
      {/* Phone: one day after another, empty ones collapsed to a line. */}
      <div className="flex flex-col gap-3 md:hidden">
        {days.map((day) => (
          <div key={day.date} className="flex flex-col gap-1.5">
            <div
              className={cn(
                "flex items-baseline gap-2 text-xs font-medium uppercase tracking-wide",
                day.isToday ? "text-primary" : "text-muted-foreground",
                day.isPast && "opacity-60",
              )}
            >
              <span>{day.weekday}</span>
              <span className="tabular normal-case">{day.dayLabel}</span>
              {day.isToday ? <Badge variant="primary">Today</Badge> : null}
            </div>

            {day.jobs.length === 0 ? (
              <p className="pl-1 text-xs text-muted-foreground">—</p>
            ) : (
              day.jobs.map((job) => (
                <JobRow key={job.id} job={job} selfName={selfName} />
              ))
            )}
          </div>
        ))}
      </div>

      {/* Desktop: the whole week at once, so a full Thursday is visible. */}
      <div className="hidden gap-2 md:grid md:grid-cols-7">
        {days.map((day) => (
          <div
            key={day.date}
            className={cn(
              "flex min-h-32 flex-col gap-1.5 rounded-lg border p-2",
              day.isToday
                ? "border-primary/50 bg-primary/5"
                : "border-border bg-surface",
              day.isPast && "opacity-60",
            )}
          >
            <div className="flex items-baseline justify-between gap-1">
              <span
                className={cn(
                  "text-xs font-medium uppercase tracking-wide",
                  day.isToday ? "text-primary" : "text-muted-foreground",
                )}
              >
                {day.weekday}
              </span>
              <span className="tabular text-xs text-muted-foreground">
                {day.dayLabel}
              </span>
            </div>

            {day.jobs.length === 0 ? (
              <span className="text-xs text-muted-foreground">—</span>
            ) : (
              day.jobs.map((job) => (
                <JobChip key={job.id} job={job} selfName={selfName} />
              ))
            )}
          </div>
        ))}
      </div>
    </>
  );
}

/**
 * Who is on a job, as one line.
 *
 * On somebody's own week their name is dropped and the rest read "with …";
 * a job that is theirs alone needs no line at all. Null when there is nothing
 * worth saying, and never for an empty crew — that is said separately, in the
 * warning colour, because it is the one thing here somebody has to act on.
 */
function crewLine(crew: string[], selfName?: string): string | null {
  if (crew.length === 0) return null;
  if (!selfName || !crew.includes(selfName)) return crew.join(", ");
  const others = crew.filter((name) => name !== selfName);
  return others.length > 0 ? `with ${others.join(", ")}` : null;
}

/**
 * One job on a phone.
 *
 * The time and the status share the top line and everything else has the
 * full width under them. The row used to be four things side by side — time,
 * text, badge, chevron — which at 390px left the title about a hundred
 * pixels: "POS register r…", "SBUX #10542 ·…", and a time broken over two
 * lines, on the one screen people open to find out where they are going.
 */
function JobRow({ job, selfName }: { job: ScheduledJob; selfName?: string }) {
  const crew = crewLine(job.crew, selfName);

  return (
    <Link
      href={`/jobs/${job.id}`}
      className="flex items-center gap-2 rounded-lg border border-border bg-surface p-2.5 hover:bg-muted"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center justify-between gap-2">
          <span className="tabular whitespace-nowrap text-sm font-semibold">
            {job.time ?? "No time set"}
          </span>
          <Badge variant={LIFECYCLE_META[job.lifecycle].variant}>
            {LIFECYCLE_META[job.lifecycle].label}
          </Badge>
        </span>

        <span className="line-clamp-2 text-sm font-medium">{job.title}</span>

        <span className="truncate text-xs text-muted-foreground">
          <MapPin className="mr-1 inline size-3" />
          {job.siteLabel}
          {job.city ? ` · ${job.city}` : ""}
          {job.state ? `, ${job.state}` : ""}
        </span>

        {job.crew.length === 0 ? (
          <span className="text-xs text-warning">Nobody assigned</span>
        ) : crew ? (
          <span className="truncate text-xs text-muted-foreground">{crew}</span>
        ) : null}
      </span>

      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}

function JobChip({ job, selfName }: { job: ScheduledJob; selfName?: string }) {
  // First names: the column is a hundred and fifty pixels and the question
  // is who, not how they spell it. Shortened after deciding who is "with"
  // whom, not before: compared by first name, Mike Brown's week took Mike Lee
  // for himself and showed the job as his alone.
  const others =
    selfName && job.crew.includes(selfName)
      ? job.crew.filter((name) => name !== selfName)
      : null;
  const firstNames = (names: string[]) =>
    names.map((name) => name.split(" ")[0]).join(", ");
  const crew =
    others === null
      ? job.crew.length > 0
        ? firstNames(job.crew)
        : null
      : others.length > 0
        ? `with ${firstNames(others)}`
        : null;

  return (
    <Link
      href={`/jobs/${job.id}`}
      title={`${job.time ? `${job.time} · ` : ""}${job.title} · ${job.siteLabel}`}
      className={cn(
        "flex flex-col gap-0.5 rounded border-l-2 bg-muted/60 p-1.5 text-xs hover:bg-muted",
        job.lifecycle === "IN_PROGRESS"
          ? "border-success"
          : job.lifecycle === "PENDING_APPROVAL"
            ? "border-warning"
            : "border-primary",
      )}
    >
      {job.time ? (
        <span className="tabular font-medium">{job.time}</span>
      ) : null}
      <span className="line-clamp-2 leading-tight">{job.title}</span>
      <span className="truncate text-[10px] text-muted-foreground">
        {job.siteLabel}
      </span>
      {job.crew.length === 0 ? (
        <span className="truncate text-[10px] text-warning">
          Nobody assigned
        </span>
      ) : crew ? (
        <span className="truncate text-[10px] text-muted-foreground">
          {crew}
        </span>
      ) : null}
    </Link>
  );
}
