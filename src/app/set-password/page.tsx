import { redirect } from "next/navigation";
import { CompanyMark } from "@/components/company-mark";
import { Card, CardContent } from "@/components/ui/card";
import { brandLine } from "@/lib/company";
import { db } from "@/lib/db";
import { hashSetupToken } from "@/lib/password";
import { getSessionUser } from "@/lib/session";
import { SetPasswordForm } from "./form";

export const metadata = { title: "Set a password" };

/**
 * Where somebody chooses their own password.
 *
 * Two ways to arrive, and both end up here rather than in two half-similar
 * pages: a one-time link from an administrator, or already signed in with a
 * password that administrator typed for them and which they are being made to
 * replace. The second is why this sits outside the app shell — the shell would
 * otherwise send them back here from wherever they tried to go.
 */
export default async function SetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  const company = await db.companySettings
    .findUnique({
      where: { id: "singleton" },
      select: { name: true, logoUrl: true },
    })
    .catch(() => null);

  const viewer = token ? null : await getSessionUser();

  // Neither a link nor a signed-in account being forced to change: there is
  // nothing for this page to act on.
  if (!token && !viewer) redirect("/signin");

  const invited = token
    ? await db.passwordSetupToken.findUnique({
        where: { tokenHash: hashSetupToken(token) },
        select: {
          expiresAt: true,
          usedAt: true,
          user: { select: { name: true, email: true, active: true } },
        },
      })
    : null;

  const linkIsGood =
    invited && !invited.usedAt && invited.expiresAt > new Date() && invited.user.active;

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 p-6">
      <div className="flex flex-col items-center gap-3">
        <CompanyMark
          logoUrl={company?.logoUrl}
          name={company?.name}
          className="size-16 rounded-xl text-2xl"
        />
        <h1 className="text-xl font-semibold">{brandLine(company?.name)}</h1>
      </div>

      <Card className="w-full max-w-sm">
        <CardContent className="flex flex-col gap-4">
          {token && !linkIsGood ? (
            <p className="text-sm text-danger">
              This link has been used already or has expired. Ask whoever set
              your account up for a new one.
            </p>
          ) : (
            <>
              <div>
                <h2 className="text-base font-semibold">
                  {token ? "Choose a password" : "Choose a new password"}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {token
                    ? `For ${invited!.user.email}. The link stops working once you have.`
                    : "The one you have was set by somebody else, so it is not yours yet."}
                </p>
              </div>

              <SetPasswordForm token={token ?? null} />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
