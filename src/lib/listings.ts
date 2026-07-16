// Shared helpers for reading raw DDF/RESO-shaped listing records.
// Used by both /properties/ (grid) and /properties/[listingKey]/ (detail page).

export const AREA_SLUGS: Record<string, string> = {
  'Oakridge': 'oakridge', 'West London': 'west-london', 'Whitehills': 'whitehills',
  'Byron': 'byron', 'Westmount': 'westmount', 'Riverbend': 'riverbend', 'Lambeth': 'lambeth',
};

// Flags Justin's own listings inline on /search/ (which mixes every
// brokerage via National Pool) instead of needing a separate URL/page per
// listing. Deliberately NOT a brokerage-name match — National Pool's
// ListOfficeName is set to the *originating board* name, not the real
// brokerage (see src/lib/ddf.ts's National Pool normalizer), so it almost
// never contains "Chapman" even for Justin's own listings. MLS number is
// the one identifier both feeds agree on.
export function ownListingKeySet(chapmanListings: Record<string, unknown>[]): Set<string> {
  return new Set(chapmanListings.map((l) => field(l, 'ListingKey', 'ListingId').toLowerCase()));
}

export function fmtPrice(price: unknown): string {
  const n = Number(price);
  if (!n) return 'Price TBD';
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(n);
}

export function field(listing: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = listing[k];
    if (v !== undefined && v !== null && v !== '') return String(v);
  }
  return '';
}

export function buildAddress(l: Record<string, unknown>): string {
  const unparsed = field(l, 'UnparsedAddress');
  if (unparsed) return unparsed;
  const parts = [
    field(l, 'UnitNumber') ? `${field(l, 'UnitNumber')}-` : '',
    field(l, 'StreetNumber'),
    field(l, 'StreetName'),
    field(l, 'StreetSuffix'),
  ].filter(Boolean);
  return parts.join(' ') || 'Address not available';
}

export function realtorUrl(l: Record<string, unknown>): string {
  const id = field(l, 'ListingId', 'ListingKey');
  if (!id) return 'https://www.realtor.ca';
  return `https://www.realtor.ca/real-estate/${id}`;
}

export function listingSlug(l: Record<string, unknown>): string {
  return field(l, 'ListingKey', 'ListingId').toLowerCase();
}

export function photos(l: Record<string, unknown>): string[] {
  const arr = l._photoUrls;
  return Array.isArray(arr) ? (arr as string[]) : [];
}
