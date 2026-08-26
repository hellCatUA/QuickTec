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
  error,
}: {
  action: PunchAction;
  companyName: string;
  code: string;
  note: string;
  onCode: (code: string) => void;
  onNote: (note: string) => void;
  idPrefix: string;
  /** What the server said about this field, shown under it. */
  error?: string | null;
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
        {/* Under the box it is about. At the top of the block it was six
            inches from the field it referred to, above somebody's name. */}
        {error ? (
          <p role="alert" data-reason-error className="mt-1.5 text-sm text-danger">
            {error}
          </p>
        ) : null}
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
