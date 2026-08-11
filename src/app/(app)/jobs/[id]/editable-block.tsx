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
 *
 * The pencil belongs in the card's own corner, beside the title, where every
 * other block on this page keeps its controls. That is a different part of the
 * tree from the fields it governs, so the two talk through this context rather
 * than by the button sitting immediately above them.
 */
const BlockEditing = React.createContext<{
  editing: boolean;
  toggle: () => void;
  canEdit: boolean;
  label: string;
} | null>(null);

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

  const value = React.useMemo(
    () => ({
      editing,
      canEdit,
      label,
      toggle: () => setEditing((was) => !was),
    }),
    [editing, canEdit, label],
  );

  return (
    <BlockEditing.Provider value={value}>{children}</BlockEditing.Provider>
  );
}

/** The corner pencil. Put it in the CardHeader, beside the title. */
export function BlockEditToggle() {
  const block = React.useContext(BlockEditing);
  if (!block || !block.canEdit) return null;

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="-my-1 shrink-0"
      aria-label={
        block.editing ? `Done editing ${block.label}` : `Edit ${block.label}`
      }
      aria-pressed={block.editing}
      title={block.editing ? "Done" : "Edit"}
      onClick={block.toggle}
    >
      {block.editing ? <Check /> : <Pencil />}
    </Button>
  );
}

/** The fields the pencil governs. */
export function BlockBody({ children }: { children: React.ReactNode }) {
  const block = React.useContext(BlockEditing);
  const on = Boolean(block?.canEdit && block.editing);

  return <div data-block-editing={on ? "on" : "off"}>{children}</div>;
}
