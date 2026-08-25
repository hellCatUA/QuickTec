"use client";

import * as React from "react";
import { Input } from "@/components/ui/field";
import { formatPhoneAsTyped } from "@/lib/phone";

/**
 * A phone number that writes its own dashes.
 *
 * The same behaviour the job page's contacts have had for a while, pulled out
 * so every other phone field can have it too rather than each one deciding for
 * itself. A number typed as 2065550177 and a number typed as (206) 555-0177
 * are the same number, and only one of them reads as one.
 */
export function PhoneInput({
  name,
  defaultValue,
  id,
  ...props
}: Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "defaultValue"
> & {
  name?: string;
  /** Null is what the database hands back for "no number on file". */
  defaultValue?: string | null;
}) {
  const [value, setValue] = React.useState(() =>
    formatPhoneAsTyped(defaultValue ?? ""),
  );

  return (
    <Input
      {...props}
      id={id}
      name={name}
      type="tel"
      inputMode="tel"
      autoComplete="tel"
      value={value}
      onChange={(event) => setValue(formatPhoneAsTyped(event.target.value))}
    />
  );
}
