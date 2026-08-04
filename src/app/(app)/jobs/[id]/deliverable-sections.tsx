"use client";

import { ChevronDown, SlidersHorizontal } from "lucide-react";
import * as React from "react";
import { DeliverableRules, type EditableRule } from "@/components/deliverable-rules";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { saveJobDeliverableRule } from "./actions";

/**
 * Which sections this job asks for, changed from the job itself.
 *
 * Folded away by default: on most jobs the answer came from the project and
 * nobody needs to see it, but the ones where a customer wants serials recorded
 * or waives the post-install photos are decided after the job exists.
 */
export function DeliverableSections({
  jobId,
  rules,
}: {
  jobId: string;
  rules: EditableRule[];
}) {
  const [open, setOpen] = React.useState(false);

  const on = rules.filter((rule) => rule.enabled).length;
  const required = rules.filter((rule) => rule.enabled && rule.required).length;

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
        Sections
        <span className="text-muted-foreground">
          {on} on, {required} required
        </span>
        <ChevronDown className={cn("transition-transform", open && "rotate-180")} />
      </Button>

      {open ? (
        <DeliverableRules
          owner={{ field: "jobId", id: jobId }}
          rules={rules}
          save={saveJobDeliverableRule}
        />
      ) : null}
    </div>
  );
}
