import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/page-header";
import { db } from "@/lib/db";
import { NO_PROJECT_REF } from "@/lib/int-wo";
import { can, getSessionUser, permissionScope } from "@/lib/session";
import type { Prisma } from "@prisma-client";
import { NewProjectPanel } from "./new-project-panel";

export const metadata = { title: "Projects" };

const STATUS_VARIANT = {
  ACTIVE: "success",
  ON_HOLD: "warning",
  CLOSED: "neutral",
} as const;

export default async function ProjectsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/signin");

  const canManage = can(user, "project.manage");
  const scope = permissionScope(user, "project.manage");
  if (!canManage && !can(user, "job.view")) redirect("/dashboard");

  // Someone without project.manage at ALL scope has no business browsing the
  // whole portfolio — they see the projects they are actually on. Managing a
  // project counts even if the membership row is missing, so a PM can never
  // lose sight of their own project.
  const visibility: Prisma.ProjectWhereInput =
    scope === "ALL"
      ? {}
      : {
          OR: [
            { managerId: user.id },
            { members: { some: { userId: user.id } } },
          ],
        };

  const [projects, clients, customers, managers, contacts] = await Promise.all([
    db.project.findMany({
      where: visibility,
      orderBy: [{ status: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        externalProjectId: true,
        status: true,
        intWoCounter: true,
        client: { select: { name: true } },
        customer: { select: { code: true } },
        manager: { select: { name: true } },
        _count: { select: { jobs: true, members: true } },
      },
    }),
    db.client.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.customer.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, code: true },
    }),
    db.user.findMany({
      where: { active: true, baseRole: { in: ["SUPERVISOR", "MANAGER"] } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, baseRole: true },
    }),
    db.externalContact.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        title: true,
        phone: true,
        email: true,
        clientId: true,
      },
    }),
  ]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <PageHeader
        title="Projects"
        description="A project carries the client's project ID, the general scope, deliverable defaults and its own work order counter."
      />

      {canManage ? (
        <NewProjectPanel
          clients={clients.map((client) => ({
            id: client.id,
            label: client.name,
          }))}
          customers={customers.map((customer) => ({
            id: customer.id,
            label: `${customer.name} (${customer.code})`,
          }))}
          managers={managers.map((manager) => ({
            id: manager.id,
            label: `${manager.name} · ${manager.baseRole}`,
          }))}
          contacts={contacts}
        />
      ) : null}

      {projects.length === 0 ? (
        <EmptyState
          title="No projects yet"
          description="Jobs can be created without a project — they just draw from the global yearly counter instead."
        />
      ) : null}

      <div className="flex flex-col gap-3">
        {projects.map((project) => (
          <Link key={project.id} href={`/projects/${project.id}`}>
            <Card className="transition-colors hover:border-primary/50">
              <CardContent className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-semibold">
                      {project.name}
                    </span>
                    <Badge variant={STATUS_VARIANT[project.status]}>
                      {project.status.replace("_", " ")}
                    </Badge>
                  </div>
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">
                    {project.client.name}
                    {project.customer ? ` · ${project.customer.code}` : ""} ·
                    ID {project.externalProjectId || NO_PROJECT_REF} ·{" "}
                    {project._count.jobs} job
                    {project._count.jobs === 1 ? "" : "s"} · next WO #
                    {String(project.intWoCounter + 1).padStart(4, "0")}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">
                    PM: {project.manager?.name ?? "not set"} ·{" "}
                    {project._count.members} member
                    {project._count.members === 1 ? "" : "s"}
                  </div>
                </div>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
