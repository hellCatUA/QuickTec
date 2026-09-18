"use client";

import { CircleCheck, Loader2, Pencil, RefreshCw, Wallet } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { formatMoney, PAY_TYPE_LABEL } from "@/lib/money";
import type { PayType, PayrollStatus } from "@prisma-client";
import {
  approvePayroll,
  markLineReceived,
  markPeriodReceived,
  overrideLine,
  runPayroll,
} from "../actions";

const STATUS_VARIANT: Record<
  PayrollStatus,
  "neutral" | "primary" | "success" | "warning"
> = {
  DRAFT: "neutral",
  APPROVED: "primary",
  RECEIVED: "success",
  REDUCED: "warning",
};

type ClockJob = {
  assignmentId: string;
  jobId: string;
  title: string;
  intWoId: string;
  /** Who pays for the job and where it was — not the customer. */
  where: string;
  day: string;
  hours: string;
  payType: PayType;
  payRate: string;
  earned: string;
  reimbursements: { label: string; amount: string }[];
};

type Clock = {
  jobs: ClockJob[];
  earned: string;
  reimbursed: string;
  total: string;
  paidHours: string;
  expectedPayDate: string | null;
};

type Period = {
  id: string;
  status: PayrollStatus;
  expectedAmount: string;
  receivedAmount: string | null;
  receivedDate: string | null;
  expectedPayDate: string | null;
  note: string | null;
  approvedBy: string | null;
  approvedOn: string | null;
  approvedAsFallback: boolean;
  supervisorName: string | null;
};

type Line = {
  id: string;
  jobId: string;
  title: string;
  intWoId: string;
  day: string | null;
  payType: PayType;
  payRate: string;
  paidMinutes: number;
  laborAmount: string;
  travelReimb: string;
  parkingTollsReimb: string;
  hotelReimb: string;
  materialsReimb: string;
  totalExpected: string;
  overrideAmount: string | null;
  overrideNote: string | null;
  receivedAmount: string | null;
  receivedDate: string | null;
  payStatus: PayrollStatus;
  payNote: string | null;
};

