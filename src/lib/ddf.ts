// Live DDF/PropTx Amplify Syndication (AMPRE) client — fetches Sutton Group
// Chapman Realty's listings at request time instead of at build time, so the
// site never shows stale/sold listings without needing scheduled rebuilds.
import { getStore } from '@netlify/blobs';

const ACCESS_TOKEN = import.meta.env.DDF_ACCESS_TOKEN;
const BASE_URL = import.meta.env.DDF_API_BASE_URL;

// Brokerage-wide feed — matches the CREA "Member Website" definition (own
// brokerage's listings, not the wider market). See project memory for the
// compliance reasoning.
const OFFICE_NAME_CONTAINS = 'Chapman';

const SELECT_FIELDS = [
  'ListingKey', 'ListingId', 'StandardStatus',
  'ListPrice', 'UnparsedAddress', 'City', 'CityRegion', 'StateOrProvince', 'PostalCode',
  'Latitude', 'Longitude',
  'BedroomsTotal', 'BedroomsAboveGrade', 'BedroomsBelowGrade',
  'BathroomsTotalInteger',
  'PropertyType', 'PropertySubType', 'ArchitecturalStyle',
  'BuildingAreaTotal', 'BuildingAreaUnits',
  'LotWidth', 'LotDepth', 'LotSizeArea', 'LotSizeAreaUnits',
  'ParkingTotal', 'CoveredSpaces',
  'HeatingYN', 'CoolingYN',
  'YearBuilt',
  'TaxAnnualAmount',
  'PublicRemarks',
  'ListOfficeKey', 'ListOfficeName', 'ListAgentKey',
  'ModificationTimestamp',
].join(',');

export type RawListing = Record<string, unknown> & {
  ListingKey?: string;
  ListingId?: string;
  StandardStatus?: string;
  PropertyType?: string;
  ListOfficeName?: string;
  UnparsedAddress?: string;
  PostalCode?: string;
  _photoUrls?: string[];
  _photoUrl?: string | null;
  _geo?: { lat: number; lng: number } | null;
};

async function odataGet(resource: string, params: Record<string, string>) {
  const url = new URL(`${BASE_URL}${resource}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${resource} -> HTTP ${res.status}: ${body}`);
  }

  return res.json();
}

async function fetchPhotos(listingKey: string): Promise<string[]> {
  try {
    const data = await odataGet('Media', {
      $filter: `contains(ResourceRecordKey,'${listingKey}')`,
      $select: 'MediaURL,MediaCategory,MediaType,ImageSizeDescription,MediaObjectID,Order',
      $orderby: 'Order',
      $top: '250',
    });
    const seen = new Set<string>();
    return (data.value || [])
      .filter((m: any) => m.MediaCategory === 'Photo' || m.MediaType?.startsWith('image'))
      .filter((m: any) => m.ImageSizeDescription === 'Largest') // watermarked full-res — never "LargestNoWatermark"
      .sort((a: any, b: any) => (a.Order ?? 0) - (b.Order ?? 0))
      .filter((m: any) => {
        if (seen.has(m.MediaObjectID)) return false;
        seen.add(m.MediaObjectID);
        return true;
      })
      .map((m: any) => m.MediaURL)
      .filter(Boolean);
  } catch {
    return [];
  }
}

// Geocoding — CREA/AMPRE withholds Latitude/Longitude on listing records, so
// we geocode via Nominatim (OpenStreetMap's free geocoder). Their usage
// policy caps requests at 1/second, far too slow to run live per pageview —
// so results are cached durably in Netlify Blobs and only a genuinely new
// address ever triggers a live geocode call.
async function geocodeLive(query: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'json');
    url.searchParams.set('limit', '1');
    const res = await fetch(url, {
      headers: { 'User-Agent': 'LiveInOakridge/1.0 (info@homeswithjustin.ca)' },
    });
    if (!res.ok) return null;
    const results = await res.json();
    if (!results.length) return null;
    return { lat: Number(results[0].lat), lng: Number(results[0].lon) };
  } catch {
    return null;
  }
}

