import {
  Banknote,
  CalendarDays,
  ChevronRight,
  Clock,
  Handshake,
  MapPin,
  Store,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { JobCard, JobGroup } from "@/lib/job-list";
import { cn } from "@/lib/utils";
import { CrewMenu } from "./crew-menu";

/**
 * The jobs, a day at a time.
 *
 * The date used to open every card's second line, and a card carried two
 * reference numbers and the paying company as well — four lines and up to four
 * badges for each job, so a phone showed five or six of them and the eye had
 * to read every one to find today. Now the day is a heading said once, the
 * card is the time, what it is, where, and who, and the numbers are what the
 * search finds rather than what every card spells out.
 */
export function JobList({ groups }: { groups: JobGroup[] }) {
  return (
    <div className="flex flex-col gap-6">
      {groups.map((group) => (
        <section key={group.key} className="flex flex-col gap-2">
          <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {group.label}
            <Count value={group.count} />
          </h2>
          {group.days.map((day) => (
            <div key={day.key} className="flex flex-col gap-2">
              {/* A group holding several days says where one ends: the day on
                  each card was there, but two cards from different days looked
                  like two cards from the same one. */}
              {day.label ? (
                <h3 className="flex items-center gap-2 pt-1 text-xs font-medium text-muted-foreground">
                  <span className="tabular shrink-0">{day.label}</span>
                  <span className="h-px flex-1 bg-border" aria-hidden />
                </h3>
              ) : null}
              {day.jobs.map((job) => (
                <Card key={job.id} job={job} />
              ))}
            </div>
          ))}
        </section>
      ))}
    </div>
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
  return (
    // The whole card opens the job, through the title's link stretched over
    // it; the crew button sits above that link so it can open on its own.
    <article className="relative flex flex-col gap-2 rounded-xl border border-border bg-surface p-3 transition-colors hover:border-primary/50">
      <div className="flex items-center gap-3 text-sm font-medium">
        <span className="tabular inline-flex items-center gap-1.5">
          <CalendarDays className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          {job.date ?? <span className="text-muted-foreground">No date yet</span>}
        </span>
        {job.time ? (
          <span className="tabular inline-flex items-center gap-1.5">
            <Clock className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            {job.time}
          </span>
        ) : null}
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {job.revisit ? <Badge variant="warning">R{job.revisit}</Badge> : null}
          <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
        </span>
      </div>

      <Link
        href={`/jobs/${job.id}`}
        className="line-clamp-2 text-[0.9375rem] font-semibold leading-snug after:absolute after:inset-0 after:rounded-xl after:content-['']"
      >
        {job.title}
      </Link>

      {/* Two to a row on a phone, all four in one from a tablet up. Each
          says what it is with its icon, and in words to a screen reader. */}
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground sm:grid-cols-4">
        <Fact icon={Store} label="Client" value={job.client} />
        <Fact icon={MapPin} label="City" value={job.town} />
        <Fact icon={Banknote} label="Paying company" value={job.paying} />
        <Fact icon={Handshake} label="Rep company" value={job.rep} />
      </dl>

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2">
        {job.crew.length > 0 ? (
          <CrewMenu crew={job.crew} jobTitle={job.title} />
        ) : (
          <span className="inline-flex min-h-10 items-center gap-1.5 text-sm font-medium text-warning">
            <UsersRound className="size-4" aria-hidden />
            Nobody assigned
          </span>
        )}
        {job.badges.length > 0 ? (
          <span className="ml-auto flex flex-wrap justify-end gap-1.5">
            {job.badges.map((badge) => (
              <Badge key={badge.label} variant={badge.variant}>
                {badge.label}
              </Badge>
            ))}
          </span>
        ) : null}
      </div>
    </article>
  );
}

function Fact({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string | null;
}) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <dt className="sr-only">{label}</dt>
      <Icon className="size-3.5 shrink-0" aria-hidden />
      <dd className={cn("truncate", value ? "text-foreground/85" : "text-muted-foreground/70")}>
        {value ?? "—"}
      </dd>
    </div>
  );
}
