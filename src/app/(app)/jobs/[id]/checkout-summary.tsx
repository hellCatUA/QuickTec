"use client";

import {
  AlertTriangle,
  Check,
  Loader2,
  Minus,
  Pencil,
  Trash2,
} from "lucide-react";
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
import { OUTCOME_META } from "@/lib/job-status";
import type { JobOutcome } from "@prisma-client";
import { clearPreparedCheckout, completeCheckout } from "./actions";
import { ClockPicker } from "./clock-picker";

export type PreparedSignature = {
  kind: "MOD" | "TECH";
  signerName: string;
  /** Already formatted in the site's zone. */
  signedAt: string | null;
  skipped: boolean;
  skippedReason: string | null;
};

export type PreparedCheckout = {
  outcome: JobOutcome | null;
  releaseCode: string | null;
  noReleaseCode: boolean;
  revisitRequired: boolean;
  signatures: PreparedSignature[];
  /** Already formatted in the site's zone. */
  preparedAt: string;
  preparedBy: string | null;
};

/**
 * What a prepared checkout already holds, shown at the clock-out.
 *
 * Preparing and then clocking out used to mean answering the same five steps
 * twice — the wizard asked again because nothing it collected the first time
 * was kept. Now that the answers survive, the clock-out has something to show
 * instead of something to ask, and the only question left is the one the wizard
 * was in the way of: what time did you leave.
 *
 * Three ways out of it, because a prepared checkout is a guess about how the
 * day would end and days do not always agree: go, change one answer, or throw
 * the lot away and do it properly.
 */
