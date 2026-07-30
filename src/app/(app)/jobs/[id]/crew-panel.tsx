"use client";

import { Star, UserPlus, X } from "lucide-react";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { assignTech, setLeadTech, unassignTech } from "./actions";

export type CrewMember = {
  id: string;
  userId: string;
  name: string;
  isLead: boolean;
  onSite: boolean;
  hasWorked: boolean;
  supervisorName: string | null;
  rate: string | null;
};

/**
 * Who is on the job, and who is allowed to change that.
 *
 * A revisit and a tech's ad-hoc job both start with nobody planned in, so this
 * is the only way either of them ever gets a crew. Somebody who has already
 * clocked in cannot be removed — their hours are the payroll record — so the
 * button is simply not offered for them rather than failing on the press.
 */
export function CrewPanel({
  jobId,
  crew,
  candidates,
  canAssign,
  canReassign,
}: {
  jobId: string;
  crew: CrewMember[];
  candidates: { id: string; name: string; role: string }[];
  canAssign: boolean;
  canReassign: boolean;
}) {
  const [error, setError] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState(false);
  const [picked, setPicked] = React.useState("");
  const [removing, setRemoving] = React.useState<CrewMember | null>(null);
  const [reason, setReason] = React.useState("");
  const [pending, startTransition] = React.useTransition();

  function run(
    action: (formData: FormData) => Promise<{ ok: boolean; error?: string }>,
    userId: string,
    extra?: Record<string, string>,
  ) {
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("jobId", jobId);
      formData.set("userId", userId);
      for (const [key, value] of Object.entries(extra ?? {})) {
        formData.set(key, value);
      }
      const result = await action(formData);
      if (!result.ok) setError(result.error ?? "That did not work.");
    });
  }

  const available = candidates.filter(
    (person) => !crew.some((member) => member.userId === person.id),
  );

  return (
    <div className="flex flex-col gap-2">
      {error ? <p className="text-sm text-danger">{error}</p> : null}

      {crew.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nobody assigned yet.</p>
      ) : (
        crew.map((member) => (
          <div
            key={member.id}
            className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-sm"
          >
            <span className="font-medium">{member.name}</span>
            {member.isLead ? <Badge variant="primary">Lead</Badge> : null}
            {member.onSite ? <Badge variant="success">On site</Badge> : null}
            <span className="text-xs text-muted-foreground">
              Approver: {member.supervisorName ?? "not set"}
            </span>
            {member.rate ? (
              <span className="text-xs">{member.rate}</span>
            ) : null}

            <div className="ml-auto flex items-center gap-1">
              {canAssign && !member.isLead ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Make ${member.name} the lead`}
                  disabled={pending}
                  onClick={() => run(setLeadTech, member.userId)}
                >
                  <Star />
                </Button>
              ) : null}
              {canReassign && !member.hasWorked ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Take ${member.name} off this job`}
                  disabled={pending}
                  onClick={() => {
                    setReason("");
                    setRemoving(member);
                  }}
                >
                  <X />
                </Button>
              ) : null}
            </div>
          </div>
        ))
      )}

      {removing ? (
        <div className="flex flex-col gap-3 rounded-lg border border-warning/40 bg-warning/10 p-3">
          <p className="text-sm">
            Take <span className="font-medium">{removing.name}</span> off this
            job?
          </p>
          <Field label="Reason (optional)" htmlFor="crew-remove-reason">
            <Input
              id="crew-remove-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Sent to a closer job"
              autoFocus
            />
          </Field>
          <p className="text-xs text-muted-foreground">
            It goes on the timeline and into the message they get, which saves
            the phone call asking why.
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="danger"
              disabled={pending}
              onClick={() => {
                run(unassignTech, removing.userId, { reason });
                setRemoving(null);
              }}
            >
              Take them off
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setRemoving(null)}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {canAssign && available.length > 0 ? (
        adding ? (
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-raised p-3">
            <Field label="Who is going" htmlFor="crew-add">
              <Select
                id="crew-add"
                value={picked}
                onChange={(event) => setPicked(event.target.value)}
                autoFocus
              >
                <option value="">Pick someone</option>
                {available.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name} · {person.role.toLowerCase()}
                  </option>
                ))}
              </Select>
            </Field>
            <p className="text-xs text-muted-foreground">
              Their rate is read from the project or client when they are added
              and copied onto the job, so re-rating later cannot rewrite work
              that has already happened.
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                disabled={pending || !picked}
                onClick={() => {
                  run(assignTech, picked);
                  setPicked("");
                  setAdding(false);
                }}
              >
                Add to crew
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setAdding(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="self-start"
            onClick={() => setAdding(true)}
          >
            <UserPlus /> Add a tech
          </Button>
        )
      ) : null}
    </div>
  );
}
