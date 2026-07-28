"use client";

import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export type SaveState = { ok: true; id?: string } | { ok: false; error: string } | null;

/**
 * The save row every record form ends with. Kept in one place so a failed save
 * always looks the same — a tech in the field should never have to wonder
 * whether something was written.
 */
export function FormStatus({
  state,
  pending,
  label = "Save",
  size = "sm",
}: {
  state: SaveState;
  pending: boolean;
  label?: string;
  size?: "sm" | "md" | "lg";
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="submit" size={size} disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : null}
        {label}
      </Button>

      {state?.ok ? (
        <span className="flex items-center gap-1 text-xs text-success">
          <Check className="size-3.5" /> Saved
        </span>
      ) : null}

      {state && !state.ok ? (
        <span className="text-xs text-danger">{state.error}</span>
      ) : null}
    </div>
  );
}