async function geocodeAddress(listing: RawListing): Promise<{ lat: number; lng: number } | null> {
  if (listing.Latitude && listing.Longitude) {
    return { lat: Number(listing.Latitude), lng: Number(listing.Longitude) };
  }
  const address = String(listing.UnparsedAddress || '');
  if (!address) return null;

  let store: ReturnType<typeof getStore> | null = null;
  try {
    store = getStore('ddf-geocode-cache');
    const cached = await store.get(address, { type: 'json' });
    if (cached) return cached as { lat: number; lng: number };
  } catch {
    // Blobs unavailable (e.g. local dev without `netlify dev`) — fall through to live geocode, just uncached.
  }

  const street = address.split(',')[0];
  const postalCode = String(listing.PostalCode || '');
  let geo = await geocodeLive([street, postalCode, 'Ontario, Canada'].filter(Boolean).join(', '));

  if (!geo) {
    const words = street.trim().split(/\s+/);
    if (words.length > 2 && /^\d+$/.test(words[words.length - 1])) {
      const strippedStreet = words.slice(0, -1).join(' ');
      geo = await geocodeLive([strippedStreet, postalCode, 'Ontario, Canada'].filter(Boolean).join(', '));
    }
  }
  if (!geo && postalCode) {
    geo = await geocodeLive(`${postalCode}, Ontario, Canada`);
  }
  if (!geo) {
    geo = await geocodeLive(address);
  }

  if (geo && store) {
    try {
      await store.setJSON(address, geo);
    } catch {
      // best-effort cache write
    }
  }
  return geo;
}

// Short in-memory cache so concurrent requests hitting the same warm
// function instance don't each re-fetch from AMPRE independently.
let listingsCache: { data: RawListing[]; fetchedAt: number } | null = null;
const LISTINGS_CACHE_TTL_MS = 2 * 60 * 1000;

export async function getActiveListings(): Promise<RawListing[]> {
  if (listingsCache && Date.now() - listingsCache.fetchedAt < LISTINGS_CACHE_TTL_MS) {
    return listingsCache.data;
  }

  if (!ACCESS_TOKEN || !BASE_URL) {
    return [];
  }

  try {
    const data = await odataGet('Property', {
      $filter: `contains(ListOfficeName,'${OFFICE_NAME_CONTAINS}')`,
      $select: SELECT_FIELDS,
      $top: '200',
    });

    const all: RawListing[] = data.value || [];
    // Residential only — this site is branded/marketed as "Homes For Sale,"
    // and commercial lease pricing (e.g. "$20"/sq ft/year) would look broken
    // next to home prices.
    const active = all.filter((l) => l.StandardStatus === 'Active' && l.PropertyType !== 'Commercial');

    const enriched = await Promise.all(
      active.map(async (listing) => {
        const key = String(listing.ListingKey || listing.ListingId);
        const [photoUrls, geo] = await Promise.all([
          key ? fetchPhotos(key) : Promise.resolve([]),
          geocodeAddress(listing),
        ]);
        return { ...listing, _photoUrls: photoUrls, _photoUrl: photoUrls[0] || null, _geo: geo };
      })
    );

    listingsCache = { data: enriched, fetchedAt: Date.now() };
    return enriched;
  } catch (err) {
    console.error('DDF fetch failed:', err instanceof Error ? err.message : err);
    // Serve last-known-good data rather than a broken page if AMPRE hiccups.
    return listingsCache?.data ?? [];
  }
}

export async function getListingByKey(key: string): Promise<RawListing | null> {
  const listings = await getActiveListings();
  const match = listings.find(
    (l) => String(l.ListingKey || l.ListingId).toLowerCase() === key.toLowerCase()
  );
  return match ?? null;
}
