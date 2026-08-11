"use client";

import { Loader2, LogIn } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { signInWithPassword } from "./actions";

/**
 * The other way in.
 *
 * One message for every way of being turned away — wrong password, unknown
 * address, a company account typed in here, an account somebody deactivated.
 * Distinguishing them is precisely what makes an address list worth working
 * through, and the person actually holding the right password never sees any
 * of them.
 *
 * A locked account is the exception and says so, because the alternative is
 * somebody retyping a password they know is correct for fifteen minutes.
 */
export function PasswordSignIn({ callbackUrl }: { callbackUrl: string }) {
  const router = useRouter();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    startTransition(async () => {
      const formData = new FormData();
      formData.set("email", email);
      formData.set("password", password);
      formData.set("callbackUrl", callbackUrl);

      const result = await signInWithPassword(formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }

      // A full navigation rather than a client one: the session cookie was
      // just set, and every layout above needs to read it.
      window.location.assign(result.redirectTo);
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      {error ? <p className="text-sm text-danger">{error}</p> : null}

      <Field label="Email" htmlFor="signin-email">
        <Input
          id="signin-email"
          name="email"
          type="email"
          autoComplete="username"
          autoCapitalize="none"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </Field>

      <Field label="Password" htmlFor="signin-password">
        <Input
          id="signin-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </Field>

      <Button type="submit" size="lg" block disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : <LogIn />}
        Sign in
      </Button>

      <p className="text-center text-xs text-muted-foreground">
        Forgotten it? There is no mail server here to send you a link, so ask
        whoever set the account up — they can issue a new one in seconds.
      </p>
    </form>
  );
}
