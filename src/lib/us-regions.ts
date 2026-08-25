/**
 * States, and which clock a ZIP code is on.
 *
 * A job in Dallas showed its times in Los Angeles because somebody had to
 * notice the site was in another zone and go and set it. Nobody does, and the
 * hours are then wrong in a way that is invisible until payroll: 8:00 AM on
 * the screen was 6:00 AM where the tech was standing.
 *
 * The zone is derived from the ZIP rather than typed, because the ZIP is
 * already being entered and the zone is not something anybody wants to think
 * about. It is a starting value, not a claim — a dozen states are split down
 * the middle and the boundary follows county lines rather than ZIP ranges, so
 * whoever knows better can still change it.
 */

export type UsState = { code: string; name: string };

/** The fifty, plus the District and the territories that appear in addresses. */
export const US_STATES: UsState[] = [
  { code: "AL", name: "Alabama" },
  { code: "AK", name: "Alaska" },
  { code: "AZ", name: "Arizona" },
  { code: "AR", name: "Arkansas" },
  { code: "CA", name: "California" },
  { code: "CO", name: "Colorado" },
  { code: "CT", name: "Connecticut" },
  { code: "DE", name: "Delaware" },
  { code: "DC", name: "District of Columbia" },
  { code: "FL", name: "Florida" },
  { code: "GA", name: "Georgia" },
  { code: "HI", name: "Hawaii" },
  { code: "ID", name: "Idaho" },
  { code: "IL", name: "Illinois" },
  { code: "IN", name: "Indiana" },
  { code: "IA", name: "Iowa" },
  { code: "KS", name: "Kansas" },
  { code: "KY", name: "Kentucky" },
  { code: "LA", name: "Louisiana" },
  { code: "ME", name: "Maine" },
  { code: "MD", name: "Maryland" },
  { code: "MA", name: "Massachusetts" },
  { code: "MI", name: "Michigan" },
  { code: "MN", name: "Minnesota" },
  { code: "MS", name: "Mississippi" },
  { code: "MO", name: "Missouri" },
  { code: "MT", name: "Montana" },
  { code: "NE", name: "Nebraska" },
  { code: "NV", name: "Nevada" },
  { code: "NH", name: "New Hampshire" },
  { code: "NJ", name: "New Jersey" },
  { code: "NM", name: "New Mexico" },
  { code: "NY", name: "New York" },
  { code: "NC", name: "North Carolina" },
  { code: "ND", name: "North Dakota" },
  { code: "OH", name: "Ohio" },
  { code: "OK", name: "Oklahoma" },
  { code: "OR", name: "Oregon" },
  { code: "PA", name: "Pennsylvania" },
  { code: "RI", name: "Rhode Island" },
  { code: "SC", name: "South Carolina" },
  { code: "SD", name: "South Dakota" },
  { code: "TN", name: "Tennessee" },
  { code: "TX", name: "Texas" },
  { code: "UT", name: "Utah" },
  { code: "VT", name: "Vermont" },
  { code: "VA", name: "Virginia" },
  { code: "WA", name: "Washington" },
  { code: "WV", name: "West Virginia" },
  { code: "WI", name: "Wisconsin" },
  { code: "WY", name: "Wyoming" },
  { code: "PR", name: "Puerto Rico" },
  { code: "VI", name: "U.S. Virgin Islands" },
  { code: "GU", name: "Guam" },
  { code: "MP", name: "Northern Mariana Islands" },
  { code: "AS", name: "American Samoa" },
];

const STATE_BY_CODE = new Map(US_STATES.map((state) => [state.code, state]));

export function stateName(code: string | null | undefined): string | null {
  if (!code) return null;
  return STATE_BY_CODE.get(code.trim().toUpperCase())?.name ?? null;
}

/**
 * The zones anybody here actually works in, in the order they run west to
 * east — which is how somebody scanning a list expects to find one.
 */
export const US_TIME_ZONES: { value: string; label: string }[] = [
  { value: "Pacific/Honolulu", label: "Hawaii — no daylight saving" },
  { value: "America/Anchorage", label: "Alaska" },
  { value: "America/Los_Angeles", label: "Pacific" },
  { value: "America/Phoenix", label: "Arizona — no daylight saving" },
  { value: "America/Denver", label: "Mountain" },
  { value: "America/Chicago", label: "Central" },
  { value: "America/New_York", label: "Eastern" },
  { value: "America/Puerto_Rico", label: "Atlantic — Puerto Rico, USVI" },
  { value: "Pacific/Guam", label: "Chamorro — Guam, Northern Marianas" },
  { value: "Pacific/Pago_Pago", label: "Samoa" },
  { value: "UTC", label: "UTC" },
];

