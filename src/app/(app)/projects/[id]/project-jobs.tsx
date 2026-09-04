"use client";

import { ChevronRight, Search } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { LIFECYCLE_META, OUTCOME_META } from "@/lib/job-status";
import { cn } from "@/lib/utils";
import type { JobLifecycle, JobOutcome } from "@prisma-client";

export type ProjectJob = {
  id: string;
  intWoId: string;
  title: string;
  externalAssignmentId: string | null;
  siteLabel: string;
  city: string;
  state: string;
  scheduledLabel: string | null;
  lifecycle: JobLifecycle;
  outcome: JobOutcome | null;
  crew: string[];
};

/**
 * Which jobs are still coming and which are behind us.
 *
 * A project's list is read to answer one of two questions — what is left, or
 * what happened — and mixing them means scrolling past forty finished jobs to
 * find tomorrow's. The split is the lifecycle, so it is the real state of the
 * work rather than a label somebody has to keep up to date.
 */
const GROUPS = [
  {
    key: "scheduled",
    label: "Scheduled",
    lifecycles: [
      "DRAFT",
      "PENDING_APPROVAL",
      "SCHEDULED",
      "IN_PROGRESS",
      // Work still to do, even though the day is over: the crew have been
      // asked for something before the report can go anywhere.
      "CHANGES_REQUESTED",
    ],
    tone: "border-primary/40",
  },
  {
    key: "completed",
    label: "Completed",
    lifecycles: ["PENDING_REVIEW", "APPROVED", "REJECTED", "BILLED", "CLOSED"],
    tone: "border-border",
  },
] as const;

type GroupKey = (typeof GROUPS)[number]["key"] | "all";

export function ProjectJobs({ jobs }: { jobs: ProjectJob[] }) {
  const [query, setQuery] = React.useState("");
  const [group, setGroup] = React.useState<GroupKey>("all");

  const matched = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return jobs;
    return jobs.filter((job) =>
      [
        job.intWoId,
        job.title,
        job.externalAssignmentId ?? "",
        job.siteLabel,
        job.city,
        job.state,
        ...job.crew,
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [jobs, query]);

  const sections = GROUPS.map((section) => ({
    ...section,
    jobs: matched.filter((job) =>
      (section.lifecycles as readonly string[]).includes(job.lifecycle),
    ),
  })).filter((section) => group === "all" || group === section.key);

  const shown = sections.reduce((total, section) => total + section.jobs.length, 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by WO, title, site, city or who is on it…"
          className="pl-9"
          aria-label="Search jobs in this project"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {(["all", ...GROUPS.map((section) => section.key)] as GroupKey[]).map(
          (key) => {
            const count =
              key === "all"
                ? matched.length
                : matched.filter((job) =>
                    (
                      GROUPS.find((section) => section.key === key)!
                        .lifecycles as readonly string[]
                    ).includes(job.lifecycle),
                  ).length;

            return (
              <Button
                key={key}
                type="button"
                size="sm"
                variant={group === key ? "primary" : "secondary"}
                onClick={() => setGroup(key)}
              >
                {key === "all"
                  ? "All"
                  : GROUPS.find((section) => section.key === key)!.label}
                <span className="tabular ml-1 text-xs opacity-70">{count}</span>
              </Button>
            );
          },
        )}
      </div>

      {shown === 0 ? (
        <p className="text-sm text-muted-foreground">
          {query ? "Nothing matches that." : "No jobs in this project yet."}
        </p>
      ) : null}

      {sections.map((section) =>
        section.jobs.length === 0 ? null : (
          <div key={section.key} className="flex flex-col gap-2">
            <div className="flex items-center gap-2 pt-1">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {section.label}
              </span>
              <span className="tabular text-xs text-muted-foreground">
                {section.jobs.length}
              </span>
            </div>

            {section.jobs.map((job) => (
              <Link
                key={job.id}
                href={`/jobs/${job.id}`}
                className={cn(
                  "flex items-center gap-3 rounded-lg border-l-4 border border-border bg-surface p-3 hover:bg-muted",
                  section.tone,
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="truncate text-sm font-medium">
                      {job.title}
                    </span>
                    <span className="tabular text-xs text-muted-foreground">
                      {job.intWoId}
                    </span>
                  </div>

                  <div className="mt-0.5 truncate text-xs text-muted-foreground">
                    {job.siteLabel}
                    {job.city ? ` · ${job.city}` : ""}
                    {job.state ? `, ${job.state}` : ""}
                    {job.scheduledLabel ? ` · ${job.scheduledLabel}` : ""}
                  </div>

                  {job.crew.length > 0 ? (
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">
                      {job.crew.join(", ")}
                    </div>
                  ) : null}

                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <Badge variant={LIFECYCLE_META[job.lifecycle].variant}>
                      {LIFECYCLE_META[job.lifecycle].label}
                    </Badge>
                    {job.outcome ? (
                      <Badge variant={OUTCOME_META[job.outcome].variant}>
                        {OUTCOME_META[job.outcome].label}
                      </Badge>
                    ) : null}
                  </div>
                </div>

                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </Link>
            ))}
          </div>
        ),
      )}
    </div>
  );
}
