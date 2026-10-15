import { Search } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Avatar } from "@/components/profile/parts";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { EmptyState, PageHeader } from "@/components/ui/page-header";
import { avatarSrc } from "@/lib/avatar";
import { db } from "@/lib/db";
import { levelsFor, loadPrivacySettings, PROFILE_SELECT, shows } from "@/lib/profile";
import { homeRegion, ROLE_LABEL } from "@/lib/profile-format";
import { getSessionUser } from "@/lib/session";

export const metadata = { title: "People" };

/**
 * Everybody at the company, as anybody at the company may see them: the
 * Federated view. Whatever more somebody's supervisor or manager may see is on
 * the person's own page, which asks again for each of them.
 */
export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const viewer = await getSessionUser();
  if (!viewer) redirect("/signin");
  if (viewer.outside) notFound();

  const { q } = await searchParams;
  const query = (q ?? "").trim();

  const [people, settings] = await Promise.all([
    db.user.findMany({
      where: {
        active: true,
        signInMethod: "SSO",
        ...(query ? { name: { contains: query, mode: "insensitive" as const } } : {}),
      },
      orderBy: { name: "asc" },
      select: PROFILE_SELECT,
    }),
    loadPrivacySettings(),
  ]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <PageHeader
        title="People"
        description="Everybody at the company. A profile shows you what its level lets you see; supervisors and managers see more."
      />

      <form className="relative" role="search">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          name="q"
          defaultValue={query}
          placeholder="Find somebody by name"
          aria-label="Find somebody by name"
          className="pl-9"
        />
      </form>

      {people.length === 0 ? (
        <EmptyState title={query ? "Nobody by that name." : "Nobody here yet."} />
      ) : (
        <Card className="overflow-hidden">
          <ul>
            {people.map((person) => {
              const levels = levelsFor(person, settings);
              // Everybody in the list is seen at Federated, the viewer included.
              const show = (field: Parameters<typeof shows>[2]) =>
                person.id === viewer.id || shows(levels, "FEDERATED", field);
              const place = homeRegion({
                city: show("city") ? person.city : null,
                state: show("state") ? person.state : null,
                zip: null,
              });
              return (
                <li key={person.id} className="border-t border-border first:border-t-0">
                  <Link
                    href={person.id === viewer.id ? "/account" : `/people/${person.id}`}
                    className="flex min-h-14 items-center gap-3 px-4 py-2.5 hover:bg-muted"
                  >
                    <Avatar
                      src={show("picture") ? avatarSrc(person.id, person.avatarPath) : null}
                      name={person.name}
                      size={40}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {person.name}
                        {person.id === viewer.id ? (
                          <span className="font-normal text-muted-foreground"> · you</span>
                        ) : null}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {[show("role") ? ROLE_LABEL[person.baseRole] : null, place]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
