import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { NAV_ICONS, splitNav } from "@/components/nav-icons";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { buildNavItems } from "@/lib/nav";
import { getSessionUser } from "@/lib/session";

export const metadata = { title: "More" };

// Reached only from the phone tab bar, which folds anything past the fourth
// destination in here rather than shrinking every tab.
export default async function MorePage() {
  const user = await getSessionUser();
  if (!user) redirect("/signin");

  // Only what the tab bar does not already hold: repeating Jobs here is a
  // second place to look for something that never moved.
  const { overflow } = splitNav(buildNavItems(user));

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 md:hidden">
      <PageHeader title="More" />

      <div className="flex flex-col gap-2">
        {overflow.map((item) => {
          const Icon = NAV_ICONS[item.icon];
          return (
            <Link key={item.href} href={item.href}>
              <Card className="transition-colors hover:border-primary/50">
                <CardContent className="flex items-center gap-3 p-3">
                  <Icon className="size-5 shrink-0 text-primary" />
                  <span className="flex-1 text-sm font-medium">
                    {item.label}
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
