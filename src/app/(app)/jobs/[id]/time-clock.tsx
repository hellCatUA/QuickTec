"use client";

import { Coffee, LogIn, LogOut, Play } from "lucide-react";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { usTimeInZone } from "@/lib/datetime";
import { formatMoney, PAY_TYPE_LABEL } from "@/lib/money";
import {
  assignmentTotals,
  earnings,
  formatElapsedPrecise,
  type VisitInput,
} from "@/lib/time-tracking";
import type { PayType } from "@prisma-client";
import { clockIn, clockOut, toggleBreak } from "./actions";
import { ClockPicker } from "./clock-picker";

type Mode = "in" | "out" | null;

export function TimeClock({
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
  onRequestCheckout,
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
  /** Present when the job should go through the guided checkout on the way out. */
  onRequestCheckout?: () => void;
}) {
  // Starts on the server's clock so the first client render matches the HTML
  // that arrived; the interval takes over from there.
  const [now, setNow] = React.useState(() => new Date(serverNow));
  const [picker, setPicker] = React.useState<Mode>(null);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  const openVisit = visits.find((visit) => visit.clockOutAt === null);
  /** They have been here. One job is one arrival, so that is the end of it. */
  const worked = visits.length > 0 && !openVisit;
  const onBreak = Boolean(
    openVisit?.breaks.some((entry) => entry.endAt === null),
  );

  React.useEffect(() => {
    if (!openVisit) return;
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, [openVisit]);

  const totals = assignmentTotals(visits, now);
  const money = earnings(payType, payRate, totals.paidMinutes);

  // Snapping rounds up by as much as three minutes, so a fresh clock-in is
  // often a minute or two in the future and the counter would otherwise sit
  // frozen at zero looking broken. Say what is actually happening instead.
  const startsAt = openVisit ? new Date(openVisit.clockInAt) : null;
  const notStartedYet = Boolean(startsAt && startsAt.getTime() > now.getTime());

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setError(result.error ?? "Something went wrong");
      else setPicker(null);
    });
  }

  function submit(kind: "in" | "out", at?: Date) {
    const formData = new FormData();
    formData.set("jobId", jobId);
    if (at) formData.set("at", at.toISOString());
    run(() => (kind === "in" ? clockIn(formData) : clockOut(formData)));
  }

  if (!canClock) return null;

  return (
    <Card className={openVisit ? "border-success/50" : undefined}>
      <CardContent className="flex flex-col gap-4">
        {openVisit ? (
          <>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                On site since
              </span>
              <span className="tabular text-sm font-medium">
                {usTimeInZone(new Date(openVisit.clockInAt), timeZone)}
              </span>
              {onBreak ? (
                <Badge variant="warning">
                  On break · {breakPaid ? "paid" : "unpaid"}
                </Badge>
              ) : null}
            </div>

            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  {notStartedYet ? "Clock starts" : "Elapsed"}
                </div>
                <div className="tabular text-3xl font-semibold">
                  {notStartedYet
                    ? usTimeInZone(startsAt as Date, timeZone)
                    : formatElapsedPrecise(totals.onsiteMinutes * 60)}
                </div>
              </div>

              {showPay ? (
                <div className="text-right">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">
                    Earned
                  </div>
                  <div className="tabular text-3xl font-semibold text-success">
                    {formatMoney(money)}
                  </div>
                </div>
              ) : null}
            </div>

            {notStartedYet ? (
              <p className="text-xs text-muted-foreground">
                Your time was rounded up to the next five minutes, so the count
                begins shortly. You are clocked in.
              </p>
            ) : null}

            {totals.unpaidBreakMinutes > 0 ? (
              <p className="text-xs text-muted-foreground">
                {Math.round(totals.unpaidBreakMinutes)} min of unpaid break
                deducted from pay. The client is still billed for the full
                on-site time.
              </p>
            ) : null}
          </>
        ) : (
          <div className="text-sm text-muted-foreground">
            {totals.onsiteMinutes > 0
              ? `Clocked out. ${(totals.paidMinutes / 60).toFixed(2)} hrs recorded so far.`
              : "Not clocked in yet."}
          </div>
        )}

        {showPay ? (
          <p className="text-xs text-muted-foreground">
            {clientName} · {customerName} · {PAY_TYPE_LABEL[payType]}
            {payType === "HOURLY" ? ` · ${formatMoney(payRate)}/hr` : ""}
            {payType === "FLAT" ? ` · ${formatMoney(payRate)}` : ""}
          </p>
        ) : null}

        {error ? <p className="text-sm text-danger">{error}</p> : null}

        {picker ? (
          <ClockPicker
            intervalMinutes={intervalMinutes}
            timeLabel={(date) => usTimeInZone(date, timeZone)}
            pending={pending}
            onPick={(at) => submit(picker, at)}
            onCancel={() => setPicker(null)}
          />
        ) : openVisit ? (
          <div className="flex gap-2">
            <Button
              type="button"
              variant={onBreak ? "success" : "secondary"}
              size="lg"
              className="flex-1"
              disabled={pending}
              onClick={() => {
                const formData = new FormData();
                formData.set("jobId", jobId);
                run(() => toggleBreak(formData));
              }}
            >
              {onBreak ? <Play /> : <Coffee />}
              {onBreak ? "End break" : "Break"}
            </Button>

            <Button
              type="button"
              variant="danger"
              size="lg"
              className="flex-1"
              disabled={pending}
              onClick={() =>
                onRequestCheckout ? onRequestCheckout() : setPicker("out")
              }
            >
              <LogOut /> Clock out
            </Button>
          </div>
        ) : worked ? (
          // One job, one arrival. The server has refused a second clock-in for
          // a while, but the button carried on offering it — so the answer was
          // an error message where there should never have been a button.
          <p className="text-sm text-muted-foreground">
            You have worked this job. A wrong time is corrected in the job&apos;s
            Manager Portal; coming back another day is a revisit.
          </p>
        ) : (
          // The time is asked for rather than assumed. "Now" is the first
          // button in the picker and the common answer, so the extra tap costs
          // nothing — and the tech who started twenty minutes ago no longer has
          // to notice a second, quieter button to say so.
          <Button
            type="button"
            size="lg"
            block
            disabled={pending}
            onClick={() => setPicker("in")}
          >
            <LogIn /> Clock in
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
