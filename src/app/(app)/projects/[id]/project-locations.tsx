"use client";

import { X } from "lucide-react";
import * as React from "react";
import { AddLocation, type KnownLocationOption } from "@/components/add-location";
import { LocationIcon } from "@/components/icon-picker";
import { addProjectLocation, removeProjectLocation } from "../actions";

/**
 * The rooms every job raised here starts with.
 *
 * Copied onto each new job as if somebody had added them there, so the crew
 * at the fortieth store of a rollout does not name the MDF for the fortieth
 * time. A job keeps its own afterwards: taking one off here, or adding one,
 * leaves the jobs already raised as they are.
 */
export function ProjectLocations({
  projectId,
  locations,
  known,
}: {
  projectId: string;
  locations: { id: string; name: string; icon: string | null }[];
  known: KnownLocationOption[];
}) {
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function remove(id: string) {
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("projectId", projectId);
      formData.set("id", id);
      const result = await removeProjectLocation(formData);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {locations.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          None — each job names its own.
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {locations.map((location) => (
            <span
              key={location.id}
              className="flex min-h-8 items-center gap-1.5 rounded-lg pl-2.5 pr-1 text-[13px] font-semibold ring-1 ring-inset ring-border"
            >
              <LocationIcon icon={location.icon} className="size-3.5" />
              {location.name}
              <button
                type="button"
                aria-label={`Take ${location.name} off the list`}
                disabled={pending}
                onClick={() => remove(location.id)}
                className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
              >
                <X className="size-3.5" />
              </button>
            </span>
          ))}
        </div>
      )}

      <AddLocation
        known={known}
        taken={locations.map((location) => location.name)}
        where="this project"
        onError={setError}
        onAdd={async (name, icon) => {
          const formData = new FormData();
          formData.set("projectId", projectId);
          formData.set("name", name);
          if (icon) formData.set("icon", icon);
          const result = await addProjectLocation(formData);
          return result.ok ? null : result.error;
        }}
      />

      {error ? <p className="text-sm text-danger">{error}</p> : null}
    </div>
  );
}
