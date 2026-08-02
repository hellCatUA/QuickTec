import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { JOB_FIELDS, isJobField } from "@/lib/job-fields";

export type DecidedRow = {
  id: string;
  href: string;
  /** "Scheduled start", "Ad-hoc job", "Payroll week" — what was decided. */
  kind: string;
  title: string;
  subtitle: string | null;
  /** Old → new, when the thing was a field change. */
  from?: string | null;
  to?: string | null;
  raisedBy: string | null;
  raisedAt: string;
  decidedBy: string | null;
  /** Null while it is still pending. */
  decidedAt: string | null;
  outcome: "APPROVED" | "REJECTED" | "PENDING";
};

const OUTCOME_VARIANT = {
  APPROVED: "success",
  REJECTED: "danger",
  PENDING: "warning",
} as const;

/**
 * A decision, with both timestamps.
 *
 * When something was asked for and when it was answered are different facts,
 * and the gap between them is the one people actually argue about. Showing
 * only the second turns "it took four days" into an unanswerable question.
 */
export function DecidedList({ rows }: { rows: DecidedRow[] }) {
  return (
    <div className="flex flex-col gap-2">
      {rows.map((row) => (
        <Link
          key={row.id}
          href={row.href}
          className="flex flex-col gap-1 rounded-lg border border-border p-2 transition-colors hover:border-primary/50"
        >
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant={OUTCOME_VARIANT[row.outcome]}>
              {row.outcome === "PENDING"
                ? "Pending"
                : row.outcome === "APPROVED"
                  ? "Approved"
                  : "Rejected"}
            </Badge>
            <span className="text-xs text-muted-foreground">{row.kind}</span>
            <span className="font-medium">{row.title}</span>
            {row.subtitle ? (
              <span className="tabular text-xs text-muted-foreground">
                {row.subtitle}
              </span>
            ) : null}
          </div>

          {row.from !== undefined || row.to !== undefined ? (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-muted-foreground line-through">
                {row.from || "empty"}
              </span>
              <ArrowRight className="size-3 text-muted-foreground" />
              <span>{row.to || "empty"}</span>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
            <span>
              Raised {row.raisedAt}
              {row.raisedBy ? ` by ${row.raisedBy}` : ""}
            </span>
            <span>
              {row.decidedAt
                ? `${row.outcome === "REJECTED" ? "Rejected" : "Approved"} ${row.decidedAt}${row.decidedBy ? ` by ${row.decidedBy}` : ""}`
                : "Not answered yet"}
            </span>
          </div>
        </Link>
      ))}
    </div>
  );
}

/** "Scheduled start" rather than "scheduledStart", for a field change. */
export function fieldKind(fieldPath: string): string {
  return isJobField(fieldPath) ? JOB_FIELDS[fieldPath].label : fieldPath;
}
