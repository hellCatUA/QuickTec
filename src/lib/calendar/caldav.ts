/**
 * A small CalDAV client, enough for one-way push.
 *
 * Deliberately not a general library: this only has to provision a calendar,
 * write an event and remove one. NextCloud is the only server it talks to, and
 * a system account owns every calendar so there is no per-user credential to
 * juggle.
 */

export type CalDavConfig = {
  /** e.g. https://cloud.417group.org */
  baseUrl: string;
  /** The 417-SYS system account. */
  username: string;
  /** An app password, not the account password. */
  password: string;
};

export type CalDavResult = {
  ok: boolean;
  /** Zero when the request never reached the server. */
  status: number;
  body?: string;
};

/** A failure in a form worth showing someone: "HTTP 401", "fetch failed". */
export function describeFailure(result: CalDavResult): string {
  if (result.status === 0) return result.body || "server unreachable";
  return `HTTP ${result.status}`;
}

function authHeader(config: CalDavConfig): string {
  const token = Buffer.from(
    `${config.username}:${config.password}`,
    "utf8",
  ).toString("base64");
  return `Basic ${token}`;
}

/** The system account's calendar home on a NextCloud install. */
export function calendarHome(config: CalDavConfig): string {
  return `${config.baseUrl.replace(/\/$/, "")}/remote.php/dav/calendars/${encodeURIComponent(
    config.username,
  )}`;
}

export function calendarUrl(config: CalDavConfig, slug: string): string {
  return `${calendarHome(config)}/${encodeURIComponent(slug)}`;
}

/**
 * A calendar id NextCloud will accept: lowercase, no spaces, stable for a
 * given tech so re-running provisioning is a no-op.
 */
export function calendarSlug(email: string): string {
  return `quicktec-${email.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

async function request(
  config: CalDavConfig,
  method: string,
  url: string,
  options: { body?: string; headers?: Record<string, string> } = {},
): Promise<CalDavResult> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        Authorization: authHeader(config),
        ...options.headers,
      },
      body: options.body,
    });
  } catch (error) {
    // A NextCloud that is down, a DNS failure and a TLS error all land here.
    // Reported like an HTTP failure so one unreachable calendar cannot abort
    // the sweep of everybody else's.
    return {
      ok: false,
      status: 0,
      body: error instanceof Error ? error.message : "network error",
    };
  }

  // Bodies are only read on failure: a successful PUT returns nothing useful
  // and reading it would just add a round trip.
  const body = response.ok ? undefined : await response.text().catch(() => "");

  return { ok: response.ok, status: response.status, body };
}

/**
 * Creates the calendar if it is not already there.
 *
 * MKCALENDAR answers 405 when the collection exists, which is success as far
 * as provisioning is concerned — this runs on every sync and must be cheap and
 * idempotent.
 */
export async function ensureCalendar(
  config: CalDavConfig,
  slug: string,
  displayName: string,
): Promise<CalDavResult> {
  const url = calendarUrl(config, slug);

  const body = `<?xml version="1.0" encoding="utf-8" ?>
<C:mkcalendar xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:set>
    <D:prop>
      <D:displayname>${escapeXml(displayName)}</D:displayname>
      <C:supported-calendar-component-set>
        <C:comp name="VEVENT"/>
      </C:supported-calendar-component-set>
    </D:prop>
  </D:set>
</C:mkcalendar>`;

  const result = await request(config, "MKCALENDAR", url, {
    body,
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });

  if (result.ok || result.status === 405) {
    return { ok: true, status: result.status };
  }
  return result;
}

export async function putEvent(
  config: CalDavConfig,
  slug: string,
  fileName: string,
  ics: string,
): Promise<CalDavResult> {
  return request(
    config,
    "PUT",
    `${calendarUrl(config, slug)}/${encodeURIComponent(fileName)}`,
    {
      body: ics,
      headers: { "Content-Type": "text/calendar; charset=utf-8" },
    },
  );
}

export async function deleteEvent(
  config: CalDavConfig,
  slug: string,
  fileName: string,
): Promise<CalDavResult> {
  const result = await request(
    config,
    "DELETE",
    `${calendarUrl(config, slug)}/${encodeURIComponent(fileName)}`,
  );

  // Already gone is the outcome we wanted.
  if (result.status === 404) return { ok: true, status: 404 };
  return result;
}

/**
 * Shares a calendar with a NextCloud user, read-only.
 *
 * This is NextCloud's DAV sharing extension rather than plain CalDAV, so it is
 * the one call here that will not work against another server. A supervisor
 * seeing their crew's schedule in their own client is worth the coupling.
 */
export async function shareCalendar(
  config: CalDavConfig,
  slug: string,
  withUsername: string,
): Promise<CalDavResult> {
  const body = `<?xml version="1.0" encoding="utf-8" ?>
<O:share xmlns:D="DAV:" xmlns:O="http://owncloud.org/ns">
  <O:set>
    <D:href>principal:principals/users/${escapeXml(withUsername)}</D:href>
    <O:summary>QuickTec schedule</O:summary>
    <O:read/>
  </O:set>
</O:share>`;

  return request(config, "POST", calendarUrl(config, slug), {
    body,
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Reads the client config from the environment, or null when unconfigured. */
export function calDavConfigFromEnv(): CalDavConfig | null {
  const baseUrl = process.env.NEXTCLOUD_ISSUER;
  const username = process.env.CALDAV_USERNAME;
  const password = process.env.CALDAV_PASSWORD;

  if (!baseUrl || !username || !password) return null;
  return { baseUrl, username, password };
}
