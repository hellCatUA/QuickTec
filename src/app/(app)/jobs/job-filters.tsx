"use client";

import {
  ChevronDown,
  Loader2,
  Search,
  SlidersHorizontal,
  UserRound,
  UsersRound,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboOption } from "@/components/ui/combobox";
import { Field, Input, Select } from "@/components/ui/field";
import {
  jobsHref,
  WHO_COOKIE,
  type JobsQuery,
  type JobsWho,
} from "@/lib/job-list";
import { cn } from "@/lib/utils";

type Option = { value: string; label: string };

type Values = {
  q: string;
  from: string;
  to: string;
  company: string;
  rep: string;
  project: string;
  tech: string;
  customer: string;
  site: string;
};

const valuesOf = (query: JobsQuery): Values => ({
  q: query.q,
  from: query.from ?? "",
  to: query.to ?? "",
  company: query.company ?? "",
  rep: query.rep ?? "",
  project: query.project ?? "",
  tech: query.tech ?? "",
  customer: query.customer ?? "",
  site: query.site,
});

const NONE: Partial<Values> = {
  from: "",
  to: "",
  company: "",
  rep: "",
  project: "",
  tech: "",
  customer: "",
  site: "",
};

/**
 * "My jobs" or "All jobs", the search box, and under "Filters" everything else
 * a job can be found by.
 *
 * All of it is asked of the server, through the address: the box used to sift
 * only the hundred jobs already on the page, so a work order from last spring
 * was "nothing matches" when it was simply not loaded. The address also makes
 * a narrowed list something to bookmark or send, and the tabs keep it.
 *
 * The panel opens in the page rather than over it: on a phone a popover with
 * eight fields and the keyboard up has nowhere to go. Its order is the
 * owner's: when, who pays and who hands it down, the project, the tech, then
 * whose site.
 */
