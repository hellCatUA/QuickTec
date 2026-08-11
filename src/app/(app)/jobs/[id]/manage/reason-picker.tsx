"use client";

import * as React from "react";
import { Combobox } from "@/components/ui/combobox";
import { Field, Input } from "@/components/ui/field";
import {
  noteRequired,
  reasonLabel,
  reasonsFor,
  type PunchAction,
} from "@/lib/punch-reasons";

/**
 * Why this punch is being touched.
 *
 * A search rather than a wheel because there are eighteen answers for a removal
 * and iOS shows a native select four at a time. The note appears when it is
 * needed and is required only then: Other is not an answer, it is a promise to
 * write one.
 */
export function ReasonPicker({
  action,
  companyName,
  code,
  note,
  onCode,
  onNote,
  idPrefix,
}: {
  action: PunchAction;
  companyName: string;
  code: string;
  note: string;
  onCode: (code: string) => void;
  onNote: (note: string) => void;
  idPrefix: string;
}) {
  const options = React.useMemo(
    () =>
      reasonsFor(action).map((entry) => ({
        value: entry.code,
        label: reasonLabel(entry, companyName),
        // Searchable by the stored code too, which is what anybody who has
        // read a timeline will type.
        keywords: entry.code,
      })),
    [action, companyName],
  );

  const mustNote = noteRequired(code);

  return (
    <>
      <Field label="Reason" htmlFor={`${idPrefix}-reason`}>
        <Combobox
          id={`${idPrefix}-reason`}
          value={code}
          onChange={onCode}
          options={options}
          placeholder="Search reasons…"
          emptyText="No reason matches that."
          allowClear={false}
        />
      </Field>

      {code ? (
        <Field
          label={mustNote ? "Note (required)" : "Note"}
          htmlFor={`${idPrefix}-note`}
          hint={
            mustNote
              ? "Other says none of the reasons fit, so this is the only record of what did."
              : undefined
          }
        >
          <Input
            id={`${idPrefix}-note`}
            value={note}
            onChange={(event) => onNote(event.target.value)}
            autoComplete="off"
          />
        </Field>
      ) : null}
    </>
  );
}
