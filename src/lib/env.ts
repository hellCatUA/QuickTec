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
  /** False when this alone explains why sign-in cannot start. */
  ok: boolean;
  /** Headline: the one thing to fix, or "reachable". */
  detail: string;
  /** Everything else worth knowing, fatal or not. */
  notes: string[];
};

type DiscoveryDocument = {
  issuer?: string;
  authorization_endpoint?: string;
  token_endpoint?: string;
  jwks_uri?: string;
  scopes_supported?: string[];
  id_token_signing_alg_values_supported?: string[];
  code_challenge_methods_supported?: string[];
};

/** The scopes QuickTec asks for. `roles` is the one that carries groups. */
const WANTED_SCOPES = ["openid", "profile", "email", "roles"];

/**
 * Asks NextCloud for its discovery document and checks it the way the OIDC
 * client does.
 *
 * Run only when sign-in has already failed. Auth.js collapses every one of
 * these into `error=Configuration`, so the screen cannot otherwise tell apart
 * "the container cannot resolve the name", "the app is not installed", "the
 * issuer has a trailing slash" and "the document is missing the endpoint the
 * sign-in URL is built from".
 */
export async function probeDiscovery(
  url: string,
  expectedIssuer: string,
): Promise<DiscoveryProbe> {
  const notes: string[] = [];

  let response: Response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      headers: { Accept: "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      url,
      ok: false,
      notes,
      detail: /timed out|abort/i.test(message)
        ? "no answer within 5 seconds"
        : `not reachable from the app container (${message})`,
    };
  }

  if (!response.ok) {
    return {
      url,
      ok: false,
      notes,
      detail: `HTTP ${response.status} — is the OpenID Connect provider app installed?`,
    };
  }

  // The OIDC client rejects a discovery document that is not served as JSON,
  // even when the body itself is perfectly valid — so this is fatal, not a
  // remark.
  const contentType = response.headers.get("content-type") ?? "";
  const wrongContentType = !/\bapplication\/json\b/i.test(contentType);
  if (wrongContentType) {
    notes.push(
      `served as "${contentType || "no content-type"}" — the client requires application/json`,
    );
  }

  let document: DiscoveryDocument;
  try {
    document = (await response.json()) as DiscoveryDocument;
  } catch {
    return {
      url,
      ok: false,
      notes,
      detail: "the response is not JSON — something else is answering this URL",
    };
  }

  if (!document.issuer) {
    return {
      url,
      ok: false,
      notes,
      detail: "no issuer in the response — this is not a discovery document",
    };
  }

  if (expectedIssuer && document.issuer.replace(/\/+$/, "") !== expectedIssuer) {
    return {
      url,
      ok: false,
      notes,
      detail: `it identifies as ${document.issuer}, but NEXTCLOUD_ISSUER is ${expectedIssuer}`,
    };
  }

  // Without these there is nothing to redirect to and nothing to exchange the
  // code against, which is exactly what fails before the browser ever leaves.
  const missing = (
    ["authorization_endpoint", "token_endpoint", "jwks_uri"] as const
  ).filter((key) => !document[key]);

  if (missing.length > 0) {
    return {
      url,
      ok: false,
      notes,
      detail: `the document has no ${missing.join(" and no ")}`,
    };
  }

  // Not fatal on their own, but each one breaks a later step, and each is
  // cheaper to notice here than after three more sign-in attempts.
  const scopes = document.scopes_supported;
  if (scopes) {
    const unsupported = WANTED_SCOPES.filter((scope) => !scopes.includes(scope));
    if (unsupported.length > 0) {
      notes.push(
        `does not advertise the ${unsupported.join(", ")} scope${unsupported.length === 1 ? "" : "s"}` +
          (unsupported.includes("roles")
            ? " — without roles, no NextCloud group reaches QuickTec and every sign-in is refused"
            : ""),
      );
    }
  }

  const algs = document.id_token_signing_alg_values_supported;
  if (algs && !algs.includes("RS256")) {
    notes.push(
      `signs ID tokens with ${algs.join(", ")} rather than RS256 — set the client to RS256 in NextCloud`,
    );
  }

  return {
    url,
    ok: !wrongContentType,
    notes,
    detail: wrongContentType
      ? "the document itself is fine, but it is not served as JSON"
      : "reachable, and the document checks out",
  };
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