type ZipRange = { from: number; to: number; zone: string };

/**
 * ZIP prefix to zone, first match wins.
 *
 * Ordered so that the split states come before the block they sit inside:
 * Florida is Eastern except its panhandle, Texas is Central except El Paso,
 * Idaho is Mountain except the northern strip. Written as the exception and
 * then the rule, because that is what it is.
 */
const ZIP_RANGES: ZipRange[] = [
  // --- territories, which share prefixes with nothing else -----------------
  { from: 6, to: 9, zone: "America/Puerto_Rico" },
  { from: 969, to: 969, zone: "Pacific/Guam" },

  // --- the states that straddle a boundary ---------------------------------
  // Florida: the panhandle west of the Apalachicola keeps Central.
  { from: 324, to: 325, zone: "America/Chicago" },
  // Tennessee: Chattanooga, Knoxville and the Tri-Cities are Eastern; the
  // rest of the state, Nashville and Memphis included, is Central.
  { from: 373, to: 374, zone: "America/New_York" },
  { from: 376, to: 379, zone: "America/New_York" },
  { from: 370, to: 385, zone: "America/Chicago" },
  // Kentucky: Louisville and Lexington Eastern, Bowling Green and Paducah
  // Central.
  { from: 420, to: 427, zone: "America/Chicago" },
  // Indiana: the Gary corner and the Evansville corner run on Chicago time.
  { from: 463, to: 464, zone: "America/Chicago" },
  { from: 476, to: 477, zone: "America/Chicago" },
  // Michigan: the western end of the Upper Peninsula.
  { from: 498, to: 499, zone: "America/Chicago" },
  // The western ends of the plains states.
  { from: 577, to: 577, zone: "America/Denver" },
  { from: 586, to: 586, zone: "America/Denver" },
  { from: 677, to: 679, zone: "America/Denver" },
  { from: 691, to: 691, zone: "America/Denver" },
  { from: 693, to: 693, zone: "America/Denver" },
  // Texas: El Paso and Hudspeth counties.
  { from: 798, to: 799, zone: "America/Denver" },
  { from: 885, to: 885, zone: "America/Denver" },
  // Idaho: the panhandle above the Salmon River is Pacific.
  { from: 838, to: 838, zone: "America/Los_Angeles" },

  // --- Eastern --------------------------------------------------------------
  { from: 5, to: 5, zone: "America/New_York" },
  { from: 10, to: 349, zone: "America/New_York" },
  { from: 398, to: 419, zone: "America/New_York" },
  { from: 430, to: 497, zone: "America/New_York" },

  // --- Central --------------------------------------------------------------
  { from: 350, to: 397, zone: "America/Chicago" },
  { from: 500, to: 588, zone: "America/Chicago" },
  { from: 600, to: 693, zone: "America/Chicago" },
  { from: 700, to: 797, zone: "America/Chicago" },

  // --- Mountain -------------------------------------------------------------
  { from: 590, to: 599, zone: "America/Denver" },
  { from: 800, to: 838, zone: "America/Denver" },
  { from: 840, to: 847, zone: "America/Denver" },
  { from: 870, to: 884, zone: "America/Denver" },

  // --- Arizona, which does not move its clocks -----------------------------
  { from: 850, to: 865, zone: "America/Phoenix" },

  // --- Pacific --------------------------------------------------------------
  { from: 889, to: 961, zone: "America/Los_Angeles" },
  { from: 970, to: 994, zone: "America/Los_Angeles" },

  // --- Hawaii and Alaska ----------------------------------------------------
  { from: 967, to: 968, zone: "Pacific/Honolulu" },
  { from: 995, to: 999, zone: "America/Anchorage" },
];

/**
 * Which clock a ZIP code is on, or null when it is not a US ZIP.
 *
 * Takes anything a person might type — five digits, ZIP+4, spaces — and reads
 * the first three, which is as fine-grained as this gets.
 */
export function timeZoneForZip(zip: string | null | undefined): string | null {
  const digits = (zip ?? "").replace(/\D/g, "");
  if (digits.length < 5) return null;

  // American Samoa is one ZIP sitting inside Hawaii's prefix.
  if (digits.startsWith("96799")) return "Pacific/Pago_Pago";

  const prefix = Number(digits.slice(0, 3));
  if (!Number.isFinite(prefix)) return null;

  const match = ZIP_RANGES.find(
    (range) => prefix >= range.from && prefix <= range.to,
  );
  return match?.zone ?? null;
}

/** How a zone reads in a sentence: "Central", "Arizona — no daylight saving". */
export function timeZoneLabel(zone: string | null | undefined): string {
  if (!zone) return "not set";
  return US_TIME_ZONES.find((entry) => entry.value === zone)?.label ?? zone;
}
