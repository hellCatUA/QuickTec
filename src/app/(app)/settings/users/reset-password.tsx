"use client";

import { Building2, Copy, KeyRound, Loader2 } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  resetOutsidePassword,
  switchToSso,
  type LinkResult,
} from "../actions";

/**
 * A fresh link for an account somebody has locked themselves out of.
 *
 * There is no mail server here, so this is the whole of "forgot password": the
 * administrator issues a link and passes it on however they already talk to
 * this person. The existing password stops working the moment the button is
 * pressed rather than when the link is used — an account being reset is one
 * somebody else may already hold the password to.
 */
export function ResetPassword({
  userId,
  email,
}: {
  userId: string;
  email: string;
}) {
  const [result, setResult] = React.useState<LinkResult | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  function run(action: (formData: FormData) => Promise<LinkResult>) {
    setCopied(false);
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
          Works once, expires in three days, and cannot be shown again.
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
    <div className="flex flex-col gap-1">
      {result && !result.ok ? (
        <p className="text-xs text-danger">{result.error}</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={pending}
          onClick={() => run(resetOutsidePassword)}
        >
          {pending ? <Loader2 className="animate-spin" /> : <KeyRound />}
          Issue a password link
        </Button>

        {/* They joined the company. Without this the refusal on their first
            SSO sign-in named an action nobody could take. */}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => run(switchToSso)}
        >
          <Building2 /> They have SSO now
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Switching hands {email} to NextCloud and drops the password held here.
      </p>
    </div>
  );
}
