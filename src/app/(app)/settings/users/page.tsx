import { redirect } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { db } from "@/lib/db";
import { can, getSessionUser } from "@/lib/session";
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
      email: true,
      baseRole: true,
      active: true,
      timeZone: true,
      phone: true,
      directSupervisorId: true,
      lastLoginAt: true,
    },
  });

  // Anyone can be someone's direct supervisor — the role that matters for
  // payroll is this link, not the NextCloud group.
  const supervisorOptions = users
    .filter((user) => user.active && user.baseRole !== "TECH")
    .map((user) => ({ id: user.id, name: user.name }));

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">Users</h1>
        <p className="text-sm text-muted-foreground">
          Roles are read from NextCloud groups on every sign-in and cannot be
          changed here. What is set here is the direct supervisor — the person
          who approves and pays this tech, whatever project they work on.
        </p>
      </div>

      {users.length === 0 ? (
        <Card>
          <CardContent className="text-sm text-muted-foreground">
            No users yet. Accounts are created automatically the first time
            someone signs in with NextCloud.
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {users.map((user) => (
            <UserRow
              key={user.id}
              user={{
                ...user,
                lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
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
