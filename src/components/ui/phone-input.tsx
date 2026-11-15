"use client";

import * as React from "react";
import { Input } from "@/components/ui/field";
import { caretAfterDigits, formatPhoneAsTyped, phoneDigits } from "@/lib/phone";

/**
 * A phone number that writes its own dashes, as it is typed.
 *
 * Every phone field in the app is this one, so they all behave alike: a number
 * typed as 2065550177 and one typed as (206) 555-0177 are the same number, and
 * only one of them reads as one.
 *
 * Because the dashes now move with every digit, the field keeps the caret
 * after the digit it was after — a controlled input otherwise throws it to the
 * end on each change, which made a typo in the middle impossible to fix in
 * place — and Backspace on a dash takes the digit before it, since the dash
 * alone would only come straight back.
 *
 * Either left to itself (`defaultValue`, posted with its form by `name`) or
 * held by its parent (`value` and `onValueChange`).
 */
export function PhoneInput({
  name,
  defaultValue,
  value: held,
  onValueChange,
  id,
  ...props
}: Omit<React.ComponentProps<"input">, "value" | "onChange" | "defaultValue"> & {
  name?: string;
  /** Null is what the database hands back for "no number on file". */
  defaultValue?: string | null;
  value?: string;
  onValueChange?: (value: string) => void;
}) {
  const [own, setOwn] = React.useState(() =>
    formatPhoneAsTyped(defaultValue ?? ""),
  );
  const value = held ?? own;
  const ref = React.useRef<HTMLInputElement>(null);
  const caret = React.useRef<number | null>(null);

  React.useLayoutEffect(() => {
    const input = ref.current;
    if (caret.current === null || !input || document.activeElement !== input) return;
    input.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  });

  function onChange(event: React.ChangeEvent<HTMLInputElement>) {
    let typed = event.target.value;
    let at = event.target.selectionStart ?? typed.length;

    const removedOnlyADash =
      (event.nativeEvent as InputEvent).inputType === "deleteContentBackward" &&
      typed.length < value.length &&
      phoneDigits(typed) === phoneDigits(value);
    if (removedOnlyADash) {
      let index = at - 1;
      while (index >= 0 && !/\d/.test(typed[index])) index--;
      if (index >= 0) {
        typed = typed.slice(0, index) + typed.slice(index + 1);
        at = index;
      }
    }

    const next = formatPhoneAsTyped(typed);
    caret.current =
      next === typed ? at : caretAfterDigits(next, phoneDigits(typed.slice(0, at)).length);
    if (held === undefined) setOwn(next);
    onValueChange?.(next);
  }

  return (
    <Input
      type="tel"
      inputMode="tel"
      autoComplete="tel"
      {...props}
      ref={ref}
      id={id}
      name={name}
      value={value}
      onChange={onChange}
    />
  );
}
