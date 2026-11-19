import { TriangleAlert } from "lucide-react";
import { redirect } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { keysCheckFor } from "@/lib/account-keys";
import { getCompanySettings } from "@/lib/company";
import { usDateTimeInZone } from "@/lib/datetime";
import { db } from "@/lib/db";
import { loadPrivacySettings, pictureFor } from "@/lib/profile";
import { ROLE_LABEL, zonePickedByHand } from "@/lib/profile-format";
import { can, getSessionUser } from "@/lib/session";
import { canSupervise, supervisionsToFix } from "@/lib/supervisors";
import { OutsideAccount } from "./outside-account";
import { UserList } from "./user-list";
import type { BaseRole } from "@prisma-client";

export const metadata = { title: "Users" };

/** The roles an outside account can be made with, in the order offered. */
const OUTSIDE_ROLES = ["TECH", "SUPERVISOR", "MANAGER", "ACCOUNTANT", "ADMINISTRATOR", "GUEST"] as const;

/** Why a supervisor can no longer approve anybody's week, when they cannot. */
function supervisorGone(
  supervisor: { active: boolean; baseRole: BaseRole } | undefined,
): "deactivated" | "cannot approve" | null {
  if (!supervisor) return null;
  if (!supervisor.active) return "deactivated";
  return canSupervise(supervisor.baseRole) ? null : "cannot approve";
}

export default async function UsersSettingsPage() {
  const viewer = await getSessionUser();
  if (!viewer) redirect("/signin");
  // Every account's legal name, street and personal phone are on this page,
  // and every change made from it needs the same reach: a narrower grant of
  // the permission is not a way in to the whole company's details.
  if (!can(viewer, "users.manage", { minScope: "ALL" })) redirect("/dashboard");

  const users = await db.user.findMany({
    orderBy: [{ active: "desc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      nameOverridden: true,
      legalName: true,
      email: true,
      baseRole: true,
      active: true,
      timeZone: true,
      timeZoneManual: true,
      phone: true,
      addressLine1: true,
      addressLine2: true,
      city: true,
      state: true,
      postalCode: true,
      country: true,
      directSupervisorId: true,
      lastLoginAt: true,
      signInMethod: true,
      passwordFallback: true,
      passwordHash: true,
      avatarPath: true,
      avatarVisibility: true,
    },
  });
  const privacy = await loadPrivacySettings();
  const pictures = new Map(
    await Promise.all(
      users.map(async (user) => [user.id, await pictureFor(viewer, user, privacy)] as const),
    ),
  );

  // Only somebody who can actually approve a week. The list used to be
  // "anyone who is not a tech", which let a week be routed to an account with
  // no payroll reach and then sit there for good.
  const supervisorOptions = users
    .filter((user) => user.active && canSupervise(user.baseRole))
    .map((user) => ({ id: user.id, name: user.name }));

  const toFix = await supervisionsToFix();
  const mayHoldKeys = await keysCheckFor(viewer);

  // Written out here, on the company's clock like every other time an office
  // reads. Left to the browser it came out in a format nothing else in the
  // app uses, and in whatever zone the device happened to be set to; then in
  // the viewer's own zone, so two managers read two different times for the
  // same sign-in.
  const company = await getCompanySettings();
  const zone = company.defaultTimeZone;
  const byId = new Map(users.map((user) => [user.id, user]));

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">Users</h1>
        <p className="text-sm text-muted-foreground">
          Roles come from NextCloud groups at every sign-in and are not changed
          here. What is set here is who approves and pays each person — their
          direct supervisor, always a manager or an administrator — and their
          contact details. An outside account has no groups and keeps the role
          it was created with.
        </p>
      </div>

      {toFix.length > 0 ? (
        <Card className="border-warning/40 bg-warning/5">
          <CardContent className="flex flex-col gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-warning">
              <TriangleAlert className="size-4" />
              {toFix.length === 1
                ? "One person's supervisor cannot approve payroll"
                : `${toFix.length} people have a supervisor who cannot approve payroll`}
            </div>
            <p className="text-xs text-muted-foreground">
              Only an active manager or administrator can approve a week. Until
              these are changed, their weeks have nobody who can sign them off.
              Nothing has been moved automatically: who approves somebody&rsquo;s
              money is a decision, not a default.
            </p>
            <ul className="flex flex-col gap-1 text-xs">
              {toFix.map((entry) => (
                <li key={entry.id}>
                  <span className="font-medium">{entry.name}</span>
                  <span className="text-muted-foreground">
                    {" "}
                    → {entry.supervisor.name} (
                    {/* The role's word, not the enum lower-cased; and said
                        when the account is switched off, which the role alone
                        never showed. */}
                    {entry.supervisor.active
                      ? (ROLE_LABEL[entry.supervisor.baseRole] ?? entry.supervisor.baseRole)
                      : "deactivated"}
                    )
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {/* Only the roles this viewer may hand out: Manager and Administrator
          were offered to somebody who cannot, and refused once the whole
          form was filled in. */}
      <OutsideAccount
        roles={OUTSIDE_ROLES.filter((role) => mayHoldKeys({ role }))}
        defaultZone={company.defaultTimeZone}
      />

      {users.length === 0 ? (
        <Card>
          <CardContent className="text-sm text-muted-foreground">
            No users yet. Accounts are created automatically the first time
            someone signs in with NextCloud.
          </CardContent>
        </Card>
      ) : (
        <UserList
          rows={users.map(
            ({
              passwordHash,
              avatarPath: _path,
              avatarVisibility: _visibility,
              timeZoneManual,
              lastLoginAt,
              ...user
            }) => ({
              picture: pictures.get(user.id) ?? null,
              supervisorName: user.directSupervisorId
                ? (byId.get(user.directSupervisorId)?.name ?? null)
                : null,
              supervisorGone: supervisorGone(
                user.directSupervisorId ? byId.get(user.directSupervisorId) : undefined,
              ),
              lastLogin: lastLoginAt ? usDateTimeInZone(lastLoginAt, zone) : null,
              self: user.id === viewer.id,
              keys: mayHoldKeys({ role: user.baseRole, userId: user.id }),
              user: {
                ...user,
                zoneByHand: zonePickedByHand({ ...user, timeZoneManual }),
                // Pulled out of the spread rather than trusted to it. The row
                // is a client component, so anything handed to it is
                // serialised into the payload the browser receives — and
                // `...user` was quietly putting every scrypt hash in there
                // while the comment underneath claimed the opposite. Only the
                // answer to "is there one" crosses, because "invited and never
                // signed in" reads differently from "forgotten it".
                hasPassword: passwordHash !== null,
              },
              supervisorOptions: supervisorOptions.filter(
                (option) => option.id !== user.id,
              ),
            }),
          )}
        />
      )}
    </div>
  );
}
