import { Plus, X } from "lucide-react";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/page-header";
import { getCompanySettings } from "@/lib/company";
import { db } from "@/lib/db";
import {
  groupByDay,
  JOBS_LIST_LIMIT,
  JOBS_TABS,
  jobsHref,
  jobsWhere,
  NO_FILTERS,
  onDays,
  parseJobsQuery,
  shortDay,
  WHO_COOKIE,
  type JobsWho,
} from "@/lib/job-list";
import { jobScopeWhere } from "@/lib/scope";
import { can, getSessionUser } from "@/lib/session";
import { cn } from "@/lib/utils";
import { JobFilters } from "./job-filters";
import { JobList } from "./job-list";

export const metadata = { title: "Jobs" };

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/signin");

  const scope = await jobScopeWhere(user, "job.view");
  if (!scope) redirect("/dashboard");

  const query = parseJobsQuery(await searchParams);
  const company = await getCompanySettings();
  const zone = company.defaultTimeZone;
  // Somebody who sees more than their own jobs — a supervisor and up. They
  // choose between the jobs they are on and all they can see, and may look
  // for one tech's. For anybody else the list is their own already: a tech in
  // the address is ignored, and there is nothing to choose between.
  const wide = can(user, "job.view", { minScope: "REPORTS" });
  const remembered = (await cookies()).get(WHO_COOKIE)?.value;
  const who: JobsWho | null = wide
    ? (query.who ?? (remembered === "mine" ? "mine" : "all"))
    : null;

  // What is still to do is read from the next job on; what is done, from the
  // last one back. The hundred fetched are the hundred that matter for each.
  const history = query.tab === "approved" || query.tab === "all";

  const [loaded, companies, reps, projects, techs, customers] = await Promise.all([
    db.job.findMany({
      where: {
        AND: [
          scope,
          jobsWhere(query, {
            wide,
            fallbackZone: zone,
            mineOf: who === "mine" ? user.id : null,
          }),
        ],
      },
      orderBy: history
        ? [{ scheduledStart: "desc" }, { createdAt: "desc" }]
        : [{ scheduledStart: "asc" }, { createdAt: "desc" }],
      take: JOBS_LIST_LIMIT,
      select: {
        id: true,
        intWoId: true,
        title: true,
        scheduledStart: true,
        lifecycle: true,
        outcome: true,
        internalStatus: true,
        revisitNumber: true,
        client: { select: { name: true } },
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
        assignments: {
          select: {
            isLead: true,
            userId: true,
            user: { select: { name: true } },
          },
        },
      },
    }),
    // What the pickers offer is what can be found: the companies, projects,
    // people and customers on jobs this person can see, and nobody else's.
    db.client.findMany({
      where: { jobs: { some: scope } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.repCompany.findMany({
      where: { jobs: { some: scope } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.project.findMany({
      where: { jobs: { some: scope } },
      select: { id: true, name: true, code: true },
      orderBy: { name: "asc" },
    }),
    wide
      ? db.user.findMany({
          where: { assignments: { some: { job: scope } } },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : null,
    db.customer.findMany({
      where: { jobs: { some: scope } },
      select: { id: true, name: true, code: true },
      orderBy: { name: "asc" },
    }),
  ]);
  const jobs = loaded.filter((job) => onDays(job, query, zone));

  const groups = groupByDay(jobs, {
    now: new Date(),
    fallbackZone: zone,
    viewerId: user.id,
    tab: query.tab,
  });

  // Each filter in use, as a chip that takes itself off. The companies say
  // which they are: with two of them a bare "NetCom Sub" could be either.
  const nameOf = (list: { id: string; name: string }[] | null, id: string) =>
    list?.find((one) => one.id === id)?.name ?? "Unknown";
  const chips = [
    query.from || query.to
      ? {
          key: "days",
          label:
            query.from && query.to
              ? query.from === query.to
                ? shortDay(query.from)
                : `${shortDay(query.from)} – ${shortDay(query.to)}`
              : query.from
                ? `From ${shortDay(query.from)}`
                : `To ${shortDay(query.to!)}`,
          href: jobsHref(query, { from: null, to: null }),
        }
      : null,
    query.company
      ? {
          key: "company",
          label: `Paying: ${nameOf(companies, query.company)}`,
          href: jobsHref(query, { company: null }),
        }
      : null,
    query.rep
      ? {
          key: "rep",
          label: `Rep: ${nameOf(reps, query.rep)}`,
          href: jobsHref(query, { rep: null }),
        }
      : null,
    query.project
      ? {
          key: "project",
          label: `Project: ${nameOf(projects, query.project)}`,
          href: jobsHref(query, { project: null }),
        }
      : null,
    wide && query.tech
      ? {
          key: "tech",
          label: nameOf(techs, query.tech),
          href: jobsHref(query, { tech: null }),
        }
      : null,
    query.customer
      ? {
          key: "customer",
          label: `Customer: ${nameOf(customers, query.customer)}`,
          href: jobsHref(query, { customer: null }),
        }
      : null,
    query.site
      ? {
          key: "site",
          label: `Site ID: ${query.site}`,
          href: jobsHref(query, { site: "" }),
        }
      : null,
  ].filter((chip) => chip !== null);
  const narrowed = chips.length > 0 || query.q !== "";

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <PageHeader
        title="Jobs"
        actions={
          can(user, "job.create") ? (
            <Link href="/jobs/new">
              <Button size="sm">
                <Plus /> New job
              </Button>
            </Link>
          ) : null
        }
      />

      <nav
        aria-label="Which jobs"
        className="flex gap-1 rounded-lg border border-border bg-surface p-1"
      >
        {JOBS_TABS.map((option) => (
          <Link
            key={option.key}
            // A search or filter carries over: "Terry's jobs at Starbucks"
            // is as much a question about the done ones as the open ones.
            href={jobsHref(query, { tab: option.key })}
            aria-current={query.tab === option.key ? "page" : undefined}
            className={cn(
              "flex-1 rounded-md px-3 py-1.5 text-center text-sm font-medium transition-colors",
              query.tab === option.key
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted",
            )}
          >
            {option.label}
          </Link>
        ))}
      </nav>

      <JobFilters
        query={query}
        who={who}
        companies={companies.map((one) => ({ value: one.id, label: one.name }))}
        reps={reps.map((one) => ({ value: one.id, label: one.name }))}
        projects={projects.map((one) => ({
          value: one.id,
          label: one.name,
          hint: one.code,
          keywords: one.code,
        }))}
        techs={techs?.map((one) => ({ value: one.id, label: one.name })) ?? null}
        customers={customers.map((one) => ({
          value: one.id,
          label: `${one.name} (${one.code})`,
        }))}
      />

      {chips.length > 0 ? (
        <nav aria-label="Filters in use" className="flex flex-wrap items-center gap-2">
          {chips.map((chip) => (
            <Link
              key={chip.key}
              href={chip.href}
              className="inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 pl-3.5 pr-2.5 text-sm text-foreground transition-colors hover:bg-primary/15"
            >
              <span className="truncate">{chip.label}</span>
              <X className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="sr-only">(remove)</span>
            </Link>
          ))}
          {chips.length > 1 || query.q ? (
            <Link
              href={jobsHref(query, NO_FILTERS)}
              className="inline-flex min-h-11 items-center px-2 text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              Clear all
            </Link>
          ) : null}
        </nav>
      ) : null}

      {/* Said aloud when a search lands; on screen only when the list has
          been narrowed, where the count is news. */}
      <p
        aria-live="polite"
        className={narrowed && jobs.length > 0 ? "text-sm text-muted-foreground" : "sr-only"}
      >
        {narrowed
          ? `${jobs.length}${loaded.length === JOBS_LIST_LIMIT ? "+" : ""} ${
              jobs.length === 1 ? "job" : "jobs"
            } found`
          : ""}
      </p>

      {jobs.length === 0 ? (
        narrowed ? (
          <EmptyState
            title="Nothing matches"
            description={
              // "My jobs" is a filter too, and the likelier reason a manager
              // finds nothing: it is named first when it is on.
              who === "mine"
                ? "None of your jobs match. Try All jobs, or clear the search and filters."
                : query.tab === "all"
                  ? "No job matches. Try fewer words, or clear the filters."
                  : `No ${query.tab} jobs match. Try the All tab, or clear the search and filters.`
            }
          />
        ) : who === "mine" ? (
          <EmptyState
            title="None of yours"
            description={`You are not on any ${query.tab === "all" ? "" : `${query.tab} `}jobs. All jobs shows everyone's.`}
          />
        ) : (
          <EmptyState
            title="Nothing here"
            description={
              query.tab === "open"
                ? "No open jobs you can see. Try the All tab."
                : query.tab === "revisit"
                  ? "Nothing is waiting on a return trip. A tech raises this at checkout, and scheduling the revisit clears it."
                  : "No jobs match this filter yet."
            }
          />
        )
      ) : (
        <JobList groups={groups} />
      )}

      {loaded.length === JOBS_LIST_LIMIT ? (
        <p className="text-center text-xs text-muted-foreground">
          {history ? "The 100 most recent are shown." : "The first 100 are shown."}{" "}
          The search and the filters find the rest.
        </p>
      ) : null}
    </div>
  );
}
