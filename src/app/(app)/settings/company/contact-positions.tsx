"use client";

import { ChevronDown, ChevronUp, Plus } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { RowMenu } from "@/components/ui/row-menu";
import {
  addContactPosition,
  moveContactPosition,
  renameContactPosition,
  retireContactPosition,
} from "../actions";

export type Position = { id: string; label: string };

/**
 * The words offered while somebody types what a site contact does.
 *
 * Suggestions, not rules. A tech can type anything, and what a job stores is
 * the text they wrote — so renaming an entry here changes what is offered from
 * now on and rewrites no job, and taking one off the list leaves every job
 * that used it saying exactly what it said.
 *
 * Order matters more than it looks: this is a list somebody scans one-handed
 * at the end of a day, and the three or four that come up on most jobs belong
 * at the top.
 */
export function ContactPositions({ positions }: { positions: Position[] }) {
  const [adding, setAdding] = React.useState("");
  const [editing, setEditing] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function run(work: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await work();
      if (!result.ok) setError(result.error ?? "That did not save.");
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Contact positions</CardTitle>
        <CardDescription>
          Offered while somebody records who they spoke to on site. Anything not
          on the list can still be typed, and is kept as typed.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-2">
        {error ? <p className="text-sm text-danger">{error}</p> : null}

        {positions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing on the list. Techs will type every position by hand.
          </p>
        ) : null}

        {positions.map((position, index) =>
          editing === position.id ? (
            <div
              key={position.id}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-raised p-2"
            >
              <Input
                value={draft}
                autoFocus
                className="min-w-48 flex-1"
                onChange={(event) => setDraft(event.target.value)}
              />
              <Button
                type="button"
                size="sm"
                disabled={pending || !draft.trim()}
                onClick={() =>
                  run(async () => {
                    const formData = new FormData();
                    formData.set("id", position.id);
                    formData.set("label", draft);
                    const result = await renameContactPosition(null, formData);
                    if (result.ok) setEditing(null);
                    return result;
                  })
                }
              >
                Save
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setEditing(null)}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <div
              key={position.id}
              className="flex items-center gap-1 rounded-lg border border-border p-2"
            >
              <span className="min-w-0 flex-1 text-sm">{position.label}</span>

              <button
                type="button"
                aria-label={`Move ${position.label} up`}
                disabled={pending || index === 0}
                onClick={() =>
                  run(async () => {
                    const formData = new FormData();
                    formData.set("id", position.id);
                    formData.set("direction", "up");
                    return moveContactPosition(formData);
                  })
                }
                className="flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
              >
                <ChevronUp className="size-4" />
              </button>
              <button
                type="button"
                aria-label={`Move ${position.label} down`}
                disabled={pending || index === positions.length - 1}
                onClick={() =>
                  run(async () => {
                    const formData = new FormData();
                    formData.set("id", position.id);
                    formData.set("direction", "down");
                    return moveContactPosition(formData);
                  })
                }
                className="flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
              >
                <ChevronDown className="size-4" />
              </button>

              <RowMenu
                label={`Options for ${position.label}`}
                disabled={pending}
                items={[
                  {
                    label: "Rename",
                    onSelect: () => {
                      setError(null);
                      setDraft(position.label);
                      setEditing(position.id);
                    },
                  },
                  {
                    label: "Take off the list",
                    tone: "danger",
                    confirm: `Stop offering “${position.label}”? Jobs that already use it keep it.`,
                    onSelect: () =>
                      run(async () => {
                        const formData = new FormData();
                        formData.set("id", position.id);
                        return retireContactPosition(formData);
                      }),
                  },
                ]}
              />
            </div>
          ),
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Input
            value={adding}
            placeholder="Night Auditor"
            aria-label="A position to add"
            className="min-w-48 flex-1"
            onChange={(event) => setAdding(event.target.value)}
          />
          <Button
            type="button"
            variant="secondary"
            disabled={pending || !adding.trim()}
            onClick={() =>
              run(async () => {
                const formData = new FormData();
                formData.set("label", adding);
                const result = await addContactPosition(null, formData);
                if (result.ok) setAdding("");
                return result;
              })
            }
          >
            <Plus /> Add
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
