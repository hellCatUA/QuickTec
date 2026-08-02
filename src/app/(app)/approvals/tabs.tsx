import Link from "next/link";
import { cn } from "@/lib/utils";

export const APPROVAL_TABS = [
  { key: "waiting", label: "Waiting on you" },
  { key: "outgoing", label: "Your requests" },
  { key: "archive", label: "Archive" },
] as const;

export type ApprovalTab = (typeof APPROVAL_TABS)[number]["key"];

export function isApprovalTab(value: string | undefined): value is ApprovalTab {
  return APPROVAL_TABS.some((tab) => tab.key === value);
}

/**
 * Three questions, not one list.
 *
 * "What is waiting on me", "what have I asked for", and "what was decided" are
 * asked at different moments and by different people — a tech never has the
 * first and lives in the second. Links rather than client state so a tab
 * survives a refresh and can be sent to somebody.
 */
export function ApprovalTabs({
  active,
  counts,
}: {
  active: ApprovalTab;
  counts: Partial<Record<ApprovalTab, number>>;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {APPROVAL_TABS.map((tab) => {
        const count = counts[tab.key] ?? 0;
        return (
          <Link
            key={tab.key}
            href={tab.key === "waiting" ? "/approvals" : `/approvals?tab=${tab.key}`}
            className={cn(
              "flex min-h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors",
              active === tab.key
                ? "border-primary bg-primary/15 text-primary"
                : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {tab.label}
            {count > 0 ? (
              <span className="tabular opacity-70">{count}</span>
            ) : null}
          </Link>
        );
      })}
    </div>
  );
}
