"use client";

import { CircleCheck, Loader2, Pencil, Wallet } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { formatMoney, PAY_TYPE_LABEL } from "@/lib/money";
import type { PayType, PayrollStatus } from "@prisma-client";
import {
  approvePayroll,
  markLineReceived,
  markPeriodReceived,
  overrideLine,
} from "./actions";

const STATUS_VARIANT: Record<PayrollStatus, "neutral" | "primary" | "success" | "warning"> = {
  DRAFT: "neutral",
  APPROVED: "primary",
  RECEIVED: "success",
  REDUCED: "warning",
};

type Line = {
  id: string;
  jobId: string;
  title: string;
  intWoId: string;
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

export function PayPeriodPanel({
  period,
  lines,
  canApprove,
  canOverride,
  canMarkReceived,
  isDirectSupervisor,
}: {
  period: {
    id: string;
    status: PayrollStatus;
    expectedAmount: string;
    receivedAmount: string | null;
    receivedDate: string | null;
    expectedPayDate: string | null;
    note: string | null;
    approvedBy: string | null;
    approvedAsFallback: boolean;
    supervisorName: string | null;
  };
  lines: Line[];
  canApprove: boolean;
  canOverride: boolean;
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

  const shortfall =
    period.receivedAmount !== null
      ? Number(period.expectedAmount) - Number(period.receivedAmount)
      : 0;

  return (
    <div className="flex flex-col gap-3">
      {error ? <p className="text-sm text-danger">{error}</p> : null}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle>Week total</CardTitle>
            <Badge variant={STATUS_VARIANT[period.status]}>
              {period.status}
            </Badge>
            {period.approvedAsFallback ? (
              <Badge variant="warning">Approved by a manager</Badge>
            ) : null}
          </div>
          <CardDescription>
            {period.approvedBy
              ? `Approved by ${period.approvedBy}.`
              : period.supervisorName
                ? `Waiting on ${period.supervisorName}.`
                : "No direct supervisor set — payroll cannot be approved."}
            {period.expectedPayDate
              ? ` Expected around ${period.expectedPayDate}.`
              : ""}
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Expected
              </div>
              <div className="tabular text-2xl font-semibold">
                {formatMoney(period.expectedAmount)}
              </div>
            </div>

            {period.receivedAmount !== null ? (
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  Received
                </div>
                <div
                  className={`tabular text-2xl font-semibold ${shortfall > 0 ? "text-warning" : "text-success"}`}
                >
                  {formatMoney(period.receivedAmount)}
                </div>
                {shortfall > 0 ? (
                  <div className="text-xs text-warning">
                    {formatMoney(shortfall)} short
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          {period.note ? (
            <p className="text-xs text-muted-foreground">{period.note}</p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {period.status === "DRAFT" && canApprove ? (
              <Button
                type="button"
                size="sm"
                variant="success"
                disabled={pending}
                onClick={() => {
                  const formData = new FormData();
                  formData.set("periodId", period.id);
                  run(() => approvePayroll(formData));
                }}
              >
                {pending ? <Loader2 className="animate-spin" /> : <CircleCheck />}
                Approve week
                {!isDirectSupervisor ? " (as manager)" : ""}
              </Button>
            ) : null}

            {period.status !== "DRAFT" && canMarkReceived && !receiving ? (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => setReceiving(true)}
              >
                <Wallet /> Record what arrived
              </Button>
            ) : null}
          </div>

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
        </CardContent>
      </Card>

      {lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No work recorded in this week.
        </p>
      ) : null}

      {lines.map((line) => (
        <PayLineCard
          key={line.id}
          line={line}
          canOverride={canOverride}
          canMarkReceived={canMarkReceived}
          periodStatus={period.status}
          pending={pending}
          run={run}
        />
      ))}
    </div>
  );
}

function PayLineCard({
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

  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/jobs/${line.jobId}`}
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            {line.title}
          </Link>
          <span className="tabular text-xs text-muted-foreground">
            {line.intWoId}
          </span>
          {line.payStatus !== "DRAFT" ? (
            <Badge variant={STATUS_VARIANT[line.payStatus]}>
              {line.payStatus}
            </Badge>
          ) : null}
          <span className="ml-auto tabular text-sm font-semibold">
            {formatMoney(effective)}
          </span>
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>
            {PAY_TYPE_LABEL[line.payType]}
            {line.payType === "HOURLY"
              ? ` ${formatMoney(line.payRate)}/hr`
              : ""}
          </span>
          <span>{(line.paidMinutes / 60).toFixed(2)} hrs paid</span>
          <span>Labour {formatMoney(line.laborAmount)}</span>
          {Number(line.travelReimb) > 0 ? (
            <span>Travel {formatMoney(line.travelReimb)}</span>
          ) : null}
          {Number(line.parkingTollsReimb) > 0 ? (
            <span>Parking/tolls {formatMoney(line.parkingTollsReimb)}</span>
          ) : null}
          {Number(line.hotelReimb) > 0 ? (
            <span>Hotel {formatMoney(line.hotelReimb)}</span>
          ) : null}
          {Number(line.materialsReimb) > 0 ? (
            <span>Materials {formatMoney(line.materialsReimb)}</span>
          ) : null}
        </div>

        {line.overrideAmount ? (
          <p className="text-xs text-warning">
            Overridden from {formatMoney(line.totalExpected)} —{" "}
            {line.overrideNote}
          </p>
        ) : null}

        {line.receivedAmount !== null ? (
          <p className="text-xs">
            <span className="text-muted-foreground">Received </span>
            <span className="tabular">{formatMoney(line.receivedAmount)}</span>
            {line.receivedDate ? (
              <span className="text-muted-foreground"> on {line.receivedDate}</span>
            ) : null}
            {line.payNote ? (
              <span className="text-muted-foreground"> · {line.payNote}</span>
            ) : null}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {canOverride && periodStatus !== "RECEIVED" && !overriding ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setOverriding(true)}
            >
              <Pencil /> Override amount
            </Button>
          ) : null}

          {canMarkReceived && periodStatus !== "DRAFT" && !receiving ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setReceiving(true)}
            >
              <Wallet /> Record for this job
            </Button>
          ) : null}
        </div>

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
      </CardContent>
    </Card>
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
  const [date, setDate] = React.useState(
    new Date().toISOString().slice(0, 10),
  );
  const [note, setNote] = React.useState("");

  const short = Number(amount) < Number(defaultAmount);

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-raised p-3">
      <div className="grid gap-2 sm:grid-cols-3">
        <Field label="Amount received ($)" htmlFor={`received-amount-${idPrefix}`}>
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
