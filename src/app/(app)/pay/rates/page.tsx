import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { db } from "@/lib/db";
import { reportIds } from "@/lib/scope";
import { getSessionUser, permissionScope } from "@/lib/session";
import { RateEditor } from "./rate-editor";

export const metadata = { title: "Pay rates" };

export default async function RatesPage() {
  const viewer = await getSessionUser();
  if (!viewer) redirect("/signin");

  const scope = permissionScope(viewer, "pay.edit_rates");
  if (!scope || scope === "OWN") redirect("/pay");

  const editableIds =
    scope === "ALL" ? null : [viewer.id, ...(await reportIds(viewer.id))];

  const [users, projects, clients] = await Promise.all([
    db.user.findMany({
      where: editableIds === null ? { active: true } : { id: { in: editableIds } },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        baseRole: true,
        defaultPayType: true,
        defaultPayRate: true,
        payRates: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            payType: true,
            rate: true,
            travelReimbursement: true,
            note: true,
            project: { select: { id: true, name: true } },
            client: { select: { id: true, name: true } },
          },
        },
      },
    }),
    db.project.findMany({
      where: { status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.client.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <PageHeader
        title="Pay rates"
        backHref="/pay"
        description="Most specific wins: a per-job override, then project, then client, then the tech's default. Travel money is set per job or project — never as a personal default."
      />

      {users.map((user) => (
        <RateEditor
          key={user.id}
          user={{
            id: user.id,
            name: user.name,
            baseRole: user.baseRole,
            defaultPayType: user.defaultPayType,
            defaultPayRate: user.defaultPayRate?.toString() ?? "",
          }}
          rates={user.payRates.map((rate) => ({
            id: rate.id,
            payType: rate.payType,
            rate: rate.rate.toString(),
            travelReimbursement: rate.travelReimbursement?.toString() ?? null,
            note: rate.note,
            scopeLabel: rate.project
              ? `Project · ${rate.project.name}`
              : rate.client
                ? `Company · ${rate.client.name}`
                : "Default",
          }))}
          projects={projects}
          clients={clients}
        />
      ))}
    </div>
  );
}
