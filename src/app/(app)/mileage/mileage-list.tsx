"use client";

import { X } from "lucide-react";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatMoney } from "@/lib/money";
import { deleteMileage } from "./actions";

export type MileageView = {
  id: string;
  category: string;
  categoryLabel: string;
  reference: string | null;
  jobTitle: string | null;
  startOdometer: string;
  endOdometer: string;
  miles: string;
  amount: string;
  date: string;
  note: string | null;
  startPhotoId: string | null;
  endPhotoId: string | null;
};

export function MileageList({
  entries,
  canDelete,
}: {
  entries: MileageView[];
  canDelete: boolean;
}) {
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  return (
    <div className="flex flex-col gap-2">
      {error ? <p className="text-sm text-danger">{error}</p> : null}

      {entries.map((entry) => (
        <Card key={entry.id}>
          <CardContent className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="neutral">{entry.categoryLabel}</Badge>
                <span className="tabular text-sm font-medium">
                  {entry.miles} mi
                </span>
                <span className="tabular text-sm text-success">
                  {formatMoney(entry.amount)}
                </span>
              </div>

              <div className="mt-0.5 truncate text-xs text-muted-foreground">
                {entry.date} · {entry.startOdometer} → {entry.endOdometer}
                {entry.reference ? ` · ${entry.reference}` : ""}
                {entry.jobTitle ? ` · ${entry.jobTitle}` : ""}
              </div>

              {entry.note ? (
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {entry.note}
                </div>
              ) : null}
            </div>

            <div className="flex items-center gap-1">
              {[entry.startPhotoId, entry.endPhotoId]
                .filter((id): id is string => Boolean(id))
                .map((id) => (
                  <a
                    key={id}
                    href={`/api/files/${id}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/files/${id}?w=200`}
                      alt="Odometer"
                      loading="lazy"
                      className="size-12 rounded border border-border object-cover"
                    />
                  </a>
                ))}

              {canDelete ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Remove trip"
                  disabled={pending}
                  onClick={() => {
                    setError(null);
                    startTransition(async () => {
                      const formData = new FormData();
                      formData.set("id", entry.id);
                      const result = await deleteMileage(formData);
                      if (!result.ok) setError(result.error);
                    });
                  }}
                >
                  <X />
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
