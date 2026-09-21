import {
  ChevronRight,
  CircleCheck,
  Lock,
  MessageSquarePlus,
  PencilLine,
  Repeat,
} from "lucide-react";
import Link from "next/link";
import { ScheduleBudgetIcon } from "@/components/icons";
import type { PortalIcon, PortalItem } from "@/lib/job-portal";
import { cn } from "@/lib/utils";

const ICONS: Record<PortalIcon, React.ComponentType<{ className?: string }>> = {
  requests: MessageSquarePlus,
  review: CircleCheck,
  details: PencilLine,
  schedule: ScheduleBudgetIcon,
  revisit: Repeat,
};

/**
 * The portal's destinations, as tiles on a phone and rows on anything wider.
 *
 * Tiles win the phone: every destination on one screen, a thumb-sized target
 * each, no reading required to aim. The price is the sentence, so the state
 * line is written *for* a tile — telegraphic, one line, never a clause —
 * rather than truncated into one.
 *
 * From 640px the same markup becomes rows in two columns and the line comes
 * back in full. Same order, same positions: muscle memory survives the move
 * from the van to a laptop.
 *
 * A locked destination stays exactly where it is, greyed, saying why. It is
 * not removed, because a grid that reshuffles as a job moves through its
 * stages is a grid nobody can learn.
 */
export function PortalGrid({
  label,
  items,
}: {
  label: string;
  items: PortalItem[];
}) {
  if (items.length === 0) return null;
  const alone = items.length === 1;

  return (
    <section>
      <h2 className="mb-2 ml-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </h2>
      <div className="grid grid-cols-2 gap-2.5">
        {items.map((item) => (
          <Tile key={item.key} item={item} wide={alone} />
        ))}
      </div>
    </section>
  );
}

function Tile({ item, wide }: { item: PortalItem; wide: boolean }) {
  const Icon = ICONS[item.icon];
  const locked = item.locked !== null;

  const body = (
    <>
      {item.needsApproval && !locked ? (
        <MessageSquarePlus
          className="absolute right-3 top-3 size-[15px] text-warning sm:hidden"
          aria-label="Some changes need approval"
        />
      ) : null}
      {locked ? (
        <Lock
          className="absolute right-3 top-3 size-[15px] text-muted-foreground sm:hidden"
          aria-hidden
        />
      ) : null}

      <span
        className={cn(
          "flex size-[34px] shrink-0 items-center justify-center rounded-lg",
          locked
            ? "bg-muted text-muted-foreground"
            : item.group === "action"
              ? "bg-warning/15 text-warning"
              : "bg-primary/15 text-primary",
        )}
      >
        <Icon className="size-[18px]" />
      </span>

      <span className="min-w-0 sm:flex-1">
        <span className="flex flex-wrap items-center gap-1.5 text-[13px] font-semibold tracking-tight sm:text-sm">
          {item.label}
          {item.needsApproval && !locked ? (
            <span className="hidden rounded-md bg-warning/15 px-1.5 py-0.5 text-[11px] font-semibold text-warning ring-1 ring-inset ring-warning/30 sm:inline">
              Approval required
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground sm:text-xs">
          {item.locked ?? item.state}
        </span>
        {item.more?.map((line) => (
          <span
            key={line}
            className="mt-0.5 block text-[11px] leading-snug text-warning sm:text-xs"
          >
            {line}
          </span>
        ))}
      </span>

      {item.count ? (
        <span className="absolute right-3 top-3 flex h-[22px] min-w-[22px] items-center justify-center rounded-md bg-warning px-1.5 text-xs font-bold text-warning-foreground sm:static sm:shrink-0">
          {item.count}
        </span>
      ) : null}

      {locked ? (
        <Lock className="hidden size-4 shrink-0 text-muted-foreground sm:block" aria-hidden />
      ) : (
        <ChevronRight className="hidden size-[18px] shrink-0 text-muted-foreground sm:block" />
      )}
    </>
  );

  const shape = cn(
    "relative flex min-h-[112px] flex-col gap-2 rounded-xl border border-border bg-surface p-3",
    "sm:min-h-0 sm:flex-row sm:items-center sm:gap-3 sm:p-3.5",
    wide && "col-span-2 min-h-0 flex-row items-center gap-3 px-3.5",
    item.group === "action" &&
      !locked &&
      "border-success/45 bg-success/[0.07]",
  );

  // Locked ones are not links. Tapping something that refuses to do anything
  // is worse than a tile that plainly is not one, and the reason is already
  // where the state line goes.
  if (locked) {
    return <span className={cn(shape, "opacity-45")}>{body}</span>;
  }

  return (
    <Link href={item.href} className={cn(shape, "hover:border-primary/50")}>
      {body}
    </Link>
  );
}
