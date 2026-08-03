"use client";

import { CircleDollarSign, Loader2, Star, UserPlus, X } from "lucide-react";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Field, Input, Select } from "@/components/ui/field";
import {
  assignTech,
  clearAssignmentPay,
  setAssignmentPay,
  setLeadTech,
  unassignTech,
} from "./actions";

export type CrewMember = {
  id: string;
  userId: string;
  name: string;
  isLead: boolean;
  onSite: boolean;
  hasWorked: boolean;
  supervisorName: string | null;
  rate: string | null;
  payType: string;
  payRate: string;
  travelReimbursement: string | null;
  /** Why this rate, when it is not simply the one that resolved. */
  payNote: string | null;
  /** Deliberately different from the rest of the job. */
  overridden: boolean;
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
  canEditPay,
}: {
  jobId: string;
  crew: CrewMember[];
  candidates: { id: string; name: string; role: string }[];
  canAssign: boolean;
  canReassign: boolean;
  /** Putting one person on a different rate from the rest of the job. */
  canEditPay: boolean;
}) {
  const [error, setError] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState(false);
  const [picked, setPicked] = React.useState("");
  const [removing, setRemoving] = React.useState<CrewMember | null>(null);
  const [reason, setReason] = React.useState("");
  const [pricing, setPricing] = React.useState<CrewMember | null>(null);
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

            {member.overridden ? (
              <Badge variant="warning">Own rate</Badge>
            ) : null}

            <div className="ml-auto flex items-center gap-1">
              {canEditPay ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Set pay for ${member.name}`}
                  disabled={pending}
                  onClick={() => setPricing(member)}
                >
                  <CircleDollarSign />
                </Button>
              ) : null}
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

            {member.payNote ? (
              <span className="w-full text-xs text-muted-foreground">
                {member.payNote}
              </span>
            ) : null}
          </div>
        ))
      )}

      {pricing ? (
        <PayOverride
          member={pricing}
          onClose={() => setPricing(null)}
          onError={setError}
        />
      ) : null}

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
              <Combobox
                id="crew-add"
                value={picked}
                onChange={setPicked}
                placeholder="Search by name…"
                emptyText="Nobody by that name is free for this job."
                allowClear={false}
                options={available.map((person) => ({
                  value: person.id,
                  label: person.name,
                  hint: person.role.toLowerCase(),
                }))}
              />
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

/**
 * One person's rate, when it differs from the rest of the job's.
 *
 * The reason is required rather than optional. A rate that differs from
 * everybody else's on the same night is a question somebody asks three months
 * later, and the answer belongs beside the number rather than in whoever
 * happened to set it.
 */
function PayOverride({
  member,
  onClose,
  onError,
}: {
  member: CrewMember;
  onClose: () => void;
  onError: (message: string | null) => void;
}) {
  const [payType, setPayType] = React.useState(member.payType);
  const [payRate, setPayRate] = React.useState(member.payRate);
  const [travel, setTravel] = React.useState(member.travelReimbursement ?? "");
  const [reason, setReason] = React.useState(
    member.overridden ? (member.payNote ?? "") : "",
  );
  const [pending, startTransition] = React.useTransition();

  function save() {
    onError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("assignmentId", member.id);
      formData.set("payType", payType);
      formData.set("payRate", payRate);
      formData.set("travelReimbursement", travel);
      formData.set("reason", reason);

      const result = await setAssignmentPay(formData);
      if (!result.ok) {
        onError(result.error ?? "That did not work.");
        return;
      }
      onClose();
    });
  }

  function revert() {
    onError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("assignmentId", member.id);
      const result = await clearAssignmentPay(formData);
      if (!result.ok) {
        onError(result.error ?? "That did not work.");
        return;
      }
      onClose();
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-primary/40 bg-primary/5 p-3">
      <p className="text-sm">
        Pay for <span className="font-medium">{member.name}</span> on this job.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Pay type" htmlFor="override-type">
          <Select
            id="override-type"
            value={payType}
            onChange={(event) => setPayType(event.target.value)}
          >
            <option value="HOURLY">Hourly</option>
            <option value="FLAT">Flat rate</option>
            <option value="NON_BILLABLE">Non-billable</option>
          </Select>
        </Field>
        <Field label="Pay rate ($)" htmlFor="override-rate">
          <Input
            id="override-rate"
            type="number"
            step="0.01"
            min={0}
            value={payRate}
            onChange={(event) => setPayRate(event.target.value)}
          />
        </Field>
        <Field label="Travel ($)" htmlFor="override-travel">
          <Input
            id="override-travel"
            type="number"
            step="0.01"
            min={0}
            value={travel}
            onChange={(event) => setTravel(event.target.value)}
            placeholder="None"
          />
        </Field>
        <Field label="Why" htmlFor="override-reason">
          <Input
            id="override-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Shadowing at half rate"
          />
        </Field>
      </div>

      <p className="text-xs text-muted-foreground">
        Setting the job&rsquo;s pay afterwards will leave this person alone.
      </p>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={pending || !reason.trim() || !payRate.trim()}
          onClick={save}
        >
          {pending ? <Loader2 className="animate-spin" /> : null}
          Save their rate
        </Button>
        {member.overridden ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={revert}
          >
            Back to the job&rsquo;s rate
          </Button>
        ) : null}
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