export function CheckoutSummary({
  jobId,
  timeZone,
  intervalMinutes,
  prepared,
  missingRequired,
  canOverrideMissing,
  onEdit,
  onCleared,
  onCancel,
}: {
  jobId: string;
  timeZone: string;
  intervalMinutes: number;
  prepared: PreparedCheckout;
  missingRequired: string[];
  canOverrideMissing: boolean;
  onEdit: () => void;
  onCleared: () => void;
  onCancel: () => void;
}) {
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const [confirmingClear, setConfirmingClear] = React.useState(false);

  const mod = prepared.signatures.find((one) => one.kind === "MOD") ?? null;
  const tech = prepared.signatures.find((one) => one.kind === "TECH") ?? null;

  async function finish(at?: Date) {
    setError(null);
    setPending(true);
    try {
      const formData = new FormData();
      formData.set("jobId", jobId);
      formData.set("outcome", prepared.outcome ?? "");
      formData.set(
        "releaseCode",
        prepared.noReleaseCode ? "" : (prepared.releaseCode ?? ""),
      );
      formData.set("noReleaseCode", String(prepared.noReleaseCode));
      formData.set("revisitRequired", String(prepared.revisitRequired));
      if (at) formData.set("at", at.toISOString());

      const result = await completeCheckout(null, formData);
      if (!result.ok) setError(result.error ?? "Could not complete checkout.");
      else onCancel();
    } finally {
      setPending(false);
    }
  }

  async function clear() {
    setError(null);
    setPending(true);
    try {
      const formData = new FormData();
      formData.set("jobId", jobId);
      const result = await clearPreparedCheckout(formData);
      if (!result.ok) {
        setError(result.error ?? "Could not clear the prepared checkout.");
        return;
      }
      onCleared();
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="border-primary/50">
      <CardHeader>
        <CardTitle>Checkout is already prepared</CardTitle>
        <CardDescription>
          Prepared by {prepared.preparedBy ?? "somebody"} ·{" "}
          {prepared.preparedAt}
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {error ? <p className="text-sm text-danger">{error}</p> : null}

        <div className="flex flex-col gap-2 rounded-lg border border-border p-3 text-sm">
          <Row label="Outcome">
            {prepared.outcome ? (
              <Badge variant={OUTCOME_META[prepared.outcome].variant}>
                {OUTCOME_META[prepared.outcome].label}
              </Badge>
            ) : (
              <span className="text-warning">Not set</span>
            )}
          </Row>

          <Row label="Release code">
            {prepared.noReleaseCode ? (
              <span className="text-muted-foreground">None for this job</span>
            ) : prepared.releaseCode ? (
              <span className="tabular-nums">{prepared.releaseCode}</span>
            ) : (
              <span className="text-warning">Not set</span>
            )}
          </Row>

          <Row label="Revisit">
            {prepared.revisitRequired ? (
              <Badge variant="warning">Required</Badge>
            ) : (
              <span className="text-muted-foreground">Not needed</span>
            )}
          </Row>

          <SignatureRow label="MOD signature" signature={mod} />
          <SignatureRow label="Your signature" signature={tech} />
        </div>

        {missingRequired.length > 0 ? (
          <div className="flex flex-col gap-2 rounded-lg bg-warning/15 p-3 ring-1 ring-inset ring-warning/30">
            <span className="flex items-center gap-2 text-sm font-medium text-warning">
              <AlertTriangle className="size-4" />
              Still missing
            </span>
            <ul className="list-inside list-disc text-sm text-warning">
              {missingRequired.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <p className="text-xs text-warning">
              {canOverrideMissing
                ? "You can close the job anyway; it will be recorded as an override."
                : "A manager has to approve closing without these."}
            </p>
          </div>
        ) : null}

        <div className="flex gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="flex-1"
            disabled={pending}
            onClick={onEdit}
          >
            <Pencil /> Change or add
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="flex-1"
            disabled={pending}
            onClick={() => setConfirmingClear((open) => !open)}
          >
            <Trash2 /> Start again
          </Button>
        </div>

        {confirmingClear ? (
          <div className="flex flex-col gap-2 rounded-lg border border-danger/40 bg-danger/10 p-3">
            <p className="text-xs text-muted-foreground">
              Clears the outcome, the release code and the revisit flag, and
              removes the signatures with them — a job signed off for an outcome
              nobody chose is worse than one with nothing on it yet. You will be
              taken back to the first step.
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="danger"
                size="sm"
                disabled={pending}
                onClick={() => void clear()}
              >
                {pending ? <Loader2 className="animate-spin" /> : <Trash2 />}
                Clear and start again
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => setConfirmingClear(false)}
              >
                Keep it
              </Button>
            </div>
          </div>
        ) : null}

        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Clock out
        </span>

        <Button
          type="button"
          size="lg"
          block
          disabled={pending || !prepared.outcome}
          onClick={() => void finish()}
        >
          {pending ? <Loader2 className="animate-spin" /> : null}
          Clock out now
        </Button>

        <ClockPicker
          intervalMinutes={intervalMinutes}
          timeLabel={(date) =>
            new Intl.DateTimeFormat("en-US", {
              timeZone,
              hour: "numeric",
              minute: "2-digit",
              hour12: true,
            }).format(date)
          }
          pending={pending}
          onPick={(at) => void finish(at)}
          onCancel={onCancel}
        />
      </CardContent>
    </Card>
  );
}

function SignatureRow({
  label,
  signature,
}: {
  label: string;
  signature: PreparedSignature | null;
}) {
  if (!signature) {
    return (
      <Row label={label}>
        <span className="text-warning">Not captured</span>
      </Row>
    );
  }

  return (
    <Row label={label}>
      <span className="flex flex-col items-end gap-0.5">
        <span className="flex items-center gap-1.5">
          {signature.skipped ? (
            <Minus className="size-3.5 text-muted-foreground" />
          ) : (
            <Check className="size-3.5 text-success" />
          )}
          {signature.signerName}
        </span>
        <span className="text-xs text-muted-foreground">
          {signature.skipped
            ? (signature.skippedReason ?? "No signature obtained")
            : (signature.signedAt ?? "signed")}
        </span>
      </span>
    </Row>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}
