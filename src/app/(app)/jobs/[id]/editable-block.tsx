"use client";

import { Check, Pencil } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";

/**
 * A block whose editing controls stay out of the way until they are wanted.
 *
 * On a phone this page is a long scroll, and a pencil beside every one of
 * fifteen fields is most of what made it feel heavy. One pencil in the corner
 * reveals the lot.
 *
 * What it hides is only the pencils on fields that already hold a value.
 * Blank ones keep their plus whatever this is set to: filling a gap is open to
 * anyone on the job, it is the commonest thing a tech does here, and burying
 * it behind a second tap would be the wrong saving. The children decide which
 * they are — see data-edit-trigger in EditableField.
 */
export function EditableBlock({
  label,
  canEdit,
  children,
}: {
  /** Named for a screen reader: several of these sit on one page. */
  label: string;
  canEdit: boolean;
  children: React.ReactNode;
}) {
  const [editing, setEditing] = React.useState(false);

  return (
    <>
      {canEdit ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={editing ? `Done editing ${label}` : `Edit ${label}`}
          aria-pressed={editing}
          title={editing ? "Done" : "Edit"}
          onClick={() => setEditing((was) => !was)}
        >
          {editing ? <Check /> : <Pencil />}
        </Button>
      ) : null}

      <div data-block-editing={canEdit && editing ? "on" : "off"}>
        {children}
      </div>
    </>
  );
}
