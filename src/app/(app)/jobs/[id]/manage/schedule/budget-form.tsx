"use client";

import { Check, CircleAlert, Info, Loader2 } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import {
  describeTerms,
  normaliseTerms,
  onCrewAverage,
  splitError,
  splitTerms,
  termsError,
  underOwnRate,
  type CrewMember,
} from "@/lib/budget";
import { formatCents, PAY_TYPE_LABEL } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { PayType, SplitMode } from "@prisma-client";
import { setJobBudget } from "../../actions";

export type BudgetCrew = {
  assignmentId: string;
  name: string;
  isLead: boolean;
  defaultRateCents: number;
  /** Zero is how somebody is non-billable on a job that pays. */
  shareBasisPoints: number | null;
};

const TYPES: { value: PayType; blurb: string }[] = [
  { value: "HOURLY", blurb: "A rate for the job, shared by the crew." },
  { value: "FLAT", blurb: "One amount for the job, however long it takes." },
  {
    value: "FLAT_HOURLY",
    blurb: "A flat amount covering set hours, then a rate.",
  },
  { value: "NON_BILLABLE", blurb: "Nobody is paid from this job." },
];

const MODES: { value: SplitMode; label: string }[] = [
  { value: "EVEN", label: "Even" },
  { value: "BY_TECH_RATE", label: "By tech rate" },
  { value: "MANUAL", label: "Manual" },
];

/**
 * The total tech budget, and who gets what proportion of it.
 *
 * The preview underneath is the real split: this runs the same function the
 * server writes with, which is the whole reason that function has no database
 * handle in it. A preview that disagreed with what was saved would be worse
 * than none at all.
 */
