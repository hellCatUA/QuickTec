import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import {
  PERMISSION_GROUPS,
  PERMISSIONS,
  type Permission,
} from "@/lib/permissions";
import { loadPrivacySettings } from "@/lib/profile";
import { can, getSessionUser } from "@/lib/session";
import { cn } from "@/lib/utils";
import type { BaseRole, PermissionScope } from "@prisma-client";
import { PrivacyMatrix } from "./privacy-matrix";
import { RoleMatrix } from "./role-matrix";

export const metadata = { title: "Roles & permissions" };

export default async function RolesSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const viewer = await getSessionUser();
  if (!viewer) redirect("/signin");
  if (!can(viewer, "roles.manage", { minScope: "ALL" })) redirect("/dashboard");

  const { tab } = await searchParams;
  const privacy = tab === "privacy";

  // Who may see each line of a profile is a permission of its own kind — per
  // field rather than per role — and lives beside the matrix as its own tab.
  if (privacy) {
    return (
      <div className="flex flex-col gap-4">
        <Heading privacy />
        <PrivacyMatrix initial={await loadPrivacySettings()} />
      </div>
    );
  }

  const grants = await db.roleGrant.findMany({
    select: { role: true, permission: true, scope: true },
  });

  const matrix: Record<string, PermissionScope> = {};
  for (const grant of grants) {
    matrix[`${grant.role}:${grant.permission}`] = grant.scope;
  }

  const permissionsByGroup = PERMISSION_GROUPS.map((group) => ({
    group,
    permissions: (
      Object.entries(PERMISSIONS) as [
        Permission,
        (typeof PERMISSIONS)[Permission],
      ][]
    )
      .filter(([, meta]) => meta.group === group)
      .map(([key, meta]) => ({
        key,
        label: meta.label,
        description: meta.description,
      })),
  }));

  const roles: BaseRole[] = [
    "TECH",
    "SUPERVISOR",
    "MANAGER",
    "ADMINISTRATOR",
    "ACCOUNTANT",
    "GUEST",
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="mx-auto w-full max-w-5xl">
        <Heading privacy={false} />
        <p className="mt-3 text-sm text-muted-foreground">
          Every permission carries a scope saying how far it reaches. Scopes are
          nested: <strong>Own</strong> ⊂ <strong>Reports</strong> ⊂{" "}
          <strong>Project</strong> ⊂ <strong>All</strong>. Blank means the role
          does not have the permission at all.
        </p>
        <dl className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
          <div>
            <dt className="font-medium text-foreground">Own</dt>
            <dd>Only their own records.</dd>
          </div>
          <div>
            <dt className="font-medium text-foreground">Reports</dt>
            <dd>Own, plus every tech whose direct supervisor they are.</dd>
          </div>
          <div>
            <dt className="font-medium text-foreground">Project</dt>
            <dd>
              Reports, plus everything in projects where they are PM or
              supervisor.
            </dd>
          </div>
          <div>
            <dt className="font-medium text-foreground">All</dt>
            <dd>No restriction.</dd>
          </div>
        </dl>
      </div>

      <RoleMatrix
        roles={roles}
        groups={permissionsByGroup}
        matrix={matrix}
      />
    </div>
  );
}

function Heading({ privacy }: { privacy: boolean }) {
  const tab = (active: boolean) =>
    cn(
      "-mb-px flex min-h-10 items-center border-b-2 px-3 text-sm font-medium",
      active
        ? "border-primary text-foreground"
        : "border-transparent text-muted-foreground hover:text-foreground",
    );
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-3">
      <h1 className="text-lg font-semibold">Roles &amp; permissions</h1>
      <nav aria-label="Roles and permissions" className="flex gap-1 border-b border-border">
        <Link href="/settings/roles" aria-current={privacy ? undefined : "page"} className={tab(!privacy)}>
          Permissions
        </Link>
        <Link
          href="/settings/roles?tab=privacy"
          aria-current={privacy ? "page" : undefined}
          className={tab(privacy)}
        >
          Privacy
        </Link>
      </nav>
    </div>
  );
}
