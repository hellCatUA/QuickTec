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
export function WeekSchedule({ days }: { days: ScheduleDay[] }) {
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
              day.jobs.map((job) => <JobRow key={job.id} job={job} />)
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
              day.jobs.map((job) => <JobChip key={job.id} job={job} />)
            )}
          </div>
        ))}
      </div>
    </>
  );
}

function JobRow({ job }: { job: ScheduledJob }) {
  return (
    <Link
      href={`/jobs/${job.id}`}
      className="flex items-center gap-3 rounded-lg border border-border bg-surface p-2.5 hover:bg-muted"
    >
      <span className="tabular w-14 shrink-0 text-sm font-medium">
        {job.time ?? "—"}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{job.title}</span>
        <span className="block truncate text-xs text-muted-foreground">
          <MapPin className="mr-1 inline size-3" />
          {job.siteLabel}
          {job.city ? ` · ${job.city}` : ""}
          {job.state ? `, ${job.state}` : ""}
        </span>
        {job.crew.length > 0 ? (
          <span className="block truncate text-xs text-muted-foreground">
            {job.crew.join(", ")}
          </span>
        ) : null}
      </span>

      <Badge variant={LIFECYCLE_META[job.lifecycle].variant}>
        {LIFECYCLE_META[job.lifecycle].label}
      </Badge>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}

function JobChip({ job }: { job: ScheduledJob }) {
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
    </Link>
  );
}