export function PeriodPanel({
  subjectId,
  subjectName,
  week,
  clock,
  period,
  lines,
  canApprove,
  canRun,
  canMarkReceived,
  isDirectSupervisor,
}: {
  subjectId: string;
  subjectName: string;
  week: string;
  clock: Clock;
  period: Period | null;
  lines: Line[];
  canApprove: boolean;
  canRun: boolean;
  canMarkReceived: boolean;
  isDirectSupervisor: boolean;
}) {
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const [receiving, setReceiving] = React.useState(false);

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setError(result.error ?? "Something went wrong");
    });
  }

  function build() {
    const formData = new FormData();
    formData.set("userId", subjectId);
    formData.set("week", week);
    run(() => runPayroll(formData));
  }

  const shortfall =
    period?.receivedAmount != null
      ? Number(period.expectedAmount) - Number(period.receivedAmount)
      : 0;

  return (
    <div className="flex flex-col gap-4">
      {error ? <p className="text-sm text-danger">{error}</p> : null}

      <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-4">
        <div className="text-[0.6875rem] font-medium uppercase tracking-[0.06em] text-muted-foreground">
          Expected
        </div>
        <div className="text-[2rem] font-semibold leading-tight tracking-tight tabular-nums">
          {period ? formatMoney(period.expectedAmount) : clock.total}
        </div>
        <div className="text-xs tabular-nums text-muted-foreground">
          {clock.earned} labour + {clock.reimbursed} reimbursed ·{" "}
          {clock.paidHours} hrs paid
          {period?.expectedPayDate
            ? ` · pays out around ${period.expectedPayDate}`
            : clock.expectedPayDate
              ? ` · pays out around ${clock.expectedPayDate}`
              : ""}
        </div>

        {period?.receivedAmount != null ? (
          <div className="mt-2 border-t border-border pt-2 text-xs">
            <span className="text-muted-foreground">Received </span>
            <span
              className={`tabular-nums font-semibold ${shortfall > 0 ? "text-warning" : "text-success"}`}
            >
              {formatMoney(period.receivedAmount)}
            </span>
            {period.receivedDate ? (
              <span className="text-muted-foreground">
                {" "}
                on {period.receivedDate}
              </span>
            ) : null}
            {shortfall > 0 ? (
              <span className="text-warning">
                {" "}
                · {formatMoney(shortfall)} short
              </span>
            ) : null}
            {period.note ? (
              <span className="text-muted-foreground"> · {period.note}</span>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Approving is the point of this screen, so it is not below the fold. */}
      {!period ? (
        <div className="flex flex-col gap-1.5">
          {canRun ? (
            <Button
              type="button"
              className="w-full"
              disabled={pending}
              onClick={build}
            >
              {pending ? (
                <Loader2 className="animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              Build this week
            </Button>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Nothing has been built for this week yet. The figures above come
            straight from {subjectName}&rsquo;s time records; building the week
            freezes them into lines that can be overridden and approved.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {period.status === "DRAFT" ? (
            canApprove ? (
              <Button
                type="button"
                variant="success"
                className="w-full"
                disabled={pending}
                onClick={() => {
                  const formData = new FormData();
                  formData.set("periodId", period.id);
                  run(() => approvePayroll(formData));
                }}
              >
                {pending ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <CircleCheck />
                )}
                Approve the week
                {isDirectSupervisor ? "" : " (as manager)"}
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground">
                {period.supervisorName
                  ? `Waiting on ${period.supervisorName}, who is ${subjectName}'s direct supervisor.`
                  : `${subjectName} has no direct supervisor set, so nobody can approve this week. Set one in Settings → Users.`}
              </p>
            )
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={STATUS_VARIANT[period.status]}>
                {period.status}
              </Badge>
              {period.approvedBy ? (
                <span className="text-xs text-muted-foreground">
                  Approved by {period.approvedBy}
                  {period.approvedOn ? ` on ${period.approvedOn}` : ""}
                </span>
              ) : null}
              {period.approvedAsFallback ? (
                <Badge variant="warning">Approved by a manager</Badge>
              ) : null}

              {canMarkReceived && !receiving ? (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="ml-auto"
                  onClick={() => setReceiving(true)}
                >
                  <Wallet /> Record the week
                </Button>
              ) : null}
            </div>
          )}

          {receiving ? (
            <ReceivedForm
              defaultAmount={period.expectedAmount}
              pending={pending}
              label="Save week payment"
              idPrefix="week"
              onCancel={() => setReceiving(false)}
              onSubmit={(amount, date, note) => {
                const formData = new FormData();
                formData.set("periodId", period.id);
                formData.set("amount", amount);
                formData.set("receivedDate", date);
                formData.set("note", note);
                run(async () => {
                  const result = await markPeriodReceived(formData);
                  if (result.ok) setReceiving(false);
                  return result;
                });
              }}
            />
          ) : null}
        </div>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
          The jobs behind it
        </h2>

        {period ? (
          lines.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
              This week was built with nothing in it.
            </p>
          ) : (
            lines.map((line) => (
              <LineCard
                key={line.id}
                line={line}
                canOverride={canRun}
                canMarkReceived={canMarkReceived}
                periodStatus={period.status}
                pending={pending}
                run={run}
              />
            ))
          )
        ) : clock.jobs.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
            Nothing clocked in this week.
          </p>
        ) : (
          clock.jobs.map((job) => (
            <div
              key={job.assignmentId}
              className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3.5"
            >
              <div className="flex items-baseline gap-2">
                <Link
                  href={`/jobs/${job.jobId}`}
                  className="min-w-0 flex-1 text-sm font-semibold text-primary underline-offset-4 hover:underline"
                >
                  {job.title}
                </Link>
                <span className="text-[0.9375rem] font-semibold tabular-nums">
                  {job.earned}
                </span>
              </div>
              <div className="text-[0.6875rem] tabular-nums text-muted-foreground">
                {job.intWoId} · {job.where} · {job.day} · {job.hours} hrs ·{" "}
                {job.payType === "NON_BILLABLE"
                  ? "no rate set"
                  : `${formatMoney(job.payRate)}${job.payType === "HOURLY" ? "/hr" : " flat"}`}
              </div>
              {job.payType === "NON_BILLABLE" ? (
                <Badge variant="danger">
                  No rate resolved — this will build as $0.00
                </Badge>
              ) : null}
              {job.reimbursements.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {job.reimbursements.map((one, index) => (
                    <Badge key={`${one.label}-${index}`} variant="success">
                      <span className="tabular-nums">+{one.amount}</span>{" "}
                      {one.label.toLowerCase()}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </div>
          ))
        )}
      </section>

      {period && canRun ? (
        <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3.5">
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            disabled={pending}
            onClick={build}
          >
            {pending ? (
              <Loader2 className="animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            Rebuild from the time records
          </Button>
          <p className="text-[0.6875rem] leading-relaxed text-muted-foreground">
            Recalculates hours, rates and reimbursements from what is recorded
            now. Overrides, amounts received and notes are decisions somebody
            made, so they are left alone.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function LineCard({
  line,
  canOverride,
  canMarkReceived,
  periodStatus,
  pending,
  run,
}: {
  line: Line;
  canOverride: boolean;
  canMarkReceived: boolean;
  periodStatus: PayrollStatus;
  pending: boolean;
  run: (action: () => Promise<{ ok: boolean; error?: string }>) => void;
}) {
  const [overriding, setOverriding] = React.useState(false);
  const [receiving, setReceiving] = React.useState(false);
  const [amount, setAmount] = React.useState(
    line.overrideAmount ?? line.totalExpected,
  );
  const [note, setNote] = React.useState(line.overrideNote ?? "");

  const effective = line.overrideAmount ?? line.totalExpected;

  const reimbursements = [
    ["travel", line.travelReimb],
    ["parking & tolls", line.parkingTollsReimb],
    ["hotel", line.hotelReimb],
    ["materials", line.materialsReimb],
  ].filter(([, value]) => Number(value) > 0) as [string, string][];

  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-border bg-surface p-3.5">
      <div className="flex items-baseline gap-2">
        <Link
          href={`/jobs/${line.jobId}`}
          className="min-w-0 flex-1 text-sm font-semibold text-primary underline-offset-4 hover:underline"
        >
          {line.title}
        </Link>
        {line.payStatus !== "DRAFT" ? (
          <Badge variant={STATUS_VARIANT[line.payStatus]}>
            {line.payStatus}
          </Badge>
        ) : null}
        <span className="text-[0.9375rem] font-semibold tabular-nums">
          {formatMoney(effective)}
        </span>
      </div>

      <div className="text-[0.6875rem] tabular-nums text-muted-foreground">
        {line.intWoId}
        {line.day ? ` · ${line.day}` : ""} ·{" "}
        {(line.paidMinutes / 60).toFixed(2)} hrs ·{" "}
        {PAY_TYPE_LABEL[line.payType]}
        {line.payType === "HOURLY" ? ` ${formatMoney(line.payRate)}/hr` : ""} ·
        labour {formatMoney(line.laborAmount)}
      </div>

      {reimbursements.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {reimbursements.map(([label, value]) => (
            <Badge key={label} variant="success">
              <span className="tabular-nums">+{formatMoney(value)}</span>{" "}
              {label}
            </Badge>
          ))}
        </div>
      ) : null}

      {line.overrideAmount ? (
        <p className="text-xs text-warning">
          Overridden from {formatMoney(line.totalExpected)} — {line.overrideNote}
        </p>
      ) : null}

      {line.receivedAmount !== null ? (
        <p className="text-xs">
          <span className="text-muted-foreground">Received </span>
          <span className="tabular-nums">
            {formatMoney(line.receivedAmount)}
          </span>
          {line.receivedDate ? (
            <span className="text-muted-foreground">
              {" "}
              on {line.receivedDate}
            </span>
          ) : null}
          {line.payNote ? (
            <span className="text-muted-foreground"> · {line.payNote}</span>
          ) : null}
        </p>
      ) : null}

      {(canOverride && periodStatus !== "RECEIVED") ||
      (canMarkReceived && periodStatus !== "DRAFT") ? (
        <div className="flex gap-2">
          {canOverride && periodStatus !== "RECEIVED" ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="flex-1"
              onClick={() => setOverriding((open) => !open)}
            >
              <Pencil /> Override amount
            </Button>
          ) : null}
          {/* Named for its scope. The week has a button with the same job, and
              three "Record what arrived" on one screen is three chances to
              record against the wrong thing. */}
          {canMarkReceived && periodStatus !== "DRAFT" ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="flex-1"
              onClick={() => setReceiving((open) => !open)}
            >
              <Wallet /> Record for this job
            </Button>
          ) : null}
        </div>
      ) : null}

      {overriding ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-raised p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Amount ($)" htmlFor={`ov-amount-${line.id}`}>
              <Input
                id={`ov-amount-${line.id}`}
                type="number"
                step="0.01"
                min="0"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </Field>
            <Field
              label="Reason"
              htmlFor={`ov-note-${line.id}`}
              hint="Required — this is what explains the difference later."
            >
              <Input
                id={`ov-note-${line.id}`}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </Field>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={pending || !note.trim()}
              onClick={() => {
                const formData = new FormData();
                formData.set("lineId", line.id);
                formData.set("amount", amount);
                formData.set("note", note);
                run(async () => {
                  const result = await overrideLine(formData);
                  if (result.ok) setOverriding(false);
                  return result;
                });
              }}
            >
              Save override
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setOverriding(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {receiving ? (
        <ReceivedForm
          defaultAmount={effective}
          pending={pending}
          label="Save job payment"
          idPrefix={line.id}
          onCancel={() => setReceiving(false)}
          onSubmit={(value, date, payNote) => {
            const formData = new FormData();
            formData.set("lineId", line.id);
            formData.set("amount", value);
            formData.set("receivedDate", date);
            formData.set("note", payNote);
            run(async () => {
              const result = await markLineReceived(formData);
              if (result.ok) setReceiving(false);
              return result;
            });
          }}
        />
      ) : null}
    </div>
  );
}

function ReceivedForm({
  defaultAmount,
  pending,
  label,
  idPrefix,
  onCancel,
  onSubmit,
}: {
  defaultAmount: string;
  pending: boolean;
  /** Distinguishes the week form from each job's — several are on screen. */
  label: string;
  /** Keeps input ids unique when more than one form is open. */
  idPrefix: string;
  onCancel: () => void;
  onSubmit: (amount: string, date: string, note: string) => void;
}) {
  const [amount, setAmount] = React.useState(defaultAmount);
  const [date, setDate] = React.useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = React.useState("");

  const short = Number(amount) < Number(defaultAmount);

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-raised p-3">
      <div className="grid gap-2 sm:grid-cols-3">
        <Field
          label="Amount received ($)"
          htmlFor={`received-amount-${idPrefix}`}
        >
          <Input
            id={`received-amount-${idPrefix}`}
            type="number"
            step="0.01"
            min="0"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </Field>
        <Field label="Date received" htmlFor={`received-date-${idPrefix}`}>
          <Input
            id={`received-date-${idPrefix}`}
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </Field>
        <Field label="Note" htmlFor={`received-note-${idPrefix}`}>
          <Input
            id={`received-note-${idPrefix}`}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>
      </div>

      {short ? (
        <p className="text-xs text-warning">
          Less than expected — this will be recorded as REDUCED.
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          disabled={pending || !amount || !date}
          onClick={() => onSubmit(amount, date, note)}
        >
          {pending ? <Loader2 className="animate-spin" /> : null}
          {label}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
