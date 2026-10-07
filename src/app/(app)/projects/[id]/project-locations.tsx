"use client";

import type { KnownLocationOption } from "@/components/add-location";
import { LocationPlan, type PlanField, type PlanLocation } from "@/components/location-plan";
import {
  addProjectLocation,
  removeProjectLocation,
  saveProjectLocationPlan,
} from "../actions";

/**
 * The rooms every job raised here starts with.
 *
 * Copied onto each new job as if somebody had added them there, so the crew
 * at the fortieth store of a rollout does not name the MDF for the fortieth
 * time — with the fields each is photographed in and any count set for it.
 * A job keeps its own afterwards: taking one off here, or adding one, leaves
 * the jobs already raised as they are.
 */
export function ProjectLocations({
  projectId,
  locations,
  fields,
  known,
}: {
  projectId: string;
  locations: Omit<PlanLocation, "counted">[];
  fields: PlanField[];
  known: KnownLocationOption[];
}) {
  return (
    <LocationPlan
      // A project's rooms are planned ones: each owes its fields their count.
      locations={locations.map((location) => ({ ...location, counted: true }))}
      fields={fields}
      known={known}
      where="on this project"
      empty="None — each job names its own."
      canEdit
      onAdd={async (name, icon) => {
        const formData = new FormData();
        formData.set("projectId", projectId);
        formData.set("name", name);
        if (icon) formData.set("icon", icon);
        const result = await addProjectLocation(formData);
        return result.ok ? null : result.error;
      }}
      onSave={async (id, change) => {
        const formData = new FormData();
        formData.set("projectId", projectId);
        formData.set("id", id);
        if (change.fields) formData.set("fields", JSON.stringify(change.fields));
        if (change.count) formData.set("count", JSON.stringify(change.count));
        const result = await saveProjectLocationPlan(formData);
        return result.ok ? null : result.error;
      }}
      onRemove={async (id) => {
        const formData = new FormData();
        formData.set("projectId", projectId);
        formData.set("id", id);
        const result = await removeProjectLocation(formData);
        return result.ok ? null : result.error;
      }}
    />
  );
}