export function BudgetForm({
  jobId,
  crew,
  budgetType,
  budgetFlat,
  budgetFlatHours,
  budgetHourly,
  splitMode,
  canEdit,
}: {
  jobId: string;
  crew: BudgetCrew[];
  budgetType: PayType | null;
  budgetFlat: string;
  budgetFlatHours: string;
  budgetHourly: string;
  splitMode: SplitMode;
  canEdit: boolean;
}) {
  const [type, setType] = React.useState<PayType | "">(budgetType ?? "");
  const [flat, setFlat] = React.useState(budgetFlat);
  const [hours, setHours] = React.useState(budgetFlatHours);
  const [hourly, setHourly] = React.useState(budgetHourly);
  // One person has nothing to split with, and the selector is not drawn for
  // them — so a stored MANUAL would post a mode nobody could satisfy.
  const [mode, setMode] = React.useState<SplitMode>(
    crew.length > 1 ? splitMode : "EVEN",
  );
  const [excluded, setExcluded] = React.useState<Set<string>>(
    () => new Set(crew.filter((one) => one.shareBasisPoints === 0).map((one) => one.assignmentId)),
  );
  const [manual, setManual] = React.useState<Record<string, string>>(() =>
    Object.fromEntries(
      crew.map((one) => [
        one.assignmentId,
        one.shareBasisPoints ? (one.shareBasisPoints / 100).toFixed(2) : "",
      ]),
    ),
  );
  const [state, action, pending] = React.useActionState<
    { ok: boolean; error?: string } | null,
    FormData
  >(async (_previous, formData) => setJobBudget(formData), null);

  const terms = normaliseTerms({
    payType: (type || "NON_BILLABLE") as PayType,
    flatCents: Math.round(Number(flat || 0) * 100),
    flatMinutes: Math.round(Number(hours || 0) * 60),
    hourlyCents: Math.round(Number(hourly || 0) * 100),
  });

  const members: CrewMember[] = crew.map((one) => ({
    id: one.assignmentId,
    isLead: one.isLead,
    excluded: excluded.has(one.assignmentId),
    defaultRateCents: one.defaultRateCents,
    basisPoints: Math.round(Number(manual[one.assignmentId] || 0) * 100),
  }));

  const preview = splitTerms(terms, members, mode);
  const averaged = onCrewAverage(mode, members);
  const wrongTerms = type === "" ? null : termsError(terms);
  const wrongSplit =
    mode === "MANUAL" && type !== "" && type !== "NON_BILLABLE"
      ? splitError(preview.shares)
      : null;
  const needsFlat = type === "FLAT" || type === "FLAT_HOURLY";
  const needsHourly = type === "HOURLY" || type === "FLAT_HOURLY";

  if (!canEdit) {
    return (
      <p className="text-sm text-muted-foreground">
        {budgetType
          ? `${PAY_TYPE_LABEL[budgetType]} — set by whoever this job's money is charged to.`
          : "No budget set. Everybody keeps their own rate, or the project's default."}
      </p>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-3.5">
      <input type="hidden" name="jobId" value={jobId} />
      <input type="hidden" name="budgetType" value={type} />
      <input type="hidden" name="splitMode" value={mode} />

      <div className="grid grid-cols-2 gap-2.5">
        {TYPES.map((one) => (
          <button
            key={one.value}
            type="button"
            onClick={() => setType(one.value)}
            className={cn(
              "flex min-h-[88px] flex-col gap-1.5 rounded-lg border border-border bg-surface-raised p-3 text-left",
              type === one.value &&
                "border-transparent bg-primary/15 ring-[1.5px] ring-inset ring-primary",
            )}
          >
            <span
              className={cn(
                "text-[12.5px] font-semibold leading-tight",
                type === one.value && "text-primary",
              )}
            >
              {PAY_TYPE_LABEL[one.value]}
            </span>
            <span className="text-[10.5px] leading-snug text-muted-foreground">
              {one.blurb}
            </span>
          </button>
        ))}
      </div>

      {type === "" ? (
        <p className="text-xs text-muted-foreground">
          No budget. Everybody keeps their own rate, or the project&rsquo;s
          default — which is how every job worked before this page existed.
        </p>
      ) : null}

      {/*
        Removing a budget is its own deliberate act rather than tapping the
        selected type twice. Money is the wrong place for a control that
        undoes itself when somebody's thumb lands where it already was.
      */}
      {budgetType && type !== "" ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={() => setType("")}
        >
          Remove the budget
        </Button>
      ) : null}

      {needsFlat || needsHourly ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            {needsFlat ? (
              <Field label="Flat amount" htmlFor="budget-flat">
                <Input
                  id="budget-flat"
                  name="budgetFlat"
                  inputMode="decimal"
                  value={flat}
                  onChange={(event) => setFlat(event.target.value)}
                  placeholder="0.00"
                />
              </Field>
            ) : null}
            {type === "FLAT_HOURLY" ? (
              <Field label="Covers" htmlFor="budget-hours">
                <Input
                  id="budget-hours"
                  name="budgetFlatHours"
                  inputMode="decimal"
                  value={hours}
                  onChange={(event) => setHours(event.target.value)}
                  placeholder="hrs"
                />
              </Field>
            ) : null}
            {needsHourly && type !== "FLAT_HOURLY" ? (
              <Field label="Per hour" htmlFor="budget-hourly">
                <Input
                  id="budget-hourly"
                  name="budgetHourly"
                  inputMode="decimal"
                  value={hourly}
                  onChange={(event) => setHourly(event.target.value)}
                  placeholder="0.00"
                />
              </Field>
            ) : null}
          </div>

          {type === "FLAT_HOURLY" ? (
            <Field
              label="Then per hour"
              htmlFor="budget-hourly"
              hint="Charged from that hour onward, per tech, on their own clock."
            >
              <Input
                id="budget-hourly"
                name="budgetHourly"
                inputMode="decimal"
                value={hourly}
                onChange={(event) => setHourly(event.target.value)}
                placeholder="0.00"
              />
            </Field>
          ) : null}

          <p className="flex gap-2 rounded-lg bg-surface-raised p-2.5 text-[11.5px] leading-relaxed text-muted-foreground">
            <Info className="mt-0.5 size-[15px] shrink-0" />
            <span>
              Enter <strong className="font-bold text-foreground">0</strong>{" "}
              and
              the type becomes Non-billable. A rate of zero is not a rate, and
              the same rule holds in New Job, project defaults and a
              tech&rsquo;s own default.
            </span>
          </p>
        </>
      ) : null}

      {type !== "" && crew.length > 1 ? (
        <>
          <div className="flex gap-0.5 rounded-lg border border-border bg-surface-raised p-0.5">
            {MODES.map((one) => (
              <button
                key={one.value}
                type="button"
                onClick={() => setMode(one.value)}
                className={cn(
                  "min-h-9 flex-1 rounded-md text-xs font-medium text-muted-foreground",
                  mode === one.value &&
                    "bg-primary font-semibold text-primary-foreground",
                )}
              >
                {one.label}
              </button>
            ))}
          </div>

          <ul className="flex flex-col gap-2.5">
            {crew.map((one, index) => {
              const line = preview.lines[index];
              const out = excluded.has(one.assignmentId);
              const low = underOwnRate(line, one.defaultRateCents);
              return (
                <li key={one.assignmentId} className="flex items-center gap-2.5">
                  {out ? (
                    <input type="hidden" name="exclude" value={one.assignmentId} />
                  ) : null}
                  {mode === "MANUAL" && !out ? (
                    <input
                      type="hidden"
                      name={`share:${one.assignmentId}`}
                      value={manual[one.assignmentId] || "0"}
                    />
                  ) : null}

                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-semibold">
                      {one.name}
                      {one.isLead ? (
                        <span className="ml-1.5 text-[11px] font-medium text-muted-foreground">
                          Lead
                        </span>
                      ) : null}
                    </span>
                    <span
                      className={cn(
                        "mt-0.5 block text-[11px] tabular",
                        low ? "text-warning" : "text-muted-foreground",
                      )}
                    >
                      {out
                        ? "Non-billable"
                        : `${(preview.shares[index] / 100).toFixed(2)}%${
                            averaged[index]
                              ? " · no rate recorded, weighted at the crew average"
                              : low
                                ? ` · below their own ${formatCents(one.defaultRateCents)}/hr`
                                : ""
                          }`}
                    </span>
                  </span>

                  {mode === "MANUAL" && !out ? (
                    <Input
                      aria-label={`${one.name}'s share, per cent`}
                      className="h-10 w-24"
                      inputMode="decimal"
                      value={manual[one.assignmentId] ?? ""}
                      onChange={(event) =>
                        setManual((current) => ({
                          ...current,
                          [one.assignmentId]: event.target.value,
                        }))
                      }
                    />
                  ) : (
                    <span className="shrink-0 text-right">
                      <span className="block text-[13.5px] font-bold tabular">
                        {describeTerms(line)}
                      </span>
                    </span>
                  )}

                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setExcluded((current) => {
                        const next = new Set(current);
                        if (next.has(one.assignmentId)) next.delete(one.assignmentId);
                        else next.add(one.assignmentId);
                        return next;
                      })
                    }
                  >
                    {out ? "Include" : "Exclude"}
                  </Button>
                </li>
              );
            })}
          </ul>

          <p className="text-[11.5px] leading-relaxed text-muted-foreground">
            A tech excluded here is on a share of nothing rather than a second
            set of terms, so the job stays on one basis and the total is
            unchanged.
          </p>
        </>
      ) : null}

      {type !== "" && type !== "NON_BILLABLE" ? (
        <div
          className={cn(
            "flex items-center gap-2.5 rounded-lg border p-3",
            wrongTerms || wrongSplit
              ? "border-danger/40 bg-danger/10"
              : "border-success/40 bg-success/[0.08]",
          )}
        >
          {wrongTerms || wrongSplit ? (
            <CircleAlert className="size-4 shrink-0 text-danger" />
          ) : (
            <Check className="size-4 shrink-0 text-success" />
          )}
          <p className="flex-1 text-xs leading-relaxed">
            {wrongTerms ?? wrongSplit ?? (
              <>
                <span className="font-semibold">{describeTerms(terms)}</span>
                <span className="text-muted-foreground">
                  {" "}
                  — the crew&rsquo;s lines add to exactly this.
                </span>
              </>
            )}
          </p>
        </div>
      ) : null}

      {state && !state.ok ? (
        <p className="text-sm text-danger">{state.error}</p>
      ) : null}

      <div className="flex gap-2">
        <Button type="submit" disabled={pending || Boolean(wrongTerms || wrongSplit)}>
          {pending ? <Loader2 className="animate-spin" /> : null}
          {pending ? "Saving…" : "Submit"}
        </Button>
      </div>
    </form>
  );
}

