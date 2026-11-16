"use client";

import * as React from "react";
import { Input } from "@/components/ui/field";
import {
  caretAfterDigits,
  formatPhone,
  formatPhoneAsTyped,
  phoneDigits,
  settlePhone,
} from "@/lib/phone";

/**
 * A phone number that writes its own dashes, as it is typed.
 *
 * Every phone field in the app is this one, so they all behave alike: a number
 * typed as 2065550177 and one typed as (206) 555-0177 are the same number, and
 * only one of them reads as one.
 *
 * Because the dashes move with every digit, the field keeps the caret after
 * the digit it was after — a controlled input otherwise throws it to the end
 * on each change, which made a typo in the middle impossible to fix in place —
 * and Backspace or Delete on a dash takes the digit beyond it, where the dash
 * alone would only come straight back.
 *
 * What it is given to start with is shown as stored, not as if typed: run
 * through the typing rules, a four-digit extension "2034" opened as "203-4",
 * and the form counted that as a change nobody made.
 *
 * Either left to itself (`defaultValue`, posted with its form by `name`) or
 * held by its parent (`value` and `onValueChange`).
 */
export function PhoneInput({
  name,
  defaultValue,
  value: held,
  onValueChange,
  onBlur,
  id,
  ...props
}: Omit<React.ComponentProps<"input">, "value" | "onChange" | "defaultValue"> & {
  name?: string;
  /** Null is what the database hands back for "no number on file". */
  defaultValue?: string | null;
  value?: string;
  onValueChange?: (value: string) => void;
}) {
  const [own, setOwn] = React.useState(() => {
    const stored = defaultValue ?? "";
    return formatPhone(stored) || stored;
  });
  const value = held ?? own;
  const ref = React.useRef<HTMLInputElement>(null);
  const caret = React.useRef<number | null>(null);

  React.useLayoutEffect(() => {
    const input = ref.current;
    if (caret.current === null || !input || document.activeElement !== input) return;
    input.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  });

  function commit(next: string) {
    if (held === undefined) setOwn(next);
    onValueChange?.(next);
  }

  function onChange(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.target;
    let typed = input.value;
    let at = input.selectionStart ?? typed.length;
    const inputType = (event.nativeEvent as InputEvent).inputType;

    // Only a dash went, and formatting would put it straight back: take the
    // digit beyond it instead, the way the key was meant.
    const onlyADash =
      typed.length === value.length - 1 &&
      phoneDigits(typed) === phoneDigits(value) &&
      formatPhoneAsTyped(typed) === value;
    if (onlyADash && inputType === "deleteContentBackward") {
      let index = at - 1;
      while (index >= 0 && !/\d/.test(typed[index])) index--;
      if (index >= 0) {
        typed = typed.slice(0, index) + typed.slice(index + 1);
        at = index;
      }
    } else if (onlyADash && inputType === "deleteContentForward") {
      let index = at;
      while (index < typed.length && !/\d/.test(typed[index])) index++;
      if (index < typed.length) typed = typed.slice(0, index) + typed.slice(index + 1);
    }

    const next = formatPhoneAsTyped(typed);
    const place =
      next === typed ? at : caretAfterDigits(next, phoneDigits(typed.slice(0, at)).length);

    if (next === value) {
      // Nothing changes, so nothing re-renders and the layout effect never
      // runs: React puts the old value back and the caret at the end. Put it
      // where it belongs once React has done that.
      caret.current = null;
      requestAnimationFrame(() => {
        if (document.activeElement === input) input.setSelectionRange(place, place);
      });
      return;
    }

    caret.current = place;
    commit(next);
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
      onBlur={(event) => {
        const settled = settlePhone(value);
        if (settled !== value) commit(settled);
        onBlur?.(event);
      }}
    />
  );
}
