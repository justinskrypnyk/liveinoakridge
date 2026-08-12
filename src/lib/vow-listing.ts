// Live single-record VOW lookups for the /sold-map/[listingKey] detail page.
// Deliberately separate from src/lib/ddf.ts: that module is scoped to
// DDF_ACCESS_TOKEN (active-listings Member/National feeds); this is
// VOW_ACCESS_TOKEN (sold data), a genuinely separate authorization (see
// supabase/schema.sql's comment above vow_sold_listings) -- keeping the two
// token scopes in separate code paths avoids ever accidentally mixing them.
//
// The map/browse view (sold-map.astro, api/sold-listings.json.ts) reads the
// pre-synced Supabase table instead of hitting AMPRE live, since that's a
// viewport query across potentially thousands of rows. This is different:
// exactly one record, so a live fetch (photos included) is cheap and always
// current -- no reason to duplicate every Property field into the sync job's
// narrower Supabase schema just for the rare single-listing detail view.
const VOW_ACCESS_TOKEN = import.meta.env.VOW_ACCESS_TOKEN;
const DDF_API_BASE_URL = import.meta.env.DDF_API_BASE_URL; // same AMPRE OData host as the DDF feed -- confirmed empirically, see project notes

export interface VowSoldListing {
  listingKey: string;
  unparsedAddress: string;
  city: string | null;
  postalCode: string | null;
  streetNumber: string | null;
  streetName: string | null;
  streetSuffix: string | null;
  unitNumber: string | null;
  standardStatus: string | null;
  propertyType: string | null;
  propertySubType: string | null;
  architecturalStyle: string[];
  closePrice: number | null;
  closeDate: string | null;
  listPrice: number | null;
  listingContractDate: string | null;
  daysOnMarket: number | null;
  bedroomsTotal: number | null;
  bedroomsAboveGrade: number | null;
  bedroomsBelowGrade: number | null;
  bathroomsTotalInteger: number | null;
  buildingAreaTotal: number | null;
  yearBuilt: string | null;
  taxAnnualAmount: number | null;
  parkingTotal: number | null;
  coveredSpaces: number | null;
  lotWidth: number | null;
  lotDepth: number | null;
  publicRemarks: string | null;
  listOfficeName: string | null;
}

