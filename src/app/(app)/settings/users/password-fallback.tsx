"use client";

import { Copy, KeyRound, Loader2, ShieldOff, WifiOff } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  grantPasswordFallback,
  resetOutsidePassword,
  revokePasswordFallback,
  type LinkResult,
} from "../actions";

/**
 * A way into a NextCloud account when NextCloud cannot be reached.
 *
 * Every part of OIDC is a domain name — the issuer, the discovery document,
 * the redirect URI — so a site cut off from the network has no way in at all,
 * and the people it strands are the ones standing at a customer's door. This
 * grants a second way to prove who they are, without touching the first: SSO
 * goes on working, and their role goes on being read from their groups.
 *
 * Off for everybody until somebody turns it on, one person at a time. A second
 * door into an account is worth having only where somebody decided it was —
 * which is also why the password is chosen by its owner through a one-time
 * link rather than typed here by whoever is granting it.
 */
export function PasswordFallback({
  userId,
  granted,
  hasPassword,
}: {
  userId: string;
  granted: boolean;
  /** Granted and chosen, as against granted and still to be set. */
  hasPassword: boolean;
}) {
  const [result, setResult] = React.useState<LinkResult | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  function run(action: (formData: FormData) => Promise<LinkResult>) {
    setCopied(false);
    setConfirming(false);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("userId", userId);
      setResult(await action(formData));
    });
  }

  if (result?.ok && result.link) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-raised p-2">
        <p className="text-xs text-muted-foreground">
          Send them this. It works once, expires in three days, and cannot be
          shown again. Until they use it the account has no password — only SSO.
        </p>
        <code className="break-all text-xs">{result.link}</code>
        <Button
          type="button"
          size="sm"
          className="self-start"
          onClick={() => {
            void navigator.clipboard.writeText(result.link!);
            setCopied(true);
          }}
        >
          <Copy /> {copied ? "Copied" : "Copy link"}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface-raised p-2">
      {result && !result.ok ? (
        <p className="text-xs text-danger">{result.error}</p>
      ) : null}

      {granted ? (
        <>
          <p className="text-xs">
            <span className="font-medium text-warning">
              Can also sign in with a QuickTec password.
            </span>{" "}
            {hasPassword
              ? "They have chosen one."
              : "They have not chosen one yet, so the link below is the only way to set it."}
          </p>

          {confirming ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs">
                Remove it? Their password stops working now, and so does any
                session opened with it.
              </span>
              <Button
                type="button"
                size="sm"
                variant="danger"
                disabled={pending}
                onClick={() => run(revokePasswordFallback)}
              >
                {pending ? <Loader2 className="animate-spin" /> : null}
                Remove
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => setConfirming(false)}
              >
                Keep
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={pending}
                onClick={() => run(resetOutsidePassword)}
              >
                {pending ? <Loader2 className="animate-spin" /> : <KeyRound />}
                Issue a new link
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => setConfirming(true)}
              >
                <ShieldOff /> Remove the password
              </Button>
            </div>
          )}
        </>
      ) : (
        <>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="self-start"
            disabled={pending}
            onClick={() => run(grantPasswordFallback)}
          >
            {pending ? <Loader2 className="animate-spin" /> : <WifiOff />}
            Allow a QuickTec password too
          </Button>
          <p className="text-xs text-muted-foreground">
            For working when NextCloud cannot be reached. SSO keeps working, and
            their role still comes from their NextCloud groups.
          </p>
        </>
      )}
    </div>
  );
}
