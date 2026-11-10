export type AddressParts = {
  addressLine1: string;
  addressLine2?: string | null;
  city: string;
  state: string;
  postalCode: string;
  country?: string | null;
};

/** Single line, as it appears in the "Address:" row of the text report. */
export function formatAddress(address: AddressParts): string {
  const street = [address.addressLine1, address.addressLine2]
    .filter(Boolean)
    .join(" ");
  return `${street}, ${address.city}, ${address.state} ${address.postalCode}`;
}

/**
 * Tapping an address should open turn-by-turn directions.
 *
 * `google.com/maps/search` rather than a geo: or comps: URI because it is the
 * one form that works everywhere — on an iPhone it hands off to the Google Maps
 * app when installed and falls back to Safari when not, and it still opens on
 * a desktop browser.
 */
export function mapsUrl(address: AddressParts): string {
  const query = encodeURIComponent(
    [
      address.addressLine1,
      address.addressLine2,
      address.city,
      address.state,
      address.postalCode,
      address.country,
    ]
      .filter(Boolean)
      .join(", "),
  );

  return `https://www.google.com/maps/search/?api=1&query=${query}`;
}

/** "SBUX #24541" — how the customer and site read in every export. */
export function siteLabel(
  customerCode: string,
  siteNumber: string,
): string {
  return `${customerCode} #${siteNumber}`;
}

/**
 * The same, for a screen: a site whose number nobody has read off the door yet
 * says so, rather than showing the placeholder that stands in for it.
 *
 * The placeholder is there to keep two unnumbered sites apart on the unique
 * key and means nothing to anybody — "SBUX #TBD-3f9a12c0" in a list of jobs
 * reads as a store number, and is one more thing to wonder about on site.
 */
export function siteLabelOnScreen(
  customerCode: string,
  site: { siteNumber: string; numberPending: boolean },
): string {
  return site.numberPending
    ? `${customerCode} — number pending`
    : siteLabel(customerCode, site.siteNumber);
}
