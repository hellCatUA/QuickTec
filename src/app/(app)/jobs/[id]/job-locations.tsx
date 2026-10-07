"use client";

import type { KnownLocationOption } from "@/components/add-location";
import { LocationPlan, type PlanField, type PlanLocation } from "@/components/location-plan";
import { planJobLocation, removeJobLocation, saveJobLocationPlan } from "./upload-actions";

/**
 * The job's rooms, planned from the job itself — before anybody is on site,
 * or while they are.
 *
 * The same rooms the crew sees in the photo fields: the ones that came from
 * the project, the ones named here, and the ones the crew found on the day,
 * which owe nothing until a number is set on them here.
 */
export function JobLocations({
  jobId,
  locations,
  fields,
  known,
}: {
  jobId: string;
  locations: PlanLocation[];
  fields: PlanField[];
  known: KnownLocationOption[];
}) {
  return (
    <LocationPlan
      locations={locations}
      fields={fields}
      known={known}
      where="on this job"
      empty="None yet. Name the rooms the crew is to photograph, or leave it to them on site."
      canEdit
      onAdd={async (name, icon) => {
        const formData = new FormData();
        formData.set("jobId", jobId);
        formData.set("name", name);
        if (icon) formData.set("icon", icon);
        const result = await planJobLocation(formData);
        return result.ok ? null : result.error;
      }}
      onSave={async (id, change) => {
        const formData = new FormData();
        formData.set("locationId", id);
        formData.set("fields", JSON.stringify(change.fields));
        formData.set("minPhotos", JSON.stringify(change.minPhotos));
        if (change.counted !== undefined) {
          formData.set("counted", String(change.counted));
        }
        const result = await saveJobLocationPlan(formData);
        return result.ok ? null : result.error;
      }}
      onRemove={async (id) => {
        const formData = new FormData();
        formData.set("locationId", id);
        const result = await removeJobLocation(formData);
        return result.ok ? null : result.error;
      }}
    />
  );
}
