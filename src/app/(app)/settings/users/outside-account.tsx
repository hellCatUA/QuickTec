"use client";

import { Copy, Loader2, UserPlus } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { createOutsideUser, type LinkResult } from "../actions";

const ROLES = ["TECH", "SUPERVISOR", "MANAGER", "ACCOUNTANT", "ADMINISTRATOR"];

const TIME_ZONES = [
  "America/Los_Angeles",
  "America/Phoenix",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "UTC",
];

/**
 * Adding somebody who does not work here.
 *
 * Two ways to hand over the first password, because both happen: a link they
 * open themselves, which nobody else ever sees, or a password read out on a
 * call when the person is not going to manage a link. The second is marked as
 * needing changing at first sign-in, since somebody else already knows it.
 */
export function OutsideAccount() {
  const [open, setOpen] = React.useState(false);
  const [mode, setMode] = React.useState<"link" | "password">("link");
  const [result, setResult] = React.useState<LinkResult | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    if (mode === "link") formData.delete("password");

    startTransition(async () => {
      const answer = await createOutsideUser(null, formData);
      setResult(answer);
      setCopied(false);
      if (answer.ok && !answer.link) setOpen(false);
    });
  }

  if (!open) {
    return (
      <Button
        type="button"
        variant="secondary"
        className="self-start"
        onClick={() => {
          setResult(null);
          setOpen(true);
        }}
      >
        <UserPlus /> Add an outside account
      </Button>
    );
  }

  // Shown once and never again: the token is stored hashed, so there is no
  // way back to this string afterwards.
  if (result?.ok && result.link) {
    return (
      <Card>
        <CardContent className="flex flex-col gap-3">
          <div>
            <h2 className="text-base font-semibold">Send them this link</h2>
            <p className="text-sm text-muted-foreground">
              It works once, expires in three days, and is not stored anywhere
              you can read it again. Copy it now.
            </p>
          </div>

          <code className="break-all rounded-lg border border-border bg-surface-raised p-2 text-xs">
            {result.link}
          </code>

          <div className="flex gap-2">
            <Button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(result.link!);
                setCopied(true);
              }}
            >
              <Copy /> {copied ? "Copied" : "Copy link"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setResult(null);
                setOpen(false);
              }}
            >
              Done
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div>
            <h2 className="text-base font-semibold">Outside account</h2>
            <p className="text-sm text-muted-foreground">
              For somebody with no NextCloud account. Their role is set here,
              because there is no group to read it from — start at Tech unless
              there is a reason not to.
            </p>
          </div>

          {result && !result.ok ? (
            <p className="text-sm text-danger">{result.error}</p>
          ) : null}

          <Field label="Name" htmlFor="outside-name">
            <Input id="outside-name" name="name" required autoComplete="off" />
          </Field>

          <Field label="Email" htmlFor="outside-email">
            <Input
              id="outside-email"
              name="email"
              type="email"
              required
              autoComplete="off"
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Role" htmlFor="outside-role">
              <Select id="outside-role" name="baseRole" defaultValue="TECH">
                {ROLES.map((role) => (
                  <option key={role} value={role}>
                    {role.charAt(0) + role.slice(1).toLowerCase()}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Time zone" htmlFor="outside-tz">
              <Select
                id="outside-tz"
                name="timeZone"
                defaultValue="America/Los_Angeles"
              >
                {TIME_ZONES.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              First password
            </legend>

            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="mode"
                checked={mode === "link"}
                onChange={() => setMode("link")}
                className="mt-0.5 size-4 accent-[var(--color-primary)]"
              />
              <span>
                Send them a one-time link
                <span className="block text-xs text-muted-foreground">
                  They choose it themselves and you never see it.
                </span>
              </span>
            </label>

            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="mode"
                checked={mode === "password"}
                onChange={() => setMode("password")}
                className="mt-0.5 size-4 accent-[var(--color-primary)]"
              />
              <span>
                Set one now and tell them
                <span className="block text-xs text-muted-foreground">
                  They are made to change it the first time they sign in.
                </span>
              </span>
            </label>
          </fieldset>

          {mode === "password" ? (
            <Field label="Password" htmlFor="outside-password">
              <Input
                id="outside-password"
                name="password"
                type="text"
                autoComplete="off"
              />
            </Field>
          ) : null}

          <div className="flex gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : null}
              Create account
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
