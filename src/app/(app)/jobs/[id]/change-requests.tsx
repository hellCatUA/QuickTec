"use client";

import { ArrowRight, Check, X } from "lucide-react";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { JOB_FIELDS, isJobField } from "@/lib/job-fields";
import { reviewChangeRequest } from "./actions";

type Request = {
  id: string;
  fieldPath: string;
  oldValue: string | null;
  newValue: string | null;
  reason: string | null;
  requestedBy: string;
  createdAt: string;
};

export function ChangeRequests({
  requests,
  canReview,
}: {
  requests: Request[];
  canReview: boolean;
}) {
  const [error, setError] = React.useState<string | null>(null);
  const [note, setNote] = React.useState<Record<string, string>>({});
  const [pending, startTransition] = React.useTransition();

  if (requests.length === 0) return null;

  function decide(id: string, decision: "approve" | "reject") {
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("requestId", id);
      formData.set("decision", decision);
      formData.set("note", note[id] ?? "");

      const result = await reviewChangeRequest(formData);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {error ? <p className="text-sm text-danger">{error}</p> : null}

      {requests.map((request) => {
        const label = isJobField(request.fieldPath)
          ? JOB_FIELDS[request.fieldPath].label
          : request.fieldPath;

        return (
          <div
            key={request.id}
            className="flex flex-col gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="warning">{label}</Badge>
              <span className="text-xs text-muted-foreground">
                {request.requestedBy} · {request.createdAt}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground line-through">
                {request.oldValue || "empty"}
              </span>
              <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="font-medium">{request.newValue || "empty"}</span>
            </div>

            {request.reason ? (
              <p className="text-xs text-muted-foreground">{request.reason}</p>
            ) : null}

            {canReview ? (
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  value={note[request.id] ?? ""}
                  placeholder="Note (optional)"
                  onChange={(event) =>
                    setNote((current) => ({
                      ...current,
                      [request.id]: event.target.value,
                    }))
                  }
                  className="min-w-40 flex-1"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="success"
                  disabled={pending}
                  onClick={() => decide(request.id, "approve")}
                >
                  <Check /> Approve
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={pending}
                  onClick={() => decide(request.id, "reject")}
                >
                  <X /> Reject
                </Button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Waiting on a supervisor.
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
