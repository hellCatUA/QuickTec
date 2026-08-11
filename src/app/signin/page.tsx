import { AlertCircle } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { callbackUri, discoveryUrl, signIn, SIGNIN_ERRORS } from "@/auth";
import { CompanyMark } from "@/components/company-mark";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { brandLine } from "@/lib/company";
import { db } from "@/lib/db";
import { probeDiscovery, reportConfigProblems } from "@/lib/env";
import { getSessionUser } from "@/lib/session";
import { PasswordSignIn } from "./password-form";

/** Where the SSO half starts, carrying whatever /signin was asked for. */
function startHref(params: { callbackUrl?: string; reauth?: string }): string {
  const query = new URLSearchParams();
  if (params.callbackUrl) query.set("callbackUrl", params.callbackUrl);
  if (params.reauth === "1") query.set("reauth", "1");
  const search = query.toString();
  return `/api/auth/start${search ? `?${search}` : ""}`;
}

/** Keeps where they were going, and which fork they are on, across a click. */
function signInHref(params: {
  callbackUrl?: string;
  reauth?: string;
  method?: string;
}): string {
  const query = new URLSearchParams();
  if (params.callbackUrl) query.set("callbackUrl", params.callbackUrl);
  if (params.reauth === "1") query.set("reauth", "1");
  if (params.method) query.set("method", params.method);
  const search = query.toString();
  return `/signin${search ? `?${search}` : ""}`;
}

export const metadata = { title: "Sign in" };

function errorMessage(code: string | undefined): string | null {
  if (!code) return null;
  if (code in SIGNIN_ERRORS) {
    return SIGNIN_ERRORS[code as keyof typeof SIGNIN_ERRORS];
  }
  if (code === "AccessDenied") {
    // Deliberately not reported as a group problem. Every reason QuickTec
    // turns somebody away has its own code above; AccessDenied left over
    // means something refused the sign-in without saying why, and the log is
    // the only place that knows.
    return "NextCloud refused the sign-in. The server log says why — ask an administrator to look.";
  }
  if (code === "Configuration") {
    // Not the person's fault and not worth retrying: the server could not
    // complete its own half of the exchange with NextCloud.
    return "QuickTec could not reach NextCloud. This is a server-side problem — retrying will not help.";
  }
  return "Sign-in failed. Please try again, or contact your administrator.";
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    callbackUrl?: string;
    reauth?: string;
    method?: string;
  }>;
}) {
  const user = await getSessionUser();
  if (user) redirect("/dashboard");

  const { error, callbackUrl, reauth, method } = await searchParams;
  const message = errorMessage(error);

  // A missing NEXTCLOUD_* variable otherwise presents as a sign-in button that
  // silently does nothing, so say so plainly instead.
  const configProblems = reportConfigProblems();

  // Not everybody who signs in here works here. A client's coordinator or a
  // subcontractor has no NextCloud account and never will, so the page asks
  // which of the two this is rather than assuming and redirecting. Answering
  // "yes" hands straight over to NextCloud, which is the only thing that page
  // used to do.
  if (method === "sso" && configProblems.length === 0 && !error) {
    const params = new URLSearchParams();
    if (callbackUrl) params.set("callbackUrl", callbackUrl);
    if (reauth === "1") params.set("reauth", "1");
    const query = params.toString();
    redirect(`/api/auth/start${query ? `?${query}` : ""}`);
  }

  // Only after a configuration failure, and only then: Auth.js gives no clue
  // which of half a dozen causes it was, and the answer is one request away.
  const probe =
    error === "Configuration"
      ? await probeDiscovery(
          discoveryUrl(),
          (process.env.NEXTCLOUD_ISSUER ?? "").trim().replace(/\/+$/, ""),
        )
      : null;

  const company = await db.companySettings
    .findUnique({
      where: { id: "singleton" },
      select: { name: true, logoUrl: true },
    })
    .catch(() => null);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 p-6">
      <div className="flex flex-col items-center gap-3">
        <CompanyMark
          logoUrl={company?.logoUrl}
          name={company?.name}
          className="size-16 rounded-xl text-2xl"
        />
        <div className="text-center">
          <h1 className="text-xl font-semibold">{brandLine(company?.name)}</h1>
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

          {probe ? (
            <div className="flex flex-col gap-1.5 rounded-lg bg-warning/15 p-3 text-xs text-warning ring-1 ring-inset ring-warning/30">
              <span className="font-medium">
                {!probe.ok
                  ? "Could not use NextCloud's discovery document"
                  : probe.notes.length > 0
                    ? "NextCloud answers, but its document has problems"
                    : "NextCloud answers correctly — the problem is on this side"}
              </span>
              <code className="break-all">{probe.url}</code>
              <span>{probe.detail}</span>

              {probe.notes.length > 0 ? (
                <ul className="list-inside list-disc">
                  {probe.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              ) : null}

              {probe.ok && probe.notes.length === 0 ? (
                <span>
                  So it is the client credentials or the redirect URI. Compare
                  NEXTCLOUD_CLIENT_ID and NEXTCLOUD_CLIENT_SECRET against the
                  client registered in NextCloud, and check that its redirect
                  URI is exactly{" "}
                  <code className="break-all">{callbackUri()}</code>.
                </span>
              ) : null}

              <span className="text-muted-foreground">
                Full cause in <code>docker compose logs app</code>.
              </span>
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

          {method === "password" ? (
            <>
              <PasswordSignIn callbackUrl={callbackUrl ?? "/dashboard"} />

              <Link
                href={signInHref({ callbackUrl, reauth })}
                className="text-center text-xs text-muted-foreground underline-offset-4 hover:underline"
              >
                Back
              </Link>
            </>
          ) : (
            <>
              <p className="text-center text-sm">
                Do you have a{" "}
                <strong>{company?.name ?? "company"}</strong> SSO account?
              </p>

              {/* A link to the same route the page used to redirect to,
                  rather than its own signIn call: that route is what turns
                  ?reauth=1 into prompt=login, and signing out on a shared van
                  phone has to mean the next person is actually asked who they
                  are. A form action here quietly dropped it. */}
              <Link
                href={startHref({ callbackUrl, reauth })}
                aria-disabled={configProblems.length > 0}
                className={`flex min-h-11 w-full items-center justify-center rounded-lg px-4 text-sm font-medium ${
                  configProblems.length > 0
                    ? "pointer-events-none bg-muted text-muted-foreground"
                    : "bg-primary text-primary-foreground"
                }`}
              >
                Yes — sign in with SSO
              </Link>

              <Link
                href={signInHref({ callbackUrl, reauth, method: "password" })}
                className="flex min-h-11 w-full items-center justify-center rounded-lg border border-border px-4 text-sm font-medium hover:bg-muted"
              >
                No — I have a QuickTec password
              </Link>

              <p className="text-center text-xs text-muted-foreground">
                Staff sign in through NextCloud, where group membership decides
                what they can see. Everyone else uses an account an
                administrator created here.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