// Manually built rather than via url.searchParams.set() -- this AMPRE
// deployment only decodes %20 for spaces in $filter values, not the '+'
// that URLSearchParams serializes them as, so any multi-word filter value
// would silently match zero rows. Same fix as src/lib/ddf.ts's odataGet();
// confirmed empirically 2026-08-12. Not currently hit (listingKey/
// ResourceRecordKey filters here are never multi-word), but future-proofing
// against the same silent-failure mode.
async function odataGet(resource: string, params: Record<string, string>) {
  const query = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  const url = `${DDF_API_BASE_URL}${resource}?${query}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${VOW_ACCESS_TOKEN}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`${resource} -> HTTP ${res.status}: ${await res.text().catch(() => '')}`);
  return res.json();
}

const SELECT_FIELDS = [
  'ListingKey', 'UnparsedAddress', 'City', 'PostalCode', 'StreetNumber', 'StreetName', 'StreetSuffix', 'UnitNumber',
  'StandardStatus', 'PropertyType', 'PropertySubType', 'ArchitecturalStyle',
  'ClosePrice', 'CloseDate', 'ListPrice', 'ListingContractDate', 'DaysOnMarket',
  'BedroomsTotal', 'BedroomsAboveGrade', 'BedroomsBelowGrade', 'BathroomsTotalInteger', 'BuildingAreaTotal',
  'YearBuilt', 'TaxAnnualAmount', 'ParkingTotal', 'CoveredSpaces', 'LotWidth', 'LotDepth',
  'PublicRemarks', 'ListOfficeName',
].join(',');

/** Live lookup by exact ListingKey -- contains() not eq(), same AMPRE filter-syntax restriction as everywhere else in this codebase. Verifies the match client-side since contains() could theoretically substring-match a different key. */
export async function getSoldListingByKey(listingKey: string): Promise<VowSoldListing | null> {
  if (!VOW_ACCESS_TOKEN || !DDF_API_BASE_URL) return null;

  let data: { value?: Record<string, unknown>[] };
  try {
    data = await odataGet('Property', {
      $filter: `contains(ListingKey,'${listingKey}')`,
      $select: SELECT_FIELDS,
      $top: '5',
    });
  } catch (err) {
    console.error('getSoldListingByKey failed:', listingKey, err instanceof Error ? err.message : err);
    return null;
  }

  const rows = (data.value || []) as Record<string, unknown>[];
  const row = rows.find((r) => r.ListingKey === listingKey);
  if (!row || row.StandardStatus !== 'Closed') return null;

  return {
    listingKey: row.ListingKey as string,
    unparsedAddress: row.UnparsedAddress as string,
    city: (row.City as string) ?? null,
    postalCode: (row.PostalCode as string) ?? null,
    streetNumber: (row.StreetNumber as string) ?? null,
    streetName: (row.StreetName as string) ?? null,
    streetSuffix: (row.StreetSuffix as string) ?? null,
    unitNumber: (row.UnitNumber as string) ?? null,
    standardStatus: (row.StandardStatus as string) ?? null,
    propertyType: (row.PropertyType as string) ?? null,
    propertySubType: (row.PropertySubType as string) ?? null,
    architecturalStyle: Array.isArray(row.ArchitecturalStyle) ? (row.ArchitecturalStyle as string[]) : [],
    closePrice: Number(row.ClosePrice) || null,
    closeDate: (row.CloseDate as string) ?? null,
    listPrice: Number(row.ListPrice) || null,
    listingContractDate: (row.ListingContractDate as string) ?? null,
    daysOnMarket: Number.isFinite(Number(row.DaysOnMarket)) ? Number(row.DaysOnMarket) : null,
    bedroomsTotal: Number.isFinite(Number(row.BedroomsTotal)) ? Number(row.BedroomsTotal) : null,
    bedroomsAboveGrade: Number.isFinite(Number(row.BedroomsAboveGrade)) ? Number(row.BedroomsAboveGrade) : null,
    bedroomsBelowGrade: Number.isFinite(Number(row.BedroomsBelowGrade)) ? Number(row.BedroomsBelowGrade) : null,
    bathroomsTotalInteger: Number.isFinite(Number(row.BathroomsTotalInteger)) ? Number(row.BathroomsTotalInteger) : null,
    buildingAreaTotal: Number(row.BuildingAreaTotal) || null,
    yearBuilt: (row.YearBuilt as string) ?? null,
    taxAnnualAmount: Number(row.TaxAnnualAmount) || null,
    parkingTotal: Number.isFinite(Number(row.ParkingTotal)) ? Number(row.ParkingTotal) : null,
    coveredSpaces: Number.isFinite(Number(row.CoveredSpaces)) ? Number(row.CoveredSpaces) : null,
    lotWidth: Number(row.LotWidth) || null,
    lotDepth: Number(row.LotDepth) || null,
    publicRemarks: (row.PublicRemarks as string) ?? null,
    listOfficeName: (row.ListOfficeName as string) ?? null,
  };
}

interface MediaRow {
  MediaURL: string;
  MediaCategory: string;
  MediaType: string;
  ImageSizeDescription: string;
  Order: number;
}

/** Full-size (watermarked, per 6.3(c)'s brokerage-attribution requirement -- never the no-watermark variant) photo URLs, ordered. */
export async function getSoldListingPhotos(listingKey: string): Promise<string[]> {
  if (!VOW_ACCESS_TOKEN || !DDF_API_BASE_URL) return [];
  try {
    const data = await odataGet('Media', {
      $filter: `contains(ResourceRecordKey,'${listingKey}')`,
      $select: 'MediaURL,MediaCategory,MediaType,ImageSizeDescription,Order',
      $orderby: 'Order',
      $top: '250',
    });
    const rows = (data.value || []) as MediaRow[];
    const byOrder = new Map<number, string>();
    for (const m of rows) {
      if (m.MediaCategory !== 'Photo' && !m.MediaType?.startsWith('image')) continue;
      if (m.ImageSizeDescription !== 'Large' && m.ImageSizeDescription !== 'Largest') continue;
      if (!byOrder.has(m.Order) || m.ImageSizeDescription === 'Large') byOrder.set(m.Order, m.MediaURL);
    }
    return [...byOrder.keys()].sort((a, b) => a - b).map((o) => byOrder.get(o)!);
  } catch {
    return [];
  }
}
