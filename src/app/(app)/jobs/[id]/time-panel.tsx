"use client";

import { ClipboardCheck } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import type { VisitInput } from "@/lib/time-tracking";
import type { JobOutcome, PayType } from "@prisma-client";
import { CheckoutWizard, type ModOption } from "./checkout-wizard";
import { TimeClock } from "./time-clock";

/**
 * Holds the clock and the checkout together.
 *
 * Clocking out is a process, not a button — the wizard collects the outcome,
 * the release code and the signatures before the visit is closed. "Prepare
 * checkout" runs the same steps and stops short of the clock-out, which is
 * what a tech needs when the manager is available now but the work will run on
 * for another hour.
 */
export function TimePanel({
  jobId,
  timeZone,
  intervalMinutes,
  visits,
  payType,
  payRate,
  showPay,
  breakPaid,
  clientName,
  customerName,
  canClock,
  serverNow,
  checkout,
}: {
  jobId: string;
  timeZone: string;
  intervalMinutes: number;
  visits: VisitInput[];
  payType: PayType;
  payRate: number;
  showPay: boolean;
  breakPaid: boolean;
  clientName: string;
  customerName: string;
  canClock: boolean;
  serverNow: string;
  checkout: {
    missingRequired: string[];
    mods: ModOption[];
    techName: string;
    techSigned: boolean;
    releaseCode: string | null;
    noReleaseCode: boolean;
    outcome: JobOutcome | null;
    revisitRequired: boolean;
    canOverrideMissing: boolean;
    canSetOutcome: boolean;
  };
}) {
  const [wizard, setWizard] = React.useState<"checkout" | "prepare" | null>(null);

  const onSite = visits.some((visit) => visit.clockOutAt === null);

  if (wizard) {
    return (
      <CheckoutWizard
        jobId={jobId}
        mode={wizard}
        timeZone={timeZone}
        intervalMinutes={intervalMinutes}
        missingRequired={checkout.missingRequired}
        mods={checkout.mods}
        techName={checkout.techName}
        techSigned={checkout.techSigned}
        releaseCode={checkout.releaseCode}
        noReleaseCode={checkout.noReleaseCode}
        outcome={checkout.outcome}
        revisitRequired={checkout.revisitRequired}
        canOverrideMissing={checkout.canOverrideMissing}
        onClose={() => setWizard(null)}
      />
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <TimeClock
        jobId={jobId}
        timeZone={timeZone}
        intervalMinutes={intervalMinutes}
        visits={visits}
        payType={payType}
        payRate={payRate}
        showPay={showPay}
        breakPaid={breakPaid}
        clientName={clientName}
        customerName={customerName}
        canClock={canClock}
        serverNow={serverNow}
        onRequestCheckout={
          checkout.canSetOutcome ? () => setWizard("checkout") : undefined
        }
      />

      {onSite && checkout.canSetOutcome ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setWizard("prepare")}
        >
          <ClipboardCheck /> Prepare checkout
        </Button>
      ) : null}
    </div>
  );
}
