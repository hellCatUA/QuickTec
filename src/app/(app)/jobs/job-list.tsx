import { ChevronRight, UserRound, UsersRound } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { JobCard, JobGroup, JobSection } from "@/lib/job-list";
import { cn } from "@/lib/utils";

/**
 * The jobs, a day at a time.
 *
 * The date used to open every card's second line, and a card carried two
 * reference numbers and the paying company as well — four lines and up to four
 * badges for each job, so a phone showed five or six of them and the eye had
 * to read every one to find today. Now the day is a heading said once, the
 * card is the time, what it is, where, and who, and the numbers are what the
 * search finds rather than what every card spells out.
 *
 * Headings nest: "Your jobs" and "Other jobs" when the list is split, the day
 * groups under them, and the days inside a group that spans several.
 */
export function JobList({ sections }: { sections: JobSection[] }) {
  const split = sections.some((section) => section.label);

  return (
    <div className="flex flex-col gap-6">
      {sections.map((section, index) => (
        <section
          key={section.key}
          aria-label={section.label ?? undefined}
          className={cn(
            "flex flex-col gap-4",
            // The divider between one's own and everybody else's: the
            // strongest line on the page, so it is not taken for a day.
            index > 0 && split && "border-t-2 border-border pt-5",
          )}
        >
          {section.label ? (
            <h2 className="flex items-center gap-2 text-base font-semibold">
              {section.key === "mine" ? (
                <UserRound className="size-5 text-primary" aria-hidden />
              ) : (
                <UsersRound className="size-5 text-muted-foreground" aria-hidden />
              )}
              {section.label}
              <Count value={section.count} />
            </h2>
          ) : null}
          {section.groups.map((group) => (
            <Group key={group.key} group={group} nested={split} />
          ))}
        </section>
      ))}
    </div>
  );
}

function Group({ group, nested }: { group: JobGroup; nested: boolean }) {
  const Heading = nested ? "h3" : "h2";
  const DayHeading = nested ? "h4" : "h3";

  return (
    <section className="flex flex-col gap-2">
      <Heading className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {group.label}
        <Count value={group.count} />
      </Heading>
      {group.days.map((day) => (
        <div key={day.key} className="flex flex-col gap-2">
          {/* A group holding several days says where one ends: the day on
              each card was there, but two cards from different days looked
              like two cards from the same one. */}
          {day.label ? (
            <DayHeading className="flex items-center gap-2 pt-1 text-xs font-medium text-muted-foreground">
              <span className="tabular shrink-0">{day.label}</span>
              <span className="h-px flex-1 bg-border" aria-hidden />
            </DayHeading>
          ) : null}
          {day.jobs.map((job) => (
            <Card key={job.id} job={job} />
          ))}
        </div>
      ))}
    </section>
  );
}

function Count({ value }: { value: number }) {
  return (
    <span className="tabular rounded-full bg-muted px-1.5 py-px text-[0.6875rem] font-medium normal-case tracking-normal text-muted-foreground">
      {value}
    </span>
  );
}

function Card({ job }: { job: JobCard }) {
  const meta = job.badges.length > 0 || job.unassigned || job.crew;

  return (
    <Link
      href={`/jobs/${job.id}`}
      className="flex items-start gap-3 rounded-xl border border-border bg-surface p-3 transition-colors hover:border-primary/50"
    >
      {/* The time has a column of its own: it is what the list is scanned
          by, and it never shares a line with anything that could push it
          off the end. */}
      <div className="tabular flex w-[4.25rem] shrink-0 flex-col pt-px text-sm font-semibold leading-tight">
        {job.day ? (
          <span className="text-xs font-medium text-muted-foreground">
            {job.day}
          </span>
        ) : null}
        <span className={job.time ? undefined : "text-muted-foreground"}>
          {job.time ?? "—"}
        </span>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-start gap-1.5">
          <span className="line-clamp-2 text-sm font-semibold leading-snug">
            {job.title}
          </span>
          {job.revisit ? (
            <Badge variant="warning" className="shrink-0">
              R{job.revisit}
            </Badge>
          ) : null}
        </div>
        <span className="truncate text-xs text-muted-foreground">
          {job.place}
        </span>

        {/* How it stands and who is on it, under the title rather than
            beside it: three badges beside a title on a phone used to fold
            the title into a column three words wide. */}
        <div
          className={cn(
            "mt-1 flex-wrap items-center gap-x-2 gap-y-1 text-xs",
            meta ? "flex" : "hidden sm:flex",
          )}
        >
          {job.badges.map((badge) => (
            <Badge key={badge.label} variant={badge.variant}>
              {badge.label}
            </Badge>
          ))}
          {job.unassigned ? (
            <span className="inline-flex items-center gap-1 text-warning">
              <UsersRound className="size-3.5" aria-hidden />
              Nobody assigned
            </span>
          ) : job.crew ? (
            <span className="inline-flex min-w-0 items-center gap-1 text-muted-foreground">
              <UsersRound className="size-3.5 shrink-0" aria-hidden />
              <span className="sr-only">Lead:</span>
              <span className="truncate">{job.crew}</span>
            </span>
          ) : null}
          {/* Ours and who pays, for whoever quotes them — from a tablet up,
              where they fit without taking a line. On a phone the search
              finds them. */}
          <span className="tabular hidden min-w-0 truncate text-muted-foreground sm:inline">
            {job.reference}
          </span>
        </div>
      </div>

      <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}
