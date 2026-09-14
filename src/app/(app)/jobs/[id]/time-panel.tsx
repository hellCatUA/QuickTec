"use client";

import { ClipboardCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import type { VisitInput } from "@/lib/time-tracking";
import type { JobOutcome, PayType } from "@prisma-client";
import { CheckoutWizard, type ModOption } from "./checkout-wizard";
import {
  CheckoutSummary,
  type PreparedCheckout,
} from "./checkout-summary";
import { TimeClock } from "./time-clock";

/**
 * Holds the clock and the checkout together.
 *
 * Clocking out is a process, not a button — the wizard collects the outcome,
 * the release code and the signatures before the visit is closed. "Prepare
 * checkout" runs the same steps and stops short of the clock-out, which is
 * what a tech needs when the manager is available now but the work will run on
 * for another hour.
 *
 * Once a checkout has been prepared, Clock out shows what is already on the job
 * rather than asking for it again. Being walked back through five steps you
 * answered an hour ago reads as the app having forgotten — and until the
 * answers were actually kept, it had.
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
  prepared,
  openPrepare,
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
  /** Null until somebody has run the steps without clocking out. */
  prepared: PreparedCheckout | null;
  /** The "..." menu asked for the prepare run, by way of the URL. */
  openPrepare: boolean;
}) {
  const router = useRouter();
  const [ownWizard, setOwnWizard] = React.useState<"checkout" | null>(null);
  const [summary, setSummary] = React.useState(false);

  // Derived rather than seeded into state: the "..." menu asks for the prepare
  // run by navigating, and navigating to the same page does not remount this
  // component — so a useState initialiser would read the old URL and the menu
  // item would appear to do nothing.
  const wizard: "checkout" | "prepare" | null = openPrepare
    ? "prepare"
    : ownWizard;

  const onSite = visits.some((visit) => visit.clockOutAt === null);

  /** Drops ?checkout=prepare so a refresh does not reopen the wizard. */
  function close() {
    setOwnWizard(null);
    setSummary(false);
    if (openPrepare) router.replace(`/jobs/${jobId}`, { scroll: false });
  }

  if (summary && prepared) {
    return (
      <CheckoutSummary
        jobId={jobId}
        timeZone={timeZone}
        intervalMinutes={intervalMinutes}
        prepared={prepared}
        missingRequired={checkout.missingRequired}
        canOverrideMissing={checkout.canOverrideMissing}
        onEdit={() => {
          setSummary(false);
          setOwnWizard("checkout");
        }}
        onCleared={() => {
          // Cleared means there is nothing left to summarise, so the wizard
          // opens on step one rather than dropping the tech back on the clock
          // with no explanation of what just happened.
          setSummary(false);
          setOwnWizard("checkout");
        }}
        onCancel={close}
      />
    );
  }

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
        onClose={close}
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
          checkout.canSetOutcome
            ? () => (prepared ? setSummary(true) : setOwnWizard("checkout"))
            : undefined
        }
      />

      {/* Said on the clock itself, because it changes what the red button
          does: one more tap and the day is closed. */}
      {onSite && prepared ? (
        <button
          type="button"
          className="flex items-center gap-2 self-start rounded-lg px-1 py-0.5 text-left"
          onClick={() => setSummary(true)}
        >
          <Badge variant="primary">
            <ClipboardCheck className="size-3" /> Checkout prepared
          </Badge>
          <span className="text-xs text-muted-foreground">
            {prepared.preparedBy ? `by ${prepared.preparedBy} · ` : ""}
            {prepared.preparedAt}
          </span>
        </button>
      ) : null}
    </div>
  );
}
