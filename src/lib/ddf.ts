// Live DDF/PropTx Amplify Syndication (AMPRE) client — fetches Sutton Group
// Chapman Realty's listings at request time instead of at build time, so the
// site never shows stale/sold listings without needing scheduled rebuilds.
import { getStore } from '@netlify/blobs';
import { findAreaForPoint } from '@/lib/area-boundaries';

const ACCESS_TOKEN = import.meta.env.DDF_ACCESS_TOKEN;
const BASE_URL = import.meta.env.DDF_API_BASE_URL;

// Brokerage-wide feed — matches the CREA "Member Website" definition (own
// brokerage's listings, not the wider market). See project memory for the
// compliance reasoning.
const OFFICE_NAME_CONTAINS = 'Chapman';

const SELECT_FIELDS = [
  'ListingKey', 'ListingId', 'StandardStatus', 'TransactionType',
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

// Photos rarely change while a listing is active, but every page that shows
// listing cards calls this for each card on every request — without caching,
// that's N live AMPRE Media calls on every single click (pagination, area
// filter, price filter), which is the main source of felt slowness on
// /search/. Cached durably in Blobs, same pattern as the geocode cache.
const PHOTO_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

async function fetchPhotos(listingKey: string): Promise<string[]> {
  let store: ReturnType<typeof getStore> | null = null;
  try {
    store = getStore('ddf-photo-cache');
    const cached = await store.get(listingKey, { type: 'json' }) as { urls: string[]; cachedAt: number } | null;
    if (cached && Date.now() - cached.cachedAt < PHOTO_CACHE_TTL_MS) {
      return cached.urls;
    }
  } catch {
    // Blobs unavailable (e.g. local dev without `netlify dev`) — fall through to live fetch, just uncached.
  }

  try {
    const data = await odataGet('Media', {
      $filter: `contains(ResourceRecordKey,'${listingKey}')`,
      $select: 'MediaURL,MediaCategory,MediaType,ImageSizeDescription,MediaObjectID,Order',
      $orderby: 'Order',
      $top: '250',
    });
    const seen = new Set<string>();
    const urls = (data.value || [])
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

    if (store) {
      store.setJSON(listingKey, { urls, cachedAt: Date.now() }).catch(() => {});
    }
    return urls;
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

// Google Geocoding — used for bulk market-wide geocoding (e.g. tagging every
// London-area listing to its real neighbourhood), where Nominatim's 1
// req/sec cap makes a ~2,000-address run impractical. Shares the same Blobs
// cache store as the Nominatim path above — a cached lat/lng is provider-
// agnostic, so addresses already geocoded for Chapman's own feed are reused
// for free, and vice versa.
async function geocodeLiveGoogle(query: string): Promise<{ lat: number; lng: number } | null> {
  const apiKey = import.meta.env.GOOGLE_GEOCODING_API_KEY;
  if (!apiKey) return null;
  try {
    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    url.searchParams.set('address', query);
    url.searchParams.set('key', apiKey);
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status !== 'OK' || !data.results?.[0]) return null;
    const loc = data.results[0].geometry.location;
    return { lat: loc.lat, lng: loc.lng };
  } catch {
    return null;
  }
}

export async function geocodeAddressGoogle(listing: RawListing): Promise<{ lat: number; lng: number } | null> {
  const address = String(listing.UnparsedAddress || '');
  if (!address) return null;

  let store: ReturnType<typeof getStore> | null = null;
  try {
    store = getStore('ddf-geocode-cache');
    const cached = await store.get(address, { type: 'json' });
    if (cached) return cached as { lat: number; lng: number };
  } catch {
    // Blobs unavailable (e.g. local dev without `netlify dev`) — fall through, just uncached.
  }

  const geo = await geocodeLiveGoogle(`${address}, Ontario, Canada`);

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

// Ontario-wide (National Pool) search — separate from the Chapman-only
// Member Website feed above. See project memory for the compliance
// distinction: filtering by brokerage isn't allowed here, only objective
// criteria (location, price, property type).
//
// This AMPRE deployment's OData parser rejects ANY compound `and`/`or`
// filter (confirmed: even two plain numeric comparisons combined fail with
// the same 'Edm.Boolean'/'Edm.Double' type error as the known string-eq
// bug) — only a single top-level condition works. So exactly one filter is
// sent server-side (location text or MLS key via `contains()`); status,
// property type, and price range are all applied client-side afterward,
// same pattern as the Chapman feed's status/commercial filtering above.
const MARKET_PAGE_SIZE = 24;
const MARKET_FETCH_CAP = 500;

export interface MarketSearchParams {
  query: string; // address/city/location text, or an MLS number
  minPrice?: number;
  maxPrice?: number;
  propertyType?: string;
  page?: number;
}

export interface MarketSearchResult {
  listings: RawListing[];
  totalMatching: number;
  page: number;
  pageCount: number;
}

function escapeODataString(s: string): string {
  return s.replace(/'/g, "''");
}

function looksLikeMlsNumber(s: string): boolean {
  return /^[a-z]\d{5,}$/i.test(s.trim());
}

export async function searchMarketListings(params: MarketSearchParams): Promise<MarketSearchResult> {
  const query = params.query.trim();
  const empty: MarketSearchResult = { listings: [], totalMatching: 0, page: 1, pageCount: 0 };
  if (!query || !ACCESS_TOKEN || !BASE_URL) return empty;

  const filter = looksLikeMlsNumber(query)
    ? `contains(ListingKey,'${escapeODataString(query)}')`
    : `contains(UnparsedAddress,'${escapeODataString(query)}')`;

  try {
    const data = await odataGet('Property', {
      $filter: filter,
      $select: SELECT_FIELDS,
      $top: String(MARKET_FETCH_CAP),
    });

    const all: RawListing[] = data.value || [];
    let filtered = all.filter((l) =>
      l.StandardStatus === 'Active' && l.PropertyType !== 'Commercial' && l.TransactionType !== 'For Lease'
    );

    if (params.minPrice) filtered = filtered.filter((l) => (Number(l.ListPrice) || 0) >= params.minPrice!);
    if (params.maxPrice) filtered = filtered.filter((l) => (Number(l.ListPrice) || 0) <= params.maxPrice!);
    if (params.propertyType) {
      const wanted = params.propertyType.toLowerCase();
      filtered = filtered.filter((l) =>
        String(l.PropertySubType || l.PropertyType || '').toLowerCase().includes(wanted)
      );
    }

    const totalMatching = filtered.length;
    const pageCount = Math.max(1, Math.ceil(totalMatching / MARKET_PAGE_SIZE));
    const page = Math.min(Math.max(1, params.page || 1), pageCount);
    const start = (page - 1) * MARKET_PAGE_SIZE;
    const pageSlice = filtered.slice(start, start + MARKET_PAGE_SIZE);

    const enriched = await Promise.all(
      pageSlice.map(async (listing) => {
        const key = String(listing.ListingKey || listing.ListingId);
        const photoUrls = key ? await fetchPhotos(key) : [];
        return { ...listing, _photoUrls: photoUrls, _photoUrl: photoUrls[0] || null };
      })
    );

    return { listings: enriched, totalMatching, page, pageCount };
  } catch (err) {
    console.error('Market search failed:', err instanceof Error ? err.message : err);
    return empty;
  }
}

export async function getMarketListingByKey(key: string): Promise<RawListing | null> {
  if (!ACCESS_TOKEN || !BASE_URL) return null;
  try {
    const data = await odataGet('Property', {
      $filter: `contains(ListingKey,'${escapeODataString(key)}')`,
      $select: SELECT_FIELDS,
      $top: '5',
    });
    const all: RawListing[] = data.value || [];
    const match = all.find((l) => String(l.ListingKey || l.ListingId).toLowerCase() === key.toLowerCase());
    if (!match) return null;
    const photoUrls = await fetchPhotos(key);
    return { ...match, _photoUrls: photoUrls, _photoUrl: photoUrls[0] || null };
  } catch (err) {
    console.error('Market listing lookup failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

// "Browse this neighbourhood, every brokerage" — area pages use this.
// Deliberately never geocodes live: only checks the cache warmed by
// netlify/functions/warm-geocode-cache-background.mjs, so a page load stays
// fast (bounded by cheap Blobs reads) no matter how much of the cache is
// warm. A listing not yet geocoded simply doesn't appear until the next
// scheduled run picks it up — acceptable staleness for a "browse by area"
// page, same spirit as CREA's own 24h-refresh minimum.
let londonCandidatesCache: { data: RawListing[]; fetchedAt: number } | null = null;
const LONDON_CANDIDATES_CACHE_TTL_MS = 10 * 60 * 1000;

async function getCachedGeo(address: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const store = getStore('ddf-geocode-cache');
    const cached = await store.get(address, { type: 'json' });
    return (cached as { lat: number; lng: number }) ?? null;
  } catch {
    return null;
  }
}

async function getLondonCandidates(): Promise<RawListing[]> {
  if (londonCandidatesCache && Date.now() - londonCandidatesCache.fetchedAt < LONDON_CANDIDATES_CACHE_TTL_MS) {
    return londonCandidatesCache.data;
  }
  if (!ACCESS_TOKEN || !BASE_URL) return [];
  try {
    const data = await odataGet('Property', {
      $filter: `contains(UnparsedAddress,'London')`,
      $select: SELECT_FIELDS,
      $top: '5000',
    });
    const all: RawListing[] = data.value || [];
    const active = all.filter(
      (l) => l.StandardStatus === 'Active' && l.PropertyType !== 'Commercial' && l.TransactionType !== 'For Lease'
    );
    londonCandidatesCache = { data: active, fetchedAt: Date.now() };
    return active;
  } catch (err) {
    console.error('London candidates fetch failed:', err instanceof Error ? err.message : err);
    return londonCandidatesCache?.data ?? [];
  }
}

// Every area page independently needs "all London candidates with their
// cached geo" — cache the resolved (post-Blobs-lookup) result in memory so
// only the FIRST area page view in a warm function instance pays for the
// batch of Blobs reads; every other area page load within the TTL just
// filters the already-resolved list (pure JS, no I/O).
let geocodedLondonCache: { data: (RawListing & { _geo: { lat: number; lng: number } })[]; fetchedAt: number } | null = null;
const GEOCODED_LONDON_CACHE_TTL_MS = 10 * 60 * 1000;
const GEOCODE_LOOKUP_CONCURRENCY = 40;

async function getGeocodedLondonListings(): Promise<(RawListing & { _geo: { lat: number; lng: number } })[]> {
  if (geocodedLondonCache && Date.now() - geocodedLondonCache.fetchedAt < GEOCODED_LONDON_CACHE_TTL_MS) {
    return geocodedLondonCache.data;
  }

  const candidates = await getLondonCandidates();
  const results: (RawListing & { _geo: { lat: number; lng: number } })[] = [];

  for (let i = 0; i < candidates.length; i += GEOCODE_LOOKUP_CONCURRENCY) {
    const batch = candidates.slice(i, i + GEOCODE_LOOKUP_CONCURRENCY);
    const resolved = await Promise.all(
      batch.map(async (listing) => {
        const address = String(listing.UnparsedAddress || '');
        if (!address) return null;
        const geo = await getCachedGeo(address);
        return geo ? { ...listing, _geo: geo } : null;
      })
    );
    for (const r of resolved) if (r) results.push(r);
  }

  geocodedLondonCache = { data: results, fetchedAt: Date.now() };
  return results;
}

export async function getAreaMarketListings(areaSlug: string): Promise<RawListing[]> {
  const geocoded = await getGeocodedLondonListings();
  const matches = geocoded.filter((l) => findAreaForPoint(l._geo.lat, l._geo.lng) === areaSlug);

  return Promise.all(
    matches.map(async (listing) => {
      const key = String(listing.ListingKey || listing.ListingId);
      const photoUrls = key ? await fetchPhotos(key) : [];
      return { ...listing, _photoUrls: photoUrls, _photoUrl: photoUrls[0] || null };
    })
  );
}

// "Browse everything, every REALTOR®, then narrow down" — the default view
// on /search/. Unlike getAreaMarketListings, this covers all of London (or
// one area slug if given) plus price/type filters and pagination. Photos are
// only fetched for the current page's grid slice — fetching photos for the
// full ~1,800-listing citywide set on every load would be far too expensive;
// map pins for listings outside the current page simply show the existing
// no-photo fallback in their popup.
const BROWSE_PAGE_SIZE = 24;

export interface LondonBrowseParams {
  areaSlug?: string;
  minPrice?: number;
  maxPrice?: number;
  propertyType?: string;
  page?: number;
}

export interface LondonBrowseResult {
  listings: RawListing[];
  mapListings: RawListing[];
  totalMatching: number;
  page: number;
  pageCount: number;
}

export async function getLondonBrowseListings(params: LondonBrowseParams = {}): Promise<LondonBrowseResult> {
  const geocoded = await getGeocodedLondonListings();
  let filtered: RawListing[] = geocoded;

  if (params.areaSlug) {
    filtered = filtered.filter((l) => findAreaForPoint(l._geo!.lat, l._geo!.lng) === params.areaSlug);
  }
  if (params.minPrice) filtered = filtered.filter((l) => (Number(l.ListPrice) || 0) >= params.minPrice!);
  if (params.maxPrice) filtered = filtered.filter((l) => (Number(l.ListPrice) || 0) <= params.maxPrice!);
  if (params.propertyType) {
    const wanted = params.propertyType.toLowerCase();
    filtered = filtered.filter((l) =>
      String(l.PropertySubType || l.PropertyType || '').toLowerCase().includes(wanted)
    );
  }

  const totalMatching = filtered.length;
  const pageCount = Math.max(1, Math.ceil(totalMatching / BROWSE_PAGE_SIZE));
  const page = Math.min(Math.max(1, params.page || 1), pageCount);
  const start = (page - 1) * BROWSE_PAGE_SIZE;
  const pageSlice = filtered.slice(start, start + BROWSE_PAGE_SIZE);

  const enriched = await Promise.all(
    pageSlice.map(async (listing) => {
      const key = String(listing.ListingKey || listing.ListingId);
      const photoUrls = key ? await fetchPhotos(key) : [];
      return { ...listing, _photoUrls: photoUrls, _photoUrl: photoUrls[0] || null };
    })
  );

  return { listings: enriched, mapListings: filtered, totalMatching, page, pageCount };
}
