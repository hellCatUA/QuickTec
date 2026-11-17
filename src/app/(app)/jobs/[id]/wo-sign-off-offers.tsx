"use client";

import { CircleCheck, FileSignature, Wand2 } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  NO_WORK_ORDER,
  NOT_CLOSED_YET,
  type CheckoutPaperwork,
  type WorkOrderSignOff,
} from "@/lib/wo-sign-off";
import { cn } from "@/lib/utils";

/** The owner's words for it, on every button that leads there. */
export const USE_WO_LABEL = "Use WM WO as a Sign-Off";

/**
 * The same words, kept from breaking at the hyphen: at 320 px the label wrapped
 * as "Sign-" on one line and "Off" on the next.
 */
function UseWoLabel() {
  return (
    <span>
      Use WM WO as a <span className="whitespace-nowrap">Sign-Off</span>
    </span>
  );
}

const actionClass =
  "inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition-colors";

/**
 * What is offered once the last clock-out has closed the job.
 *
 * The end of the job is when the customer is standing there to sign, and the
 * moment the times on the paper are final. Their work order is always offered
 * — a sheet signed already is no reason not to send the work order back
 * signed too — and their own sheet beside it when it is on the job and still
 * empty.
 */
export function AfterCheckout({
  jobId,
  paperwork,
  onDone,
}: {
  jobId: string;
  paperwork: CheckoutPaperwork;
  onDone: () => void;
}) {
  const { workOrder, sheet, signOffOnJob } = paperwork;

  // Said from what is actually offered. It used to say a sign-off was on the
  // job already over a button to fill in their sheet, and to promise their
  // work order on a job that had none.
  const said =
    sheet && workOrder
      ? "Get the paperwork signed while the customer is here: their sign-off sheet, and their work order as well."
      : sheet
        ? "Get their sign-off sheet filled in and signed while the customer is here."
        : signOffOnJob
          ? "A sign-off is on the job already. Their work order can go back signed as well."
          : "This company has no sign-off sheet on the job. Their work order can go back signed instead.";

  return (
    <Card className="border-primary/50">
      <CardContent className="flex flex-col gap-3">
        <p className="flex items-center gap-2 font-medium">
          <CircleCheck className="size-5 shrink-0 text-success" aria-hidden />
          Clocked out. The job is closed.
        </p>
        <p className="text-sm text-muted-foreground">{said}</p>

        <div className="flex flex-col gap-2">
          {sheet ? (
            <Link
              href={`/jobs/${jobId}/sign-off/${sheet.templateId}`}
              className={cn(actionClass, "bg-primary text-primary-foreground hover:bg-primary/90")}
            >
              <Wand2 className="size-4 shrink-0" aria-hidden />
              Fill in the sign-off sheet
            </Link>
          ) : null}
          {workOrder ? (
            <Link
              href={`/jobs/${jobId}/wo-sign-off?wo=${workOrder.id}`}
              className={cn(
                actionClass,
                sheet
                  ? "border border-border bg-surface-raised hover:bg-muted"
                  : "bg-primary text-primary-foreground hover:bg-primary/90",
              )}
            >
              <FileSignature className="size-4 shrink-0" aria-hidden />
              {workOrder.signed ? "Sign the work order again" : <UseWoLabel />}
            </Link>
          ) : null}
          <Button type="button" variant="ghost" block onClick={onDone}>
            Not now
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * The same offer, kept in the Sign-off block for whenever it is wanted.
 *
 * Shown before the job is closed too, so nobody wonders where it went — but
 * pressed then it says why not, rather than opening a page that would refuse.
 * The server refuses as well; this is the courtesy, not the check.
 */
export function WoSignOffEntry({
  jobId,
  state,
}: {
  jobId: string;
  state: WorkOrderSignOff;
}) {
  const [why, setWhy] = React.useState<string | null>(null);
  const ready = state.done && state.workOrders.length > 0;
  const blocked = !state.done
    ? `${NOT_CLOSED_YET} It is offered then, and stays here for afterwards.`
    : state.workOrders.length === 0
      ? NO_WORK_ORDER
      : null;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <div className="flex items-start gap-2">
        <FileSignature className="mt-0.5 size-4 shrink-0 text-[var(--color-primary)]" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Their work order as the sign-off</p>
          <p className="text-xs text-muted-foreground">
            For a company with no sheet of its own: the times, the work performed and the
            customer&rsquo;s signature go onto their WorkMarket work order.
          </p>
        </div>
      </div>

      {state.signed.map((copy) => (
        <a
          key={copy.id}
          href={`/api/files/${copy.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-h-11 min-w-0 items-center gap-2 rounded-lg border border-border px-3 text-sm hover:bg-muted"
        >
          <Wand2 className="size-4 shrink-0 text-[var(--color-primary)]" aria-hidden />
          <span className="min-w-0 truncate">{copy.name}</span>
        </a>
      ))}

      {ready ? (
        <Link
          href={`/jobs/${jobId}/wo-sign-off`}
          className={cn(actionClass, "border border-border bg-surface-raised hover:bg-muted")}
        >
          <FileSignature className="size-4 shrink-0" aria-hidden />
          <UseWoLabel />
        </Link>
      ) : (
        <button
          type="button"
          aria-disabled="true"
          aria-describedby={why ? `wo-why-${jobId}` : undefined}
          onClick={() => setWhy(blocked)}
          className={cn(actionClass, "border border-dashed border-border text-muted-foreground")}
        >
          <FileSignature className="size-4 shrink-0" aria-hidden />
          <UseWoLabel />
        </button>
      )}
      {why ? (
        <p id={`wo-why-${jobId}`} role="alert" className="text-sm text-warning">
          {why}
        </p>
      ) : null}
    </div>
  );
}
