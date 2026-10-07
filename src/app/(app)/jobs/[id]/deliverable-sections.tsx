"use client";

import { ChevronDown, Link2, Loader2, SlidersHorizontal } from "lucide-react";
import * as React from "react";
import type { KnownLocationOption } from "@/components/add-location";
import { DeliverableRules, type EditableRule } from "@/components/deliverable-rules";
import type { PlanLocation } from "@/components/location-plan";
import { Button } from "@/components/ui/button";
import { deliverableLabel, ruleKey } from "@/lib/deliverables";
import { cn } from "@/lib/utils";
import { returnToProjectDeliverables, saveJobDeliverableRule } from "./actions";
import { JobLocations } from "./job-locations";

/**
 * Where the job's sheet comes from: its project's, live; its own, since
 * somebody changed it here; the one it was checked out against; or the
 * standard two, for a job with no project.
 */
export type SectionsSource = "project" | "own" | "checkout" | "defaults";

/**
 * Which sections this job asks for, and the rooms it is photographed at,
 * changed from the job itself.
 *
 * Folded away by default: on most jobs the answer came from the project and
 * nobody needs to see it, but the ones where a customer wants serials recorded
 * or waives the post-install photos are decided after the job exists — and
 * the rooms are best named before anybody is on site.
 */
export function DeliverableSections({
  jobId,
  rules,
  canRequire = true,
  locations = [],
  known = [],
  source,
  hasProject,
}: {
  jobId: string;
  rules: EditableRule[];
  source: SectionsSource;
  /** Whether there is a project's sheet to go back to. */
  hasProject: boolean;
  /** The job's rooms: shown under a section photographed at each, and planned. */
  locations?: PlanLocation[];
  /** The rooms offered by name when one is added. */
  known?: KnownLocationOption[];
  /**
   * Whether this person may also demand a section, or take one away.
   *
   * A tech turns one on because the job in front of them needs somewhere to
   * put serials. Deciding that a section is mandatory — or that one somebody
   * planned is not needed — is a supervisor's call, and it is checkout that
   * enforces it.
   */
  canRequire?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const on = rules.filter((rule) => rule.enabled).length;
  const required = rules.filter((rule) => rule.enabled && rule.required).length;
  const perLocation = rules
    .filter((rule) => rule.enabled && rule.perLocation && rule.requiresPhoto)
    .map((rule) => ({
      key: ruleKey(rule),
      label: deliverableLabel(rule.category, rule.customLabel),
      minPhotos: rule.minPhotos,
      required: rule.required,
    }));

  return (
    <div className="flex flex-col gap-3">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="self-start"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        <SlidersHorizontal />
        Sections &amp; locations
        <span className="text-muted-foreground">
          {on} on, {required} required
          {locations.length > 0
            ? ` · ${locations.length} location${locations.length === 1 ? "" : "s"}`
            : ""}
        </span>
        <ChevronDown className={cn("transition-transform", open && "rotate-180")} />
      </Button>

      {open ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-surface-raised px-3 py-2 text-xs text-muted-foreground">
          <Link2 className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1">
            {source === "project"
              ? "Following the project’s sections. Changing one here keeps this job’s own copy from then on."
              : source === "own"
                ? hasProject
                  ? "Changed for this job. The project’s later edits do not reach it."
                  : "Changed for this job."
                : source === "checkout"
                  ? "Fixed when the job was checked out: the project’s later edits do not reach it."
                  : "The standard sections for a job with no project."}
          </span>
          {source === "own" && hasProject && canRequire ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() => {
                if (
                  !window.confirm(
                    "Drop this job’s changes and follow the project’s sections again?",
                  )
                )
                  return;
                setError(null);
                startTransition(async () => {
                  const formData = new FormData();
                  formData.set("jobId", jobId);
                  const result = await returnToProjectDeliverables(formData);
                  if (!result.ok) setError(result.error);
                });
              }}
            >
              {pending ? <Loader2 className="animate-spin" /> : null}
              Use the project’s again
            </Button>
          ) : null}
          {error ? <p className="w-full text-danger">{error}</p> : null}
        </div>
      ) : null}

      {open ? (
        <DeliverableRules
          owner={{ field: "jobId", id: jobId }}
          rules={rules}
          save={saveJobDeliverableRule}
          canRequire={canRequire}
          locations={locations}
        />
      ) : null}

      {/* Where the per-location fields are photographed, and how much at
          each: planning, so whoever may demand a section. */}
      {open && canRequire ? (
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Locations
          </div>
          <JobLocations
            jobId={jobId}
            locations={locations}
            fields={perLocation}
            known={known}
          />
        </div>
      ) : null}
    </div>
  );
}
