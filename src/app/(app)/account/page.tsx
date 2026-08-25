import { LogOut } from "lucide-react";
import { redirect } from "next/navigation";
import { signOut } from "@/auth";
import { ThemeToggle } from "@/components/theme";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { timeZoneLabel } from "@/lib/us-regions";
import { ContactForm } from "./contact-form";

export const metadata = { title: "Your account" };

const ROLE_LABEL: Record<string, string> = {
  ADMINISTRATOR: "Administrator",
  MANAGER: "Manager",
  SUPERVISOR: "Supervisor",
  TECH: "Tech",
  ACCOUNTANT: "Accountant",
};

/**
 * Everything that belongs to the person rather than the company.
 *
 * The theme lives here rather than in the header: it is set once and then
 * never again, so a permanent control on every screen was three taps of dead
 * space on a phone.
 */
export default async function AccountPage() {
  const user = await getSessionUser();
  if (!user) redirect("/signin");

  const [supervisor, details] = await Promise.all([
    user.directSupervisorId
      ? db.user.findUnique({
          where: { id: user.directSupervisorId },
          select: { name: true, email: true },
        })
      : null,
    db.user.findUniqueOrThrow({
      where: { id: user.id },
      select: {
        legalName: true,
        phone: true,
        addressLine1: true,
        addressLine2: true,
        city: true,
        state: true,
        postalCode: true,
        country: true,
      },
    }),
  ]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <PageHeader
        title="Your account"
        description="Your name and email come from NextCloud. Your contact details are yours to change; the rest is a manager's."
      />

      <Card>
        <CardHeader>
          <CardTitle>{user.name}</CardTitle>
          <CardDescription>{user.email}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <Row label="Role" value={ROLE_LABEL[user.baseRole] ?? user.baseRole} />
          {/* Only worth a line when it differs — for most people the name the
              app uses is the name on the paperwork. */}
          {details.legalName && details.legalName !== user.name ? (
            <Row label="Legal name" value={details.legalName} />
          ) : null}
          <Row label="Time zone" value={timeZoneLabel(user.timeZone)} />
          <Row
            label="Direct supervisor"
            value={
              supervisor
                ? `${supervisor.name} · ${supervisor.email}`
                : "not set — payroll needs one"
            }
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Contact details</CardTitle>
          <CardDescription>
            Yours to keep current — people move, and an address that has to go
            through somebody else is an address that stays wrong. Your name,
            role, rate and supervisor are not here: those are a manager&rsquo;s.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ContactForm contact={details} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
          <CardDescription>
            Dark is the default and what the app is designed for. Kept on this
            device only.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ThemeToggle />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sign out</CardTitle>
          <CardDescription>
            Signing back in asks NextCloud for your password again, so a shared
            phone does not stay signed in as you.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/signin?reauth=1" });
            }}
          >
            <Button type="submit" variant="danger">
              <LogOut /> Sign out
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}
