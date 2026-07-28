"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ProjectForm, type Option } from "./project-form";

export function NewProjectPanel({
  clients,
  customers,
  managers,
}: {
  clients: Option[];
  customers: Option[];
  managers: Option[];
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button
        type="button"
        variant="secondary"
        onClick={() => setOpen(true)}
        className="self-start"
        disabled={clients.length === 0}
        title={
          clients.length === 0
            ? "Add a client first — every project belongs to one"
            : undefined
        }
      >
        <Plus /> New project
      </Button>
    );
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div className="text-sm font-semibold">New project</div>
        <ProjectForm
          clients={clients}
          customers={customers}
          managers={managers}
          redirectOnCreate
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setOpen(false)}
        >
          Cancel
        </Button>
      </CardContent>
    </Card>
  );
}
