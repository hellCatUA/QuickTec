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
