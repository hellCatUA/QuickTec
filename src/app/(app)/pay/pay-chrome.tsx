import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import Link from "next/link";
import { hours, money } from "@/lib/pay-format";
import {
  PAY_STAGES,
  PAY_STAGE_LABEL,
  payTotal,
  type PayStage,
  type PayState,
  type PayTotals,
} from "@/lib/pay-period";
import { cn } from "@/lib/utils";

/**
 * The parts every Pay screen shares.
 *
 * A week reached from the week list and the same week reached from a month are
 * one screen, so the pieces it is built from live here rather than being drawn
 * twice and drifting apart.
 */

/** Weekly / Monthly. The same money, at two scales. */
export function ScopeToggle({
  active,
  weeklyHref,
  monthlyHref,
}: {
  active: "weekly" | "monthly";
  weeklyHref: string;
  monthlyHref: string;
}) {
  const tab = (isActive: boolean) =>
    cn(
      "flex min-h-11 flex-1 items-center justify-center rounded-lg text-sm transition-colors",
      isActive
        ? "bg-surface-raised font-semibold text-foreground shadow-sm"
        : "font-medium text-muted-foreground hover:text-foreground",
    );

  return (
    <div className="flex gap-0.5 rounded-[0.625rem] bg-muted p-0.5">
      <Link href={weeklyHref} className={tab(active === "weekly")}>
        Weekly
      </Link>
      <Link href={monthlyHref} className={tab(active === "monthly")}>
        Monthly
      </Link>
    </div>
  );
}

/**
 * Which period is on screen, and the export that hands you exactly it.
 *
 * The plain name leads — "This week", "Week of Aug 17" — with the precise one
 * under it, because the first thing somebody needs to know is whether they are
 * looking at now or at history.
 */
