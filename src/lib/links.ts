/**
 * A link somebody pasted onto a dispatch number: the Zoom or Teams bridge a
 * job is run over.
 *
 * Kept whole, because the rest of it is what gets you into the meeting; shown
 * as its host alone — "zoom.us", "company.zoom.us" — because the rest is a
 * hundred characters nobody reads, and on a phone it pushed the label and the
 * phone number off the row.
 */

const MAX_LENGTH = 2000;

/**
 * The link as stored, with its scheme, or null when it is not a web address.
 *
 * "zoom.us/j/123" is how people paste it, so a missing scheme means https.
 * Only http and https are kept: anything else in an href — `javascript:` above
 * all — is not a meeting, and the field is shown to every tech on the job.
 * Nor is an address that carries a username, which is how "mailto:a@b.com"
 * would otherwise read once https:// is put in front of it.
 */
export function normaliseLink(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  // "zoom" on its own is a word, not an address.
  if (!url.hostname.includes(".")) return null;
  // Measured as stored: writing it out can percent-encode it longer than it
  // was typed, and a link stored past the limit would be refused when shown.
  const href = url.toString();
  return href.length > MAX_LENGTH ? null : href;
}

/** "zoom.us" or "company.zoom.us": the host, subdomains and all, but no "www.". */
export function linkHost(href: string): string {
  try {
    return new URL(href).hostname.replace(/^www\./, "");
  } catch {
    return href;
  }
}