export function JobFilters({
  query,
  who,
  companies,
  reps,
  projects,
  techs,
  customers,
}: {
  query: JobsQuery;
  /** Which of "My jobs" and "All jobs" is showing; null where there is no choice. */
  who: JobsWho | null;
  companies: Option[];
  reps: Option[];
  projects: ComboOption[];
  /** Only for somebody who sees more than their own jobs. */
  techs: ComboOption[] | null;
  customers: Option[];
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [open, setOpen] = React.useState(false);

  // What the fields hold follows the address whenever the address changes —
  // a chip removed, a tab changed — and is the person's own in between.
  const key = JSON.stringify(query);
  const [seen, setSeen] = React.useState(key);
  const [values, setValues] = React.useState(() => valuesOf(query));
  if (seen !== key) {
    setSeen(key);
    setValues(valuesOf(query));
  }

  const set = (field: keyof Values) => (value: string) =>
    setValues((current) => ({ ...current, [field]: value }));

  const inUse = [
    query.from || query.to,
    query.company,
    query.rep,
    query.project,
    techs && query.tech,
    query.customer,
    query.site,
  ].filter(Boolean).length;

  function go(next: Values) {
    const href = jobsHref(query, {
      q: next.q.trim().replace(/\s+/g, " "),
      from: next.from || null,
      to: next.to || null,
      company: next.company || null,
      rep: next.rep || null,
      project: next.project || null,
      tech: (techs && next.tech) || null,
      customer: next.customer || null,
      site: next.site.trim(),
    });
    setOpen(false);
    startTransition(() => router.push(href));
  }

  return (
    <div className="flex flex-col gap-3">
      {who ? (
        <nav
          aria-label="Whose jobs"
          className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-surface p-1"
        >
          {(["mine", "all"] as const).map((option) => (
            <Link
              key={option}
              href={jobsHref(query, { who: option })}
              aria-current={who === option ? "page" : undefined}
              // Kept for next time: a supervisor who works their own jobs
              // should not have to ask for them every morning.
              onClick={() => {
                document.cookie = `${WHO_COOKIE}=${option}; path=/; max-age=31536000; samesite=lax`;
              }}
              className={cn(
                "flex min-h-9 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium transition-colors",
                who === option
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted",
              )}
            >
              {option === "mine" ? (
                <UserRound className="size-4" aria-hidden />
              ) : (
                <UsersRound className="size-4" aria-hidden />
              )}
              {option === "mine" ? "My jobs" : "All jobs"}
            </Link>
          ))}
        </nav>
      ) : null}

      <form
        role="search"
        action="/jobs"
        method="get"
        onSubmit={(event) => {
          event.preventDefault();
          go(values);
        }}
        className="flex flex-col gap-3"
      >
        <input type="hidden" name="filter" value={query.tab} />
        {query.who ? <input type="hidden" name="who" value={query.who} /> : null}
        <div className="flex gap-2">
          <label className="relative block min-w-0 flex-1">
            <span className="sr-only">Find a job</span>
            {pending ? (
              <Loader2 className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
            ) : (
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            )}
            <input
              type="search"
              name="q"
              value={values.q}
              onChange={(event) => set("q")(event.target.value)}
              placeholder="WO, site, city, crew"
              enterKeyHint="search"
              autoComplete="off"
              className="min-h-11 w-full rounded-lg border border-border bg-input pl-9 pr-3 text-foreground placeholder:text-muted-foreground"
            />
          </label>
          <Button
            type="button"
            variant="secondary"
            aria-expanded={open}
            aria-controls="job-filters"
            onClick={() => setOpen((current) => !current)}
            className={cn("shrink-0", open && "border-primary")}
          >
            <SlidersHorizontal />
            {/* Below 360 px the word gives way to the search box, which has
                more to say; the icon and the count stay. */}
            <span className="max-[359px]:sr-only">Filters</span>
            {inUse > 0 ? (
              <span className="tabular flex min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[0.6875rem] font-semibold text-primary-foreground">
                {inUse}
                <span className="sr-only"> in use</span>
              </span>
            ) : null}
          </Button>
        </div>

        {open ? (
          <div
            id="job-filters"
            className="grid grid-cols-1 gap-3 rounded-xl border border-border bg-surface p-3 min-[360px]:grid-cols-2 sm:p-4"
          >
            <Field label="From" htmlFor="jobs-from">
              <Input
                id="jobs-from"
                type="date"
                name="from"
                value={values.from}
                max={values.to || undefined}
                onChange={(event) => set("from")(event.target.value)}
                className="min-w-0"
              />
            </Field>
            <Field label="To" htmlFor="jobs-to">
              <Input
                id="jobs-to"
                type="date"
                name="to"
                value={values.to}
                min={values.from || undefined}
                onChange={(event) => set("to")(event.target.value)}
                className="min-w-0"
              />
            </Field>

            <Field label="Paying company" htmlFor="jobs-company">
              <Picker
                id="jobs-company"
                name="company"
                value={values.company}
                onChange={set("company")}
                options={companies}
              />
            </Field>
            <Field label="Rep company" htmlFor="jobs-rep">
              <Picker
                id="jobs-rep"
                name="rep"
                value={values.rep}
                onChange={set("rep")}
                options={reps}
              />
            </Field>

            <Field label="Project" htmlFor="jobs-project" className="min-[360px]:col-span-2">
              <Combobox
                id="jobs-project"
                name="project"
                value={values.project}
                onChange={set("project")}
                options={projects}
                placeholder="Any"
              />
            </Field>
            {techs ? (
              <Field label="Tech" htmlFor="jobs-tech" className="min-[360px]:col-span-2">
                <Combobox
                  id="jobs-tech"
                  name="tech"
                  value={values.tech}
                  onChange={set("tech")}
                  options={techs}
                  placeholder="Anyone"
                />
              </Field>
            ) : null}

            <Field label="Customer" htmlFor="jobs-customer">
              <Picker
                id="jobs-customer"
                name="customer"
                value={values.customer}
                onChange={set("customer")}
                options={customers}
              />
            </Field>
            <Field label="Site ID" htmlFor="jobs-site">
              <Input
                id="jobs-site"
                name="site"
                value={values.site}
                onChange={(event) => set("site")(event.target.value)}
                placeholder="e.g. 10542"
                autoComplete="off"
                className="min-w-0"
              />
            </Field>

            <div className="flex flex-wrap gap-2 pt-1 min-[360px]:col-span-2">
              <Button type="submit" disabled={pending}>
                Show jobs
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => go({ ...values, ...NONE })}
              >
                Clear filters
              </Button>
            </div>
          </div>
        ) : null}
      </form>
    </div>
  );
}

/**
 * A short list as the phone's own picker: in half a row a typed-to list would
 * cut "Granite Telecommunications" down to "Granite Tele…", where the system
 * wheel shows it whole. The app's selects draw no arrow, so this one does,
 * to sit beside the type-to pickers as the same kind of thing.
 */
function Picker({
  id,
  name,
  value,
  onChange,
  options,
}: {
  id: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  options: Option[];
}) {
  return (
    <div className="relative">
      <Select
        id={id}
        name={name}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-w-0 truncate"
      >
        <option value="">Any</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  );
}
