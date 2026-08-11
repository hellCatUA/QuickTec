"use client";

import { CircleCheck, Loader2 } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { MIN_PASSWORD_LENGTH } from "@/lib/password-rules";
import { changeOwnPassword } from "./actions";
import { setPasswordWithToken } from "../signin/actions";

export function SetPasswordForm({ token }: { token: string | null }) {
  const [current, setCurrent] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    startTransition(async () => {
      const formData = new FormData();
      formData.set("password", password);
      formData.set("confirm", confirm);

      if (token) {
        formData.set("token", token);
        const result = await setPasswordWithToken(formData);
        if (!result.ok) return setError(result.error);
        setDone(true);
        return;
      }

      formData.set("current", current);
      const result = await changeOwnPassword(formData);
      if (!result.ok) return setError(result.error);
      // Their own session is already good; the app is what they wanted.
      window.location.assign("/dashboard");
    });
  }

  if (done) {
    return (
      <div className="flex flex-col gap-3">
        <p className="flex items-center gap-2 text-sm text-success">
          <CircleCheck className="size-4" /> Password set.
        </p>
        <Link
          href="/signin?method=password"
          className="flex min-h-11 w-full items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
        >
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      {error ? <p className="text-sm text-danger">{error}</p> : null}

      {token ? null : (
        <Field label="Current password" htmlFor="current-password">
          <Input
            id="current-password"
            type="password"
            autoComplete="current-password"
            required
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
          />
        </Field>
      )}

      <Field
        label="New password"
        htmlFor="new-password"
        hint={`At least ${MIN_PASSWORD_LENGTH} characters. Four words you will remember beat one word with a digit on the end.`}
      >
        <Input
          id="new-password"
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </Field>

      <Field label="Again" htmlFor="confirm-password">
        <Input
          id="confirm-password"
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
        />
      </Field>

      <Button type="submit" size="lg" block disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : null}
        Set password
      </Button>
    </form>
  );
}
