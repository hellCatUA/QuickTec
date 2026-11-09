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
  /** What the server sent back: on failure, or when the answer was asked for. */
  body?: string;
  /** Our own account of it, where the status on its own would mislead. */
  detail?: string;
};

/** A failure in a form worth showing someone: "HTTP 401", "fetch failed". */
export function describeFailure(result: CalDavResult): string {
  if (result.detail) return result.detail;
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
  options: {
    body?: string;
    headers?: Record<string, string>;
    /** Keep a successful answer's body, for the requests whose answer is the point. */
    readBody?: boolean;
  } = {},
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

  // A successful body is read only when asked for: a PUT returns nothing
  // useful and reading it would just add a round trip, while a PROPFIND's
  // answer is the whole point of it. A failure's is truncated because a
  // proxy's error page is a whole HTML document and this gets stored and
  // displayed.
  if (response.ok) {
    const body = options.readBody
      ? await response.text().catch(() => "")
      : undefined;
    return { ok: true, status: response.status, body };
  }

  const body = (await response.text().catch(() => "")).slice(0, 500);
  return { ok: false, status: response.status, body };
}

/**
 * Asks the server whether a collection is really there.
 *
 * PROPFIND is a standard method every proxy passes through, which is the point:
 * it is how a "the calendar exists" claim gets checked rather than inferred
 * from a status code that could have come from anywhere.
 */
export async function collectionExists(
  config: CalDavConfig,
  url: string,
): Promise<CalDavResult> {
  const result = await request(config, "PROPFIND", url, {
    body: `<?xml version="1.0" encoding="utf-8" ?>
<D:propfind xmlns:D="DAV:"><D:prop><D:resourcetype/></D:prop></D:propfind>`,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      Depth: "0",
    },
  });

  // 207 Multi-Status is the answer to a PROPFIND that found something.
  if (result.status === 207) return { ok: true, status: 207 };
  return { ok: false, status: result.status, body: result.body };
}

/** The system account's own calendar list. Reachable means the login works. */
export async function checkAccess(config: CalDavConfig): Promise<CalDavResult> {
  return collectionExists(config, `${calendarHome(config)}/`);
}

/**
 * Creates the calendar if it is not already there.
 *
 * MKCALENDAR is not a method most proxies have heard of, and several answer it
 * with 405 of their own accord — the same status a CalDAV server sends to mean
 * "that collection already exists". Taking 405 at its word is how a calendar
 * that was never created comes to be treated as ready, after which every event
 * written to it fails on its own. Anything other than an outright success is
 * therefore checked with a PROPFIND before it is believed.
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

  if (result.ok) return result;

  const present = await collectionExists(config, url);
  if (present.ok) return { ok: true, status: result.status };

  // Said in full, because the two causes need opposite fixes: a rejected
  // MKCALENDAR is a permissions or account problem on NextCloud, and a
  // rejected MKCALENDAR the server never saw is the proxy in front of it.
  return {
    ok: false,
    status: result.status,
    body: result.body,
    detail: `MKCALENDAR answered ${describeFailure(result)} and the calendar is still not there (PROPFIND: ${describeFailure(present)}). A 405 from a proxy rather than from NextCloud reads the same as "it already exists" — check that MKCALENDAR is passed through.`,
  };
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

/** Where NextCloud keeps a user as somebody things can be shared with. */
export function principalUrl(config: CalDavConfig, username: string): string {
  return `${config.baseUrl.replace(/\/$/, "")}/remote.php/dav/principals/users/${encodeURIComponent(
    username,
  )}/`;
}

/**
 * Looks a NextCloud user up by username.
 *
 * The share request cannot be asked this: NextCloud answers it with success
 * for a username nobody has, and shares with nobody. A PROPFIND on the
 * principal is a 404 when there is no such user, and otherwise carries the
 * address they have in NextCloud — which is what says whether a username
 * guessed from somebody's email is really them.
 */
export async function findPrincipal(
  config: CalDavConfig,
  username: string,
): Promise<
  { found: true; email: string | null } | { found: false; result: CalDavResult }
> {
  const result = await request(config, "PROPFIND", principalUrl(config, username), {
    body: `<?xml version="1.0" encoding="utf-8" ?>
<D:propfind xmlns:D="DAV:" xmlns:S="http://sabredav.org/ns"><D:prop><S:email-address/></D:prop></D:propfind>`,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      Depth: "0",
    },
    readBody: true,
  });

  if (result.status !== 207) return { found: false, result };

  // A user with no address answers with an empty element under a 404
  // propstat, which this does not match: nothing between the tags.
  const email = /<(?:[\w-]+:)?email-address(?:\s[^>]*)?>([^<]+)</i.exec(
    result.body ?? "",
  )?.[1];
  return { found: true, email: email ? unescapeXml(email).trim().toLowerCase() : null };
}

/**
 * The NextCloud usernames a calendar is shared with, lowercased.
 *
 * Read back rather than assumed, for the same reason as findPrincipal: a share
 * NextCloud did not keep — a username it does not have, or a sharing policy
 * that rules the person out — is answered with success all the same.
 */
export async function calendarSharees(
  config: CalDavConfig,
  slug: string,
): Promise<{ ok: true; usernames: Set<string> } | { ok: false; result: CalDavResult }> {
  const result = await request(config, "PROPFIND", calendarUrl(config, slug), {
    body: `<?xml version="1.0" encoding="utf-8" ?>
<D:propfind xmlns:D="DAV:" xmlns:O="http://owncloud.org/ns"><D:prop><O:invite/></D:prop></D:propfind>`,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      Depth: "0",
    },
    readBody: true,
  });

  if (result.status !== 207) return { ok: false, result };

  // Each sharee is a <user> carrying the principal it was shared with.
  const usernames = new Set<string>();
  const users = (result.body ?? "").matchAll(
    /<(?:[\w-]+:)?user(?:\s[^>]*)?>([\s\S]*?)<\/(?:[\w-]+:)?user>/gi,
  );
  for (const [, user] of users) {
    const name = /principal:principals\/users\/([^<]+?)\/?\s*</.exec(user)?.[1];
    if (name) usernames.add(shareKey(unescapeXml(name)));
  }
  return { ok: true, usernames };
}

/**
 * How a username is compared with the ones a calendar is shared with.
 * NextCloud matches usernames without regard to case, and names a share by
 * the user's own spelling rather than the one it was asked for.
 */
export function shareKey(username: string): string {
  let name = username.trim();
  try {
    name = decodeURIComponent(name);
  } catch {
    // Not encoded after all; NextCloud usernames cannot contain a "%".
  }
  return name.toLowerCase();
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function unescapeXml(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (whole, entity: string) => {
    const named: Record<string, string> = {
      amp: "&",
      lt: "<",
      gt: ">",
      quot: '"',
      apos: "'",
    };
    const lower = entity.toLowerCase();
    if (lower in named) return named[lower];
    const code = lower.startsWith("#x")
      ? Number.parseInt(lower.slice(2), 16)
      : Number.parseInt(lower.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
  });
}

/** Reads the client config from the environment, or null when unconfigured. */
export function calDavConfigFromEnv(): CalDavConfig | null {
  const baseUrl = process.env.NEXTCLOUD_ISSUER;
  const username = process.env.CALDAV_USERNAME;
  const password = process.env.CALDAV_PASSWORD;

  if (!baseUrl || !username || !password) return null;
  return { baseUrl, username, password };
}
