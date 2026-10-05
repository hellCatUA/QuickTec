"use client";

import { ChevronDown, ChevronUp, Plus } from "lucide-react";
import * as React from "react";
import { IconPicker } from "@/components/icon-picker";
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
import { MAX_LOCATION_NAME } from "@/lib/deliverables";
import { DEFAULT_LOCATION_ICON, searchIcons } from "@/lib/location-icons";
import {
  addKnownLocation,
  moveKnownLocation,
  renameKnownLocation,
  retireKnownLocation,
  setKnownLocationIcon,
} from "../actions";

export type KnownLocationRow = { id: string; label: string; icon: string | null };

/** The icon a new name suggests, until somebody picks one themselves. */
function guessIcon(label: string): string {
  return searchIcons(label)[0]?.key ?? DEFAULT_LOCATION_ICON;
}

/**
 * The places on site offered while somebody adds a location to a job.
 *
 * Suggestions, as the contact positions are: a tech can still type a room
 * that is not here, and a job keeps the name and icon it was given — so a
 * rename or a new icon here changes what is offered from now on and rewrites
 * nothing.
 *
 * The order is the order they are offered in, and the three or four on most
 * jobs belong at the top.
 */
export function KnownLocations({ locations }: { locations: KnownLocationRow[] }) {
  const [adding, setAdding] = React.useState("");
  const [addingIcon, setAddingIcon] = React.useState<string | null>(null);
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

  const newIcon = addingIcon ?? guessIcon(adding);

  function add() {
    run(async () => {
      const formData = new FormData();
      formData.set("label", adding);
      formData.set("icon", newIcon);
      const result = await addKnownLocation(formData);
      if (result.ok) {
        setAdding("");
        setAddingIcon(null);
      }
      return result;
    });
  }

  function move(id: string, direction: "up" | "down") {
    run(async () => {
      const formData = new FormData();
      formData.set("id", id);
      formData.set("direction", direction);
      return moveKnownLocation(formData);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Locations</CardTitle>
        <CardDescription>
          Offered when somebody adds a location to a job — the rooms a section
          is photographed in, each with its icon. Anything not on the list can
          still be typed on the job.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-2">
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}

        {locations.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing on the list. Techs will name every location by hand.
          </p>
        ) : null}

        {locations.map((location, index) =>
          editing === location.id ? (
            <div
              key={location.id}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-raised p-2"
            >
              <Input
                value={draft}
                autoFocus
                maxLength={MAX_LOCATION_NAME}
                aria-label={`New name for ${location.label}`}
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
                    formData.set("id", location.id);
                    formData.set("label", draft);
                    const result = await renameKnownLocation(formData);
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
              key={location.id}
              data-location={location.label}
              className="flex items-center gap-2 rounded-lg border border-border p-1.5"
            >
              <IconPicker
                value={location.icon}
                label={location.label}
                disabled={pending}
                onChange={(icon) =>
                  run(async () => {
                    const formData = new FormData();
                    formData.set("id", location.id);
                    formData.set("icon", icon);
                    return setKnownLocationIcon(formData);
                  })
                }
              />

              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {location.label}
              </span>

              <button
                type="button"
                aria-label={`Move ${location.label} up`}
                disabled={pending || index === 0}
                onClick={() => move(location.id, "up")}
                className="flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
              >
                <ChevronUp className="size-4" />
              </button>
              <button
                type="button"
                aria-label={`Move ${location.label} down`}
                disabled={pending || index === locations.length - 1}
                onClick={() => move(location.id, "down")}
                className="flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
              >
                <ChevronDown className="size-4" />
              </button>

              <RowMenu
                label={`Options for ${location.label}`}
                disabled={pending}
                items={[
                  {
                    label: "Rename",
                    onSelect: () => {
                      setError(null);
                      setDraft(location.label);
                      setEditing(location.id);
                    },
                  },
                  {
                    label: "Take off the list",
                    tone: "danger",
                    confirm: `Stop offering “${location.label}”? Jobs that already have it keep it.`,
                    onSelect: () =>
                      run(async () => {
                        const formData = new FormData();
                        formData.set("id", location.id);
                        return retireKnownLocation(formData);
                      }),
                  },
                ]}
              />
            </div>
          ),
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <IconPicker
            value={newIcon}
            label="the new location"
            disabled={pending}
            onChange={setAddingIcon}
          />
          <Input
            value={adding}
            maxLength={MAX_LOCATION_NAME}
            placeholder="Generator room"
            aria-label="A location to add"
            className="min-w-40 flex-1"
            onChange={(event) => setAdding(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && adding.trim()) {
                event.preventDefault();
                add();
              }
            }}
          />
          <Button
            type="button"
            variant="secondary"
            disabled={pending || !adding.trim()}
            onClick={add}
          >
            <Plus /> Add
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