export function PeriodRow({
  name,
  detail,
  backHref,
  prevHref,
  nextHref,
  exportHref,
  exportLabel,
}: {
  name: string;
  detail: string;
  backHref?: string;
  prevHref?: string;
  nextHref?: string;
  exportHref?: string;
  exportLabel?: string;
}) {
  const stepper =
    "flex size-11 shrink-0 items-center justify-center rounded-[0.625rem] border border-border bg-surface text-muted-foreground hover:text-foreground";

  return (
    <div className="flex items-center gap-2.5">
      {backHref ? (
        <Link href={backHref} aria-label="Back" className={stepper}>
          <ChevronLeft className="size-4" />
        </Link>
      ) : null}

      {prevHref ? (
        <Link href={prevHref} aria-label="Previous" className={stepper}>
          <ChevronLeft className="size-4" />
        </Link>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col gap-px">
        <div className="text-base font-semibold">{name}</div>
        <div className="text-xs tabular-nums text-muted-foreground">
          {detail}
        </div>
      </div>

      {nextHref ? (
        <Link href={nextHref} aria-label="Next" className={stepper}>
          <ChevronRight className="size-4" />
        </Link>
      ) : null}

      {exportHref ? (
        <a
          href={exportHref}
          className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-[0.625rem] border border-border bg-surface-raised px-3 text-xs font-medium hover:bg-muted"
        >
          <Download className="size-4 text-muted-foreground" />
          <span className="tabular-nums">{exportLabel}</span>
        </a>
      ) : null}
    </div>
  );
}

/** The headline figure, and the one sentence of context it needs. */
export function EarnedCard({
  totals,
  note,
}: {
  totals: PayTotals;
  note: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-4">
      {/* "Total" rather than "Earned": it now carries expenses too, and a
          hotel bill handed back is not something anybody earned. */}
      <div className="text-[0.6875rem] font-medium uppercase tracking-[0.06em] text-muted-foreground">
        Total
      </div>
      <div className="text-4xl font-semibold leading-tight tracking-tight tabular-nums">
        {money(payTotal(totals))}
      </div>
      <div className="text-xs text-muted-foreground">{note}</div>
    </div>
  );
}

function Stat({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  /** Set where the number means nothing without it, like a rate. */
  unit?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-xl border border-border bg-surface p-3.5">
      <div className="text-[0.6875rem] uppercase tracking-[0.06em] text-muted-foreground">
        {label}
      </div>
      <div className="text-[1.375rem] font-semibold tabular-nums">
        {value}
        {unit ? (
          <span className="text-sm font-medium text-muted-foreground">
            {unit}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function StatsGrid({ totals }: { totals: PayTotals }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <Stat label="Hours paid" value={hours(totals.paidMinutes)} />
      <Stat label="Jobs" value={String(totals.jobs)} />
      <Stat label="On site" value={hours(totals.onsiteMinutes)} />
      {/* Everything earned over every hour on site, so it says /hr like any
          other rate — without the unit it reads as a total, which it is not. */}
      <Stat
        label="Blended"
        value={
          totals.blendedHourlyCents === null
            ? "—"
            : money(totals.blendedHourlyCents)
        }
        unit={totals.blendedHourlyCents === null ? undefined : "/hr"}
      />
    </div>
  );
}

/**
 * How far along a week is, and therefore how much to trust the figure above it.
 *
 * A number that can still move should say so rather than look settled — that is
 * the whole point of showing payroll's stage next to money read off the clock.
 */
export function StageTracker({
  state,
  explanation,
}: {
  state: PayState;
  explanation: React.ReactNode;
}) {
  const reached = PAY_STAGES.indexOf(state.stage);
  const settled = state.stage === "paid";

  return (
    <div
      className={cn(
        "flex flex-col gap-2.5 rounded-xl border p-3.5",
        settled
          ? "border-success/35 bg-success/5"
          : "border-border bg-surface",
      )}
    >
      <div className="flex items-center">
        {PAY_STAGES.map((stage, index) => {
          const done = index <= reached;
          const isLast = index === PAY_STAGES.length - 1;
          return (
            <div key={stage} className="contents">
              {index > 0 ? (
                <span
                  className={cn(
                    "h-0.5 flex-1",
                    index <= reached
                      ? settled
                        ? "bg-success"
                        : "bg-primary"
                      : "bg-muted",
                  )}
                />
              ) : null}
              <span
                className={cn(
                  "size-2.5 shrink-0 rounded-full",
                  done
                    ? settled
                      ? "bg-success"
                      : "bg-primary"
                    : "bg-background ring-2 ring-inset ring-muted",
                  done && isLast && settled
                    ? "size-3 ring-[3px] ring-success/25"
                    : "",
                )}
              />
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-4 gap-1">
        {PAY_STAGES.map((stage, index) => (
          <div
            key={stage}
            className={cn(
              "text-[0.6875rem]",
              index === 0
                ? "text-left"
                : index === PAY_STAGES.length - 1
                  ? "text-right"
                  : "text-center",
              stage === state.stage
                ? settled
                  ? "font-semibold text-success"
                  : "font-semibold text-primary"
                : "text-muted-foreground",
            )}
          >
            {PAY_STAGE_LABEL[stage]}
          </div>
        ))}
      </div>

      <div
        className={cn(
          "border-t pt-2.5 text-xs leading-relaxed text-muted-foreground",
          settled ? "border-success/25" : "border-border",
        )}
      >
        {explanation}
      </div>
    </div>
  );
}

/** The coloured dot and word a week list row carries. */
export const STAGE_TONE: Record<PayStage, string> = {
  recorded: "text-primary",
  review: "text-warning",
  approved: "text-success",
  paid: "text-muted-foreground",
};

export const STAGE_DOT: Record<PayStage, string> = {
  recorded: "bg-primary",
  review: "bg-warning",
  approved: "bg-success",
  paid: "bg-muted-foreground",
};

/** "Still running" reads better than "Recorded" on a week that has days left. */
export function stageWord(state: PayState): string {
  return state.stage === "recorded" && state.running
    ? "Still running"
    : PAY_STAGE_LABEL[state.stage];
}

export function StageMark({ state }: { state: PayState }) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        className={cn("size-1.5 rounded-full", STAGE_DOT[state.stage])}
        aria-hidden
      />
      <span className={cn("text-[0.6875rem]", STAGE_TONE[state.stage])}>
        {stageWord(state)}
      </span>
    </div>
  );
}
