"use client";

import { Loader2, Search, SlidersHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboOption } from "@/components/ui/combobox";
import { Field, Input } from "@/components/ui/field";
import type { JobsQuery } from "@/lib/job-list";
import { cn } from "@/lib/utils";

type Values = {
  q: string;
  from: string;
  to: string;
  tech: string;
  company: string;
  customer: string;
};

const valuesOf = (query: JobsQuery): Values => ({
  q: query.q,
  from: query.from ?? "",
  to: query.to ?? "",
  tech: query.tech ?? "",
  company: query.company ?? "",
  customer: query.customer ?? "",
});

/**
 * The search box, and under "Filters" the days, the tech, the paying company
 * and the customer.
 *
 * All of it is asked of the server, through the address: the box used to sift
 * only the hundred jobs already on the page, so a work order from last spring
 * was "nothing matches" when it was simply not loaded. The address also makes
 * a narrowed list something to bookmark or send, and the tabs keep it.
 *
 * The panel opens in the page rather than over it: on a phone a popover with
 * four fields and the keyboard up has nowhere to go.
 */
export function JobFilters({
  query,
  techs,
  companies,
  customers,
}: {
  query: JobsQuery;
  /** Only for somebody who sees more than their own jobs. */
  techs: ComboOption[] | null;
  companies: ComboOption[];
  customers: ComboOption[];
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

  const inUse =
    (query.from || query.to ? 1 : 0) +
    (techs && query.tech ? 1 : 0) +
    (query.company ? 1 : 0) +
    (query.customer ? 1 : 0);

  function go(next: Values) {
    const params = new URLSearchParams({ filter: query.tab });
    const q = next.q.trim().replace(/\s+/g, " ");
    if (q) params.set("q", q);
    if (next.from) params.set("from", next.from);
    if (next.to) params.set("to", next.to);
    if (techs && next.tech) params.set("tech", next.tech);
    if (next.company) params.set("company", next.company);
    if (next.customer) params.set("customer", next.customer);
    setOpen(false);
    startTransition(() => router.push(`/jobs?${params}`));
  }

  return (
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
          className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-3 sm:p-4"
        >
          <fieldset className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2">
            <legend className="sr-only">Days</legend>
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
          </fieldset>

          {techs ? (
            <Field label="Tech" htmlFor="jobs-tech">
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
          <Field label="Paying company" htmlFor="jobs-company">
            <Combobox
              id="jobs-company"
              name="company"
              value={values.company}
              onChange={set("company")}
              options={companies}
              placeholder="Any"
            />
          </Field>
          <Field label="Customer" htmlFor="jobs-customer">
            <Combobox
              id="jobs-customer"
              name="customer"
              value={values.customer}
              onChange={set("customer")}
              options={customers}
              placeholder="Any"
            />
          </Field>

          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={pending}>
              Show jobs
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() =>
                go({ ...values, from: "", to: "", tech: "", company: "", customer: "" })
              }
            >
              Clear filters
            </Button>
          </div>
        </div>
      ) : null}
    </form>
  );
}
