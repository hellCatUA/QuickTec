"use client";

import * as React from "react";
import { Combobox } from "@/components/ui/combobox";
import { US_STATES } from "@/lib/us-regions";

/**
 * Fifty-six options is exactly the size a native select is worst at: too many
 * to scroll on a phone wheel, and not searchable at all. Typing "wa" should be
 * enough, and either the code or the name should find it.
 */
const OPTIONS = US_STATES.map((state) => ({
  value: state.code,
  label: state.code,
  hint: state.name,
  keywords: state.name,
}));

export function StatePicker({
  name,
  value,
  onChange,
  id,
  disabled,
}: {
  name?: string;
  value: string;
  onChange: (value: string) => void;
  id?: string;
  disabled?: boolean;
}) {
  return (
    <Combobox
      id={id}
      name={name}
      value={value}
      onChange={onChange}
      options={OPTIONS}
      placeholder="State"
      emptyText="No state by that name."
      disabled={disabled}
    />
  );
}

/** The same, for a form that only submits and never reads back. */
export function StateField({
  name,
  defaultValue,
  id,
  disabled,
  onChange,
}: {
  name: string;
  defaultValue?: string | null;
  id?: string;
  disabled?: boolean;
  onChange?: (value: string) => void;
}) {
  const [value, setValue] = React.useState(
    (defaultValue ?? "").trim().toUpperCase(),
  );

  return (
    <StatePicker
      id={id}
      name={name}
      value={value}
      disabled={disabled}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}
