import { TriangleAlert } from "lucide-react";
import { redirect } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { db } from "@/lib/db";
import { can, getSessionUser } from "@/lib/session";
import { canSupervise, supervisionsToFix } from "@/lib/supervisors";
import { OutsideAccount } from "./outside-account";
import { UserRow } from "./user-row";

export const metadata = { title: "Users" };

export default async function UsersSettingsPage() {
  const viewer = await getSessionUser();
  if (!viewer) redirect("/signin");
  if (!can(viewer, "users.manage")) redirect("/dashboard");

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
      passwordHash: true,
    },
  });

  // Only somebody who can actually approve a week. The list used to be
  // "anyone who is not a tech", which let a week be routed to an account with
  // no payroll reach and then sit there for good.
  const supervisorOptions = users
    .filter((user) => user.active && canSupervise(user.baseRole))
    .map((user) => ({ id: user.id, name: user.name }));

  const toFix = await supervisionsToFix();

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">Users</h1>
        <p className="text-sm text-muted-foreground">
          Staff roles are read from NextCloud groups on every sign-in and cannot
          be changed here. What is set here is the direct supervisor — the
          person who approves and pays this tech, whatever project they work on,
          which is why only managers and administrators can be picked. Outside
          accounts are different: they have no groups, so their role is whatever
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
              Only managers and administrators can approve a week. Until these
              are changed, their weeks have nobody who can sign them off.
              Nothing has been moved automatically: who approves somebody&rsquo;s
              money is a decision, not a default.
            </p>
            <ul className="flex flex-col gap-1 text-xs">
              {toFix.map((entry) => (
                <li key={entry.id} className="tabular-nums">
                  <span className="font-medium">{entry.name}</span>
                  <span className="text-muted-foreground">
                    {" "}
                    → {entry.supervisor.name} (
                    {entry.supervisor.baseRole.toLowerCase()})
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <OutsideAccount />

      {users.length === 0 ? (
        <Card>
          <CardContent className="text-sm text-muted-foreground">
            No users yet. Accounts are created automatically the first time
            someone signs in with NextCloud.
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {users.map(({ passwordHash, ...user }) => (
            <UserRow
              key={user.id}
              user={{
                ...user,
                lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
                // Pulled out of the spread rather than trusted to it. UserRow
                // is a client component, so anything handed to it is
                // serialised into the payload the browser receives — and
                // `...user` was quietly putting every scrypt hash in there
                // while the comment underneath claimed the opposite. Only the
                // answer to "is there one" crosses, because "invited and never
                // signed in" reads differently from "forgotten it".
                hasPassword: passwordHash !== null,
              }}
              supervisorOptions={supervisorOptions.filter(
                (option) => option.id !== user.id,
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
}
