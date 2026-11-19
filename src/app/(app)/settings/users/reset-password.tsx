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
 * this person. The existing password stops working the moment the link is
 * issued rather than when it is used — an account being reset is one
 * somebody else may already hold the password to.
 *
 * Both buttons used to act on the first tap. Issuing a link cut off a
 * password the person was using that minute, and "They have SSO now" handed
 * the account to NextCloud for good — nothing on any screen makes an account
 * an outside one again — so each now says what it will do and asks.
 */
export function ResetPassword({
  userId,
  email,
  hasPassword,
  keys,
}: {
  userId: string;
  email: string;
  /** They chose a password, as against invited and not yet signed in. */
  hasPassword: boolean;
  /** The viewer may give this account a password or hand it over. */
  keys: boolean;
}) {
  const [result, setResult] = React.useState<LinkResult | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [confirming, setConfirming] = React.useState<"link" | "sso" | null>(null);
  const [pending, startTransition] = React.useTransition();

  function run(action: (formData: FormData) => Promise<LinkResult>) {
    setCopied(false);
    setConfirming(null);
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

  // Said rather than offered and refused: the server answers anybody who
  // cannot manage roles with a paragraph saying no.
  if (!keys) {
    return (
      <p className="rounded-lg border border-border bg-surface-raised p-2 text-xs text-muted-foreground">
        Signs in with a QuickTec password. Only somebody who manages roles can issue
        this account a new one or hand it to NextCloud.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-raised p-2">
      {result && !result.ok ? (
        <p className="text-sm text-danger" role="alert">
          {result.error}
        </p>
      ) : null}

      {confirming === "link" ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm">
            {hasPassword
              ? "Their current password stops working now, and so does any session opened with it. They choose a new one through the link."
              : "Any link issued before stops working. They choose a password through the new one."}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={pending} onClick={() => run(resetOutsidePassword)}>
              {pending ? <Loader2 className="animate-spin" /> : <KeyRound />}
              Issue the link
            </Button>
            <Button type="button" variant="ghost" disabled={pending} onClick={() => setConfirming(null)}>
              Keep it as it is
            </Button>
          </div>
        </div>
      ) : confirming === "sso" ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm">
            {email} becomes a NextCloud account, and the password held here is dropped.
            Whoever signs in to NextCloud with that email gets this account, and it
            cannot be made an outside account again.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="danger" disabled={pending} onClick={() => run(switchToSso)}>
              {pending ? <Loader2 className="animate-spin" /> : <Building2 />}
              Hand it to NextCloud
            </Button>
            <Button type="button" variant="ghost" disabled={pending} onClick={() => setConfirming(null)}>
              Keep it as it is
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() => setConfirming("link")}
            >
              {pending ? <Loader2 className="animate-spin" /> : <KeyRound />}
              Issue a password link
            </Button>

            {/* They joined the company. Without this the refusal on their first
                SSO sign-in named an action nobody could take. */}
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={() => setConfirming("sso")}
            >
              <Building2 /> They have SSO now
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Switching hands {email} to NextCloud and drops the password held here.
          </p>
        </>
      )}
    </div>
  );
}
