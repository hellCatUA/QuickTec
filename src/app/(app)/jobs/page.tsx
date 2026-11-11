import { Plus, X } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/page-header";
import { getCompanySettings } from "@/lib/company";
import { db } from "@/lib/db";
import {
  JOBS_LIST_LIMIT,
  JOBS_TABS,
  jobsHref,
  jobsWhere,
  listJobs,
  onDays,
  parseJobsQuery,
  shortDay,
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
  // Somebody who sees more than their own jobs — a supervisor and up. Their
  // own are set apart from the rest, and they may look for one tech's. For
  // anybody else a tech in the address is ignored: it could only narrow a
  // list that is theirs already.
  const wide = can(user, "job.view", { minScope: "REPORTS" });

  // What is still to do is read from the next job on; what is done, from the
  // last one back. The hundred fetched are the hundred that matter for each.
  const history = query.tab === "approved" || query.tab === "all";

  const [loaded, techs, companies, customers] = await Promise.all([
    db.job.findMany({
      where: { AND: [scope, jobsWhere(query, { wide, fallbackZone: zone })] },
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
    // What the pickers offer is what can be found: the people, companies and
    // customers on jobs this person can see, and nobody else's.
    wide
      ? db.user.findMany({
          where: { assignments: { some: { job: scope } } },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : null,
    db.client.findMany({
      where: { jobs: { some: scope } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.customer.findMany({
      where: { jobs: { some: scope } },
      select: { id: true, name: true, code: true },
      orderBy: { name: "asc" },
    }),
  ]);
  const jobs = loaded.filter((job) => onDays(job, query, zone));

  const sections = listJobs(jobs, {
    now: new Date(),
    fallbackZone: zone,
    viewerId: user.id,
    tab: query.tab,
    split: wide,
  });

  const nameOf = (list: { id: string; name: string }[] | null, id: string) =>
    list?.find((one) => one.id === id)?.name;
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
    wide && query.tech
      ? {
          key: "tech",
          label: nameOf(techs, query.tech) ?? "Unknown tech",
          href: jobsHref(query, { tech: null }),
        }
      : null,
    query.company
      ? {
          key: "company",
          label: nameOf(companies, query.company) ?? "Unknown company",
          href: jobsHref(query, { company: null }),
        }
      : null,
    query.customer
      ? {
          key: "customer",
          label: nameOf(customers, query.customer) ?? "Unknown customer",
          href: jobsHref(query, { customer: null }),
        }
      : null,
  ].filter((chip) => chip !== null);
  const narrowed = chips.length > 0 || query.q !== "";
  const cleared = jobsHref(query, {
    q: "",
    from: null,
    to: null,
    tech: null,
    company: null,
    customer: null,
  });

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
        techs={techs?.map((one) => ({ value: one.id, label: one.name })) ?? null}
        companies={companies.map((one) => ({ value: one.id, label: one.name }))}
        customers={customers.map((one) => ({
          value: one.id,
          label: one.name,
          hint: one.code,
          keywords: one.code,
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
              href={cleared}
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
              query.tab === "all"
                ? "No job matches. Try fewer words, or clear the filters."
                : `No ${query.tab} jobs match. Try the All tab, or clear the search and filters.`
            }
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
        <JobList sections={sections} />
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
