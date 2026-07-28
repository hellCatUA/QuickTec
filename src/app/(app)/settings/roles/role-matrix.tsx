"use client";

import { AlertCircle, Loader2 } from "lucide-react";
import * as React from "react";
import type { BaseRole, PermissionScope } from "@prisma-client";
import { updateRoleGrant } from "../actions";

const SCOPE_OPTIONS: { value: PermissionScope | ""; label: string }[] = [
  { value: "", label: "—" },
  { value: "OWN", label: "Own" },
  { value: "REPORTS", label: "Reports" },
  { value: "PROJECT", label: "Project" },
  { value: "ALL", label: "All" },
];

const ROLE_LABEL: Record<BaseRole, string> = {
  TECH: "Tech",
  SUPERVISOR: "Supervisor",
  MANAGER: "Manager",
  ADMINISTRATOR: "Admin",
  ACCOUNTANT: "Accountant",
};

type Group = {
  group: string;
  permissions: { key: string; label: string; description: string }[];
};

export function RoleMatrix({
  roles,
  groups,
  matrix,
}: {
  roles: BaseRole[];
  groups: Group[];
  matrix: Record<string, PermissionScope>;
}) {
  // Optimistic local copy so a cell reflects the choice immediately; the server
  // action reconciles it and any rejection is rolled back below.
  const [values, setValues] = React.useState(matrix);
  const [saving, setSaving] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function change(
    role: BaseRole,
    permission: string,
    scope: PermissionScope | "",
  ) {
    const cellKey = `${role}:${permission}`;
    const previous = values[cellKey];

    setError(null);
    setSaving(cellKey);
    setValues((current) => {
      const next = { ...current };
      if (scope === "") delete next[cellKey];
      else next[cellKey] = scope;
      return next;
    });

    const formData = new FormData();
    formData.set("role", role);
    formData.set("permission", permission);
    formData.set("scope", scope);

    const result = await updateRoleGrant(formData);
    setSaving(null);

    if (!result.ok) {
      setError(result.error);
      setValues((current) => {
        const next = { ...current };
        if (previous) next[cellKey] = previous;
        else delete next[cellKey];
        return next;
      });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <div className="mx-auto flex w-full max-w-5xl items-start gap-2 rounded-lg bg-danger/15 p-3 text-sm text-danger ring-1 ring-inset ring-danger/30">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          {error}
        </div>
      ) : null}

      {groups.map(({ group, permissions }) => (
        <section key={group} className="mx-auto w-full max-w-5xl">
          <h2 className="mb-2 text-sm font-semibold">{group}</h2>

          {/* The matrix is wide by nature; it scrolls inside its own box so the
              page body never scrolls sideways on a phone. */}
          <div className="overflow-x-auto rounded-xl border border-border bg-surface">
            <table className="w-full min-w-[46rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="sticky left-0 z-10 bg-surface p-3 text-left font-medium">
                    Permission
                  </th>
                  {roles.map((role) => (
                    <th
                      key={role}
                      className="p-3 text-left text-xs font-medium text-muted-foreground"
                    >
                      {ROLE_LABEL[role]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {permissions.map((permission) => (
                  <tr
                    key={permission.key}
                    className="border-b border-border last:border-0"
                  >
                    <td className="sticky left-0 z-10 max-w-72 bg-surface p-3 align-top">
                      <div className="font-medium">{permission.label}</div>
                      <div className="text-xs text-muted-foreground">
                        {permission.description}
                      </div>
                      <code className="text-[10px] text-muted-foreground/70">
                        {permission.key}
                      </code>
                    </td>
                    {roles.map((role) => {
                      const cellKey = `${role}:${permission.key}`;
                      return (
                        <td key={role} className="p-2 align-top">
                          <div className="flex items-center gap-1">
                            <select
                              aria-label={`${ROLE_LABEL[role]} — ${permission.label}`}
                              value={values[cellKey] ?? ""}
                              onChange={(event) =>
                                void change(
                                  role,
                                  permission.key,
                                  event.target.value as PermissionScope | "",
                                )
                              }
                              className="min-h-9 w-full rounded-md border border-border bg-input px-2 text-xs"
                            >
                              {SCOPE_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                            {saving === cellKey ? (
                              <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground" />
                            ) : null}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
