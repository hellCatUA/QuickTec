"use client";

import { Loader2, Plus, X } from "lucide-react";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { ticketRole } from "@/lib/tickets";
import { addJobTicket, deleteJobTicket } from "./actions";

export type ExtraTicket = { id: string; number: string; order: number };

/**
 * The ticket numbers a job answers to.
 *
 * More than one is ordinary: the company raises a second under a different
 * queue, or a revisit is tracked separately and the customer wants both quoted
 * back. The first is the primary and is edited with the other planned fields;
 * these are the ones after it.
 */
export function JobTickets({
  jobId,
  primary,
  extras,
  canEdit,
}: {
  jobId: string;
  /** Shown for context — it is changed through the field above, not here. */
  primary: string | null;
  extras: ExtraTicket[];
  canEdit: boolean;
}) {
  const [adding, setAdding] = React.useState(false);
  const [value, setValue] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function add() {
    if (value.trim() === "") return;
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("jobId", jobId);
      formData.set("number", value);
      const result = await addJobTicket(formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setValue("");
      setAdding(false);
    });
  }

  function remove(id: string) {
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("id", id);
      const result = await deleteJobTicket(formData);
      if (!result.ok) setError(result.error);
    });
  }

  // A job with one ticket and nobody able to add another has nothing to show
  // here that the field above does not already say.
  if (extras.length === 0 && !canEdit) return null;

  return (
    <div className="flex flex-col gap-2">
      {extras.map((ticket, index) => (
        <div
          key={ticket.id}
          className="flex items-center gap-2 text-sm"
        >
          <Badge variant="neutral">{ticketRole(index + 1)}</Badge>
          <span className="min-w-0 flex-1 break-words">{ticket.number}</span>
          {canEdit ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remove ticket ${ticket.number}`}
              disabled={pending}
              onClick={() => remove(ticket.id)}
            >
              <X />
            </Button>
          ) : null}
        </div>
      ))}

      {error ? <p className="text-xs text-danger">{error}</p> : null}

      {canEdit ? (
        adding ? (
          <div className="flex items-center gap-2">
            <Input
              value={value}
              autoFocus
              aria-label="Another ticket number"
              placeholder="S-542976"
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  add();
                }
              }}
            />
            <Button
              type="button"
              size="sm"
              disabled={pending || value.trim() === ""}
              onClick={add}
            >
              {pending ? <Loader2 className="animate-spin" /> : null}
              Add
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setAdding(false);
                setValue("");
              }}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="self-start"
            disabled={pending}
            onClick={() => setAdding(true)}
          >
            <Plus />
            {primary ? "Another ticket" : "Add a ticket"}
          </Button>
        )
      ) : null}
    </div>
  );
}
