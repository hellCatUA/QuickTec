/**
 * Startup configuration check.
 *
 * Auth.js swallows a malformed provider config and simply returns an empty
 * session, so a missing NEXTCLOUD_ISSUER shows up as "everyone is signed out"
 * with nothing in the logs to explain it. Checking explicitly at boot turns
 * that into one obvious line.
 */

const REQUIRED = [
  "DATABASE_URL",
  "AUTH_SECRET",
  "AUTH_URL",
  "NEXTCLOUD_ISSUER",
  "NEXTCLOUD_CLIENT_ID",
  "NEXTCLOUD_CLIENT_SECRET",
] as const;

export type ConfigProblem = { key: string; message: string };

export function findConfigProblems(): ConfigProblem[] {
  const problems: ConfigProblem[] = [];

  for (const key of REQUIRED) {
    if (!process.env[key]) {
      problems.push({ key, message: `${key} is not set` });
    }
  }

  const authUrl = process.env.AUTH_URL;
  if (authUrl && !/^https?:\/\//.test(authUrl)) {
    problems.push({
      key: "AUTH_URL",
      message: "AUTH_URL must be an absolute URL, e.g. https://quicktec.example.org",
    });
  }

  const secret = process.env.AUTH_SECRET;
  if (secret && secret.length < 32) {
    problems.push({
      key: "AUTH_SECRET",
      message:
        "AUTH_SECRET is shorter than 32 characters — generate one with `openssl rand -base64 32`",
    });
  }

  return problems;
}

export type DiscoveryProbe = {
  url: string;
  ok: boolean;
  /** Short, human-readable. "HTTP 404", "server unreachable". */
  detail: string;
  /** The issuer the document claims, when it returned one. */
  issuer?: string;
};

/**
 * Asks NextCloud for its discovery document, the way Auth.js does.
 *
 * Run only when sign-in has already failed with a configuration error. Auth.js
 * reports that failure as an opaque `error=Configuration`, and the difference
 * between "the container cannot resolve the name", "the app is not installed"
 * and "the issuer has a trailing slash" is otherwise invisible from the screen.
 */
export async function probeDiscovery(
  url: string,
  expectedIssuer: string,
): Promise<DiscoveryProbe> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      return {
        url,
        ok: false,
        detail: `HTTP ${response.status} — is the OpenID Connect provider app installed?`,
      };
    }

    const document = (await response.json()) as { issuer?: string };
    const issuer = document.issuer;

    if (!issuer) {
      return { url, ok: false, detail: "the response is not a discovery document" };
    }
    if (expectedIssuer && issuer.replace(/\/+$/, "") !== expectedIssuer) {
      return {
        url,
        ok: false,
        issuer,
        detail: `it identifies as ${issuer}, but NEXTCLOUD_ISSUER is ${expectedIssuer}`,
      };
    }

    return { url, ok: true, issuer, detail: "reachable" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      url,
      ok: false,
      detail:
        /timed out|abort/i.test(message)
          ? "no answer within 5 seconds"
          : `not reachable from the app container (${message})`,
    };
  }
}

let reported = false;

/** Logs once per process. Never throws — a half-configured app should still
 *  boot far enough to show the sign-in page and its error banner. */
export function reportConfigProblems(): ConfigProblem[] {
  const problems = findConfigProblems();

  if (!reported && problems.length > 0) {
    reported = true;
    console.error(
      "\n[quicktec] Configuration problems detected:\n" +
        problems.map((p) => `  - ${p.message}`).join("\n") +
        "\n  Sign-in will not work until these are fixed in .env / docker-compose.yml.\n",
    );
  }

  return problems;
}
