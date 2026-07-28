import { AlertCircle } from "lucide-react";
import { redirect } from "next/navigation";
import { signIn, SIGNIN_ERRORS } from "@/auth";
import { ThemeToggle } from "@/components/theme";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { db } from "@/lib/db";
import { reportConfigProblems } from "@/lib/env";
import { getSessionUser } from "@/lib/session";

export const metadata = { title: "Sign in" };

function errorMessage(code: string | undefined): string | null {
  if (!code) return null;
  if (code in SIGNIN_ERRORS) {
    return SIGNIN_ERRORS[code as keyof typeof SIGNIN_ERRORS];
  }
  if (code === "AccessDenied") {
    return SIGNIN_ERRORS.NoGroup;
  }
  return "Sign-in failed. Please try again, or contact your administrator.";
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; callbackUrl?: string }>;
}) {
  const user = await getSessionUser();
  if (user) redirect("/dashboard");

  const { error, callbackUrl } = await searchParams;
  const message = errorMessage(error);

  // A missing NEXTCLOUD_* variable otherwise presents as a sign-in button that
  // silently does nothing, so say so plainly instead.
  const configProblems = reportConfigProblems();

  const company = await db.companySettings
    .findUnique({
      where: { id: "singleton" },
      select: { name: true, logoUrl: true },
    })
    .catch(() => null);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 p-6">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>

      <div className="flex flex-col items-center gap-3">
        {company?.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={company.logoUrl}
            alt=""
            className="size-14 rounded-xl object-contain"
          />
        ) : (
          <div className="flex size-14 items-center justify-center rounded-xl bg-primary text-2xl font-bold text-primary-foreground">
            Q
          </div>
        )}
        <div className="text-center">
          <h1 className="text-xl font-semibold">
            {company?.name ?? "QuickTec"}
          </h1>
          <p className="text-sm text-muted-foreground">
            Field service time tracking &amp; reporting
          </p>
        </div>
      </div>

      <Card className="w-full max-w-sm">
        <CardContent className="flex flex-col gap-4">
          {message ? (
            <div className="flex items-start gap-2 rounded-lg bg-danger/15 p-3 text-sm text-danger ring-1 ring-inset ring-danger/30">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <span>{message}</span>
            </div>
          ) : null}

          {configProblems.length > 0 ? (
            <div className="flex flex-col gap-1 rounded-lg bg-warning/15 p-3 text-sm text-warning ring-1 ring-inset ring-warning/30">
              <span className="flex items-center gap-2 font-medium">
                <AlertCircle className="size-4 shrink-0" />
                Not configured yet
              </span>
              <ul className="list-inside list-disc text-xs">
                {configProblems.map((problem) => (
                  <li key={problem.key}>{problem.message}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <form
            action={async () => {
              "use server";
              await signIn("nextcloud", {
                redirectTo: callbackUrl ?? "/dashboard",
              });
            }}
          >
            <Button
              type="submit"
              size="lg"
              block
              disabled={configProblems.length > 0}
            >
              Sign in with NextCloud
            </Button>
          </form>

          <p className="text-center text-xs text-muted-foreground">
            Access is granted through NextCloud group membership. If you cannot
            sign in, ask a manager to add you to the right group.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
