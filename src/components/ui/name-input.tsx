"use client";

import * as React from "react";
import { Input } from "@/components/ui/field";
import { capitaliseName } from "@/lib/names";

/**
 * A person's name, capitalised as it is typed.
 *
 * Same shape as PhoneInput beside it, and for the same reason: the tidying has
 * to happen on screen rather than on save, so what somebody reads back is what
 * will be stored. A name corrected quietly after they look away is a name they
 * never agreed to.
 *
 * Holds the value itself so it works in a form that posts by `name=` as well
 * as inside one that keeps its own state — every caller of this is one or the
 * other, and neither should have to care.
 */
export function NameInput({
  name,
  defaultValue,
  id,
  ...props
}: Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "defaultValue"
> & {
  name?: string;
  /** Null is what the database hands back for "nobody recorded". */
  defaultValue?: string | null;
}) {
  const [value, setValue] = React.useState(() =>
    capitaliseName(defaultValue ?? ""),
  );

  return (
    <Input
      {...props}
      id={id}
      name={name}
      // Off: a browser offering the account holder's own name is no help when
      // the field is for whoever is standing at the desk.
      autoComplete="off"
      autoCapitalize="words"
      value={value}
      onChange={(event) => setValue(capitaliseName(event.target.value))}
    />
  );
}
