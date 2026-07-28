"use client";

import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CircleCheck,
  Loader2,
} from "lucide-react";
import * as React from "react";
import { SignaturePad } from "@/components/signature-pad";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { OUTCOME_META } from "@/lib/job-status";
import type { JobOutcome } from "@prisma-client";
import { addPointOfContact, completeCheckout } from "./actions";
import { ClockPicker } from "./clock-picker";
import { saveSignature } from "./upload-actions";

export type ModOption = { id: string; name: string; signed: boolean };

/**
 * The checkout run-through.
 *
 * Each step commits as it is completed rather than batching to the end: a tech
 * who loses signal after capturing the MOD's signature must not have to chase
 * that person down a second time. That is also what makes "prepare" work — the
 * same wizard, stopped before the clock-out, so signatures and the release code
 * can be collected while the manager is still standing there and the tech can
 * leave quietly later.
 */
type Step = "review" | "outcome" | "release" | "mod" | "tech" | "confirm";

export function CheckoutWizard({
  jobId,
  mode,
  timeZone,
  intervalMinutes,
  missingRequired,
  mods,
  techName,
  techSigned,
  releaseCode: initialReleaseCode,
  noReleaseCode: initialNoReleaseCode,
  outcome: initialOutcome,
  canOverrideMissing,
  onClose,
}: {
  jobId: string;
  mode: "checkout" | "prepare";
  timeZone: string;
  intervalMinutes: number;
  missingRequired: string[];
  mods: ModOption[];
  techName: string;
  techSigned: boolean;
  releaseCode: string | null;
  noReleaseCode: boolean;
  outcome: JobOutcome | null;
  canOverrideMissing: boolean;
  onClose: () => void;
}) {
  const steps: Step[] = [
    "review",
    "outcome",
    "release",
    "mod",
    "tech",
    ...(mode === "checkout" ? (["confirm"] as Step[]) : []),
  ];

  const [index, setIndex] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  const [outcome, setOutcome] = React.useState<JobOutcome | "">(
    initialOutcome ?? "",
  );
  const [releaseCode, setReleaseCode] = React.useState(initialReleaseCode ?? "");
  const [noReleaseCode, setNoReleaseCode] = React.useState(initialNoReleaseCode);

  const [modList, setModList] = React.useState(mods);
  const [modName, setModName] = React.useState("");
  const [modId, setModId] = React.useState(mods[0]?.id ?? "");
  const [noMod, setNoMod] = React.useState(false);
  const [modInk, setModInk] = React.useState<string | null>(null);
  const [modDone, setModDone] = React.useState(mods.some((mod) => mod.signed));

  const [techInk, setTechInk] = React.useState<string | null>(null);
  const [techDone, setTechDone] = React.useState(techSigned);

  const step = steps[index];
  const next = () => setIndex((current) => Math.min(current + 1, steps.length - 1));
  const back = () => setIndex((current) => Math.max(current - 1, 0));

  async function run<T>(work: () => Promise<T>): Promise<T | null> {
    setError(null);
    setPending(true);
    try {
      return await work();
    } finally {
      setPending(false);
    }
  }

  async function saveMod() {
    let contactId = modId;

    // No MOD was recorded on site, so the name is captured here and becomes a
    // real point of contact — it has to appear on the report either way.
    if (!contactId && modName.trim()) {
      const created = await run(async () => {
        const formData = new FormData();
        formData.set("jobId", jobId);
        formData.set("type", "MOD");
        formData.set("name", modName.trim());
        return addPointOfContact(null, formData);
      });
      if (!created?.ok) {
        setError(created?.error ?? "Could not save the MOD name.");
        return false;
      }
      contactId = "";
    }

    const signer = modList.find((mod) => mod.id === contactId)?.name ?? modName.trim();
    if (!signer) {
      setError("Enter the MOD's name, or press No MOD.");
      return false;
    }

    const result = await run(async () => {
      const formData = new FormData();
      formData.set("jobId", jobId);
      formData.set("kind", "MOD");
      formData.set("signerName", signer);
      if (contactId) formData.set("pointOfContactId", contactId);
      if (modInk) formData.set("image", modInk);
      else {
        formData.set("skipped", "true");
        formData.set("skippedReason", "No signature obtained");
      }
      return saveSignature(null, formData);
    });

    if (!result?.ok) {
      setError(result?.error ?? "Could not save the signature.");
      return false;
    }

    setModDone(true);
    if (!modList.some((mod) => mod.id === contactId)) {
      setModList((current) => [
        ...current,
        { id: contactId, name: signer, signed: true },
      ]);
    }
    return true;
  }

  async function saveTech() {
    const result = await run(async () => {
      const formData = new FormData();
      formData.set("jobId", jobId);
      formData.set("kind", "TECH");
      formData.set("signerName", techName);
      if (techInk) formData.set("image", techInk);
      else {
        formData.set("skipped", "true");
        formData.set("skippedReason", "No signature captured");
      }
      return saveSignature(null, formData);
    });

    if (!result?.ok) {
      setError(result?.error ?? "Could not save the signature.");
      return false;
    }
    setTechDone(true);
    return true;
  }

  async function finish(at?: Date) {
    const result = await run(async () => {
      const formData = new FormData();
      formData.set("jobId", jobId);
      formData.set("outcome", outcome);
      formData.set("releaseCode", noReleaseCode ? "" : releaseCode);
      formData.set("noReleaseCode", String(noReleaseCode));
      if (at) formData.set("at", at.toISOString());
      return completeCheckout(null, formData);
    });

    if (!result?.ok) {
      setError(result?.error ?? "Could not complete checkout.");
      return;
    }
    onClose();
  }

  return (
    <Card className="border-primary/50">
      <CardHeader>
        <CardTitle>
          {mode === "prepare" ? "Prepare checkout" : "Checkout"}
        </CardTitle>
        <CardDescription>
          Step {index + 1} of {steps.length}
          {mode === "prepare"
            ? " · nothing is clocked out; collect signatures now and leave when you're ready"
            : null}
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {error ? <p className="text-sm text-danger">{error}</p> : null}

        {step === "review" ? (
          <div className="flex flex-col gap-3">
            {missingRequired.length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-success">
                <CircleCheck className="size-4" />
                Everything required is in place.
              </p>
            ) : (
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
                    : "You can carry on through the steps, but a manager has to approve closing without these."}
                </p>
              </div>
            )}
          </div>
        ) : null}

        {step === "outcome" ? (
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              How did the job end?
            </span>
            {(Object.keys(OUTCOME_META) as JobOutcome[]).map((option) => (
              <Button
                key={option}
                type="button"
                variant={outcome === option ? "primary" : "secondary"}
                size="lg"
                block
                onClick={() => setOutcome(option)}
              >
                {OUTCOME_META[option].label}
              </Button>
            ))}
            <p className="text-xs text-muted-foreground">
              Internal statuses like Revisit required are set afterwards by a
              supervisor and never leave the company.
            </p>
          </div>
        ) : null}

        {step === "release" ? (
          <div className="flex flex-col gap-3">
            <Field
              label="Release code"
              htmlFor="release-code"
              hint="Given by the MOD or the NOC when the site is released."
            >
              <Input
                id="release-code"
                value={releaseCode}
                disabled={noReleaseCode}
                onChange={(event) => setReleaseCode(event.target.value)}
                autoComplete="off"
              />
            </Field>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={noReleaseCode}
                onChange={(event) => setNoReleaseCode(event.target.checked)}
                className="size-5 accent-[var(--color-primary)]"
              />
              No release code for this job
            </label>
          </div>
        ) : null}

        {step === "mod" ? (
          <div className="flex flex-col gap-3">
            {modDone ? (
              <p className="flex items-center gap-2 text-sm text-success">
                <Check className="size-4" /> MOD signature already captured.
              </p>
            ) : null}

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={noMod}
                onChange={(event) => setNoMod(event.target.checked)}
                className="size-5 accent-[var(--color-primary)]"
              />
              There is no MOD on this site
            </label>

            {!noMod ? (
              <>
                {modList.length > 0 ? (
                  <Field
                    label="Who is signing?"
                    htmlFor="mod-picker"
                    hint="A site can have several managers on duty; pick the one in front of you."
                  >
                    <Select
                      id="mod-picker"
                      value={modId}
                      onChange={(event) => setModId(event.target.value)}
                    >
                      {modList.map((mod) => (
                        <option key={mod.id} value={mod.id}>
                          {mod.name}
                          {mod.signed ? " (signed)" : ""}
                        </option>
                      ))}
                      <option value="">Someone else…</option>
                    </Select>
                  </Field>
                ) : null}

                {(!modId || modList.length === 0) && (
                  <Field label="MOD name" htmlFor="mod-name">
                    <Input
                      id="mod-name"
                      value={modName}
                      onChange={(event) => setModName(event.target.value)}
                      autoComplete="off"
                    />
                  </Field>
                )}

                <SignaturePad onChange={setModInk} disabled={pending} />
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                The report will read “No MOD”.
              </p>
            )}
          </div>
        ) : null}

        {step === "tech" ? (
          <div className="flex flex-col gap-3">
            {techDone ? (
              <p className="flex items-center gap-2 text-sm text-success">
                <Check className="size-4" /> Your signature is already captured.
              </p>
            ) : null}
            <span className="text-sm">
              Signing as <strong>{techName}</strong>
            </span>
            <SignaturePad onChange={setTechInk} disabled={pending} />
          </div>
        ) : null}

        {step === "confirm" ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-2 rounded-lg border border-border p-3 text-sm">
              <Row label="Outcome">
                {outcome ? (
                  <Badge variant={OUTCOME_META[outcome].variant}>
                    {OUTCOME_META[outcome].label}
                  </Badge>
                ) : (
                  <span className="text-warning">Not set</span>
                )}
              </Row>
              <Row label="Release code">
                {noReleaseCode ? "None" : releaseCode || "—"}
              </Row>
              <Row label="MOD signature">
                {noMod ? "No MOD" : modDone ? "Captured" : "Not captured"}
              </Row>
              <Row label="Your signature">
                {techDone ? "Captured" : "Not captured"}
              </Row>
              {missingRequired.length > 0 ? (
                <Row label="Missing">
                  <span className="text-warning">
                    {missingRequired.join(", ")}
                  </span>
                </Row>
              ) : null}
            </div>

            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Clock out
            </span>

            <Button
              type="button"
              size="lg"
              block
              disabled={pending || !outcome}
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
              onCancel={onClose}
            />
          </div>
        ) : null}

        <div className="flex items-center gap-2 border-t border-border pt-3">
          {index > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={back}
              disabled={pending}
            >
              <ArrowLeft /> Back
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClose}
              disabled={pending}
            >
              Cancel
            </Button>
          )}

          {step !== "confirm" ? (
            <Button
              type="button"
              size="sm"
              className="ml-auto"
              disabled={
                pending ||
                (step === "outcome" && !outcome) ||
                (step === "release" && !noReleaseCode && !releaseCode.trim())
              }
              onClick={async () => {
                if (step === "mod" && !noMod && !modDone) {
                  if (!(await saveMod())) return;
                } else if (step === "tech" && !techDone) {
                  if (!(await saveTech())) return;
                }

                if (mode === "prepare" && step === "tech") {
                  onClose();
                  return;
                }
                next();
              }}
            >
              {pending ? <Loader2 className="animate-spin" /> : null}
              {mode === "prepare" && step === "tech" ? "Done" : "Continue"}
              {mode === "prepare" && step === "tech" ? null : <ArrowRight />}
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
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
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}
