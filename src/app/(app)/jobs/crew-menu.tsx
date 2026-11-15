"use client";

import { ChevronDown, UserRound, UsersRound } from "lucide-react";
import * as React from "react";
import { Avatar } from "@/components/profile/parts";
import { Badge } from "@/components/ui/badge";
import type { CrewMember } from "@/lib/job-list";
import { cn } from "@/lib/utils";

/**
 * Who is on a job, in one button: one person's name with a person, or a
 * crowd with how many. The arrow opens all of them — picture, full name, and
 * which one leads.
 *
 * A card used to spell the crew out as "Lead: Terry Tech +1 tech", which said
 * who led and hid who the one was. The names are one tap away now, and the
 * card itself stays one line shorter.
 */
export function CrewMenu({ crew, jobTitle }: { crew: CrewMember[]; jobTitle: string }) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const listId = React.useId();

  // A tap anywhere else closes it, and so does Escape: it is a glance, not a
  // place to stay.
  React.useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const one = crew.length === 1 ? crew[0] : null;
  const Icon = one ? UserRound : UsersRound;
  const said = one ? (one.you ? "You" : one.name) : String(crew.length);

  return (
    // Above the card's own link, which covers the whole card; and while open
    // above the next card too, which the list would otherwise paint over it.
    <div ref={rootRef} className={cn("relative", open ? "z-30" : "z-10")}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={`Crew: ${one ? said : `${crew.length} people`}`}
        onClick={() => setOpen((current) => !current)}
        className="inline-flex min-h-10 max-w-full items-center gap-1.5 rounded-full border border-border bg-surface-raised pl-2.5 pr-2 text-sm font-medium transition-colors hover:bg-muted"
      >
        <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="tabular truncate">{said}</span>
        <ChevronDown
          aria-hidden
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open ? (
        <div
          id={listId}
          role="group"
          aria-label={`Crew on ${jobTitle}`}
          className="absolute left-0 top-full mt-1.5 w-72 max-w-[calc(100vw-3rem)] rounded-xl border border-border bg-surface-raised p-1.5 shadow-lg"
        >
          <p className="px-2 pb-1 pt-0.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Crew · {crew.length}
          </p>
          <ul className="flex flex-col">
            {crew.map((member) => (
              <li
                key={member.id}
                className="flex items-center gap-2.5 rounded-lg px-2 py-1.5"
              >
                <Avatar src={member.picture} name={member.name} size={36} />
                {/* The full name, as asked for: a long one wraps rather than
                    losing its end. */}
                <span className="min-w-0 flex-1 text-sm font-medium leading-snug [overflow-wrap:anywhere]">
                  {member.name}
                  {member.you ? (
                    <span className="font-normal text-muted-foreground"> (you)</span>
                  ) : null}
                </span>
                {member.lead ? <Badge variant="primary">Lead</Badge> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
