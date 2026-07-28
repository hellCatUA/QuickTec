"use client";

import { Plus, X } from "lucide-react";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import type { ProjectRole } from "@prisma-client";
import { removeProjectMember, upsertProjectMember } from "../actions";

const ROLE_LABEL: Record<ProjectRole, string> = {
  PROJECT_MANAGER: "Project manager",
  SUPERVISOR: "Supervisor",
  TECH: "Tech",
};

type Member = {
  userId: string;
  role: ProjectRole;
  name: string;
  email: string;
  baseRole: string;
};

export function ProjectMembers({
  projectId,
  managerId,
  members,
  candidates,
}: {
  projectId: string;
  managerId: string | null;
  members: Member[];
  candidates: { id: string; label: string }[];
}) {
  const [error, setError] = useState<string | null>(null);
  const [addingId, setAddingId] = useState("");
  const [addingRole, setAddingRole] = useState<ProjectRole>("TECH");
  const [pending, startTransition] = useTransition();

  const memberIds = new Set(members.map((member) => member.userId));
  const available = candidates.filter(
    (candidate) => !memberIds.has(candidate.id),
  );

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setError(result.error ?? "Something went wrong");
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {error ? <p className="text-sm text-danger">{error}</p> : null}

      {members.length === 0 ? (
        <p className="text-sm text-muted-foreground">No members yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {members.map((member) => (
            <div
              key={member.userId}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">
                  {member.name}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {member.email}
                </div>
              </div>

              {member.userId === managerId ? (
                <Badge variant="primary">PM</Badge>
              ) : null}

              <div className="ml-auto flex items-center gap-2">
                <Select
                  aria-label={`Role for ${member.name}`}
                  value={member.role}
                  disabled={pending}
                  onChange={(event) => {
                    const formData = new FormData();
                    formData.set("projectId", projectId);
                    formData.set("userId", member.userId);
                    formData.set("role", event.target.value);
                    run(() => upsertProjectMember(formData));
                  }}
                  className="min-h-9 w-auto text-xs"
                >
                  {(Object.keys(ROLE_LABEL) as ProjectRole[]).map((role) => (
                    <option key={role} value={role}>
                      {ROLE_LABEL[role]}
                    </option>
                  ))}
                </Select>

                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${member.name}`}
                  disabled={pending}
                  onClick={() => {
                    const formData = new FormData();
                    formData.set("projectId", projectId);
                    formData.set("userId", member.userId);
                    run(() => removeProjectMember(formData));
                  }}
                >
                  <X />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {available.length > 0 ? (
        <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
          <Select
            aria-label="Add member"
            value={addingId}
            onChange={(event) => setAddingId(event.target.value)}
            className="w-auto min-w-48 flex-1"
          >
            <option value="">Select someone…</option>
            {available.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.label}
              </option>
            ))}
          </Select>

          <Select
            aria-label="Role"
            value={addingRole}
            onChange={(event) =>
              setAddingRole(event.target.value as ProjectRole)
            }
            className="w-auto"
          >
            {(Object.keys(ROLE_LABEL) as ProjectRole[]).map((role) => (
              <option key={role} value={role}>
                {ROLE_LABEL[role]}
              </option>
            ))}
          </Select>

          <Button
            type="button"
            variant="secondary"
            disabled={!addingId || pending}
            onClick={() => {
              const formData = new FormData();
              formData.set("projectId", projectId);
              formData.set("userId", addingId);
              formData.set("role", addingRole);
              run(() => upsertProjectMember(formData));
              setAddingId("");
            }}
          >
            <Plus /> Add
          </Button>
        </div>
      ) : null}
    </div>
  );
}
