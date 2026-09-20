"use client";

import * as React from "react";
import { Combobox } from "@/components/ui/combobox";

/**
 * What the person in front of you does at this site.
 *
 * The dictionary is there to save typing, not to constrain: the value stored
 * is the text itself, so a position that is not on the list is typed and kept,
 * and renaming an entry in settings never rewrites a job that already used the
 * old words.
 *
 * Anything typed and not matched is folded into the options, which is what
 * makes it show in the closed state — a picker that goes blank after somebody
 * types into it reads as having lost what they typed.
 */
export function PositionPicker({
  id,
  name,
  value,
  onChange,
  dictionary,
  disabled,
}: {
  id?: string;
  name?: string;
  value: string;
  onChange: (next: string) => void;
  /** The configured list, in the order settings puts it. */
  dictionary: string[];
  disabled?: boolean;
}) {
  const options = React.useMemo(() => {
    const known = dictionary.map((label) => ({ value: label, label }));
    const typed = value.trim();
    if (!typed || dictionary.includes(typed)) return known;
    return [{ value: typed, label: typed, hint: "Typed in" }, ...known];
  }, [dictionary, value]);

  return (
    <Combobox
      id={id}
      name={name}
      value={value}
      onChange={onChange}
      options={options}
      disabled={disabled}
      placeholder="Search or type a position…"
      emptyText="Nothing like that on the list — type it and use it anyway."
      onCreate={(query) => onChange(query)}
      createLabel={(query) => `Use “${query}”`}
    />
  );
}
