// Scheduled background job — pre-warms the geocode cache (shared with
// src/lib/ddf.ts, same Blobs store/key convention) for every active London
// listing across all brokerages, so the "browse by neighbourhood, all
// brokerages" pages are always fast instead of geocoding hundreds of
// addresses live on someone's first page load.
//
// Runs standalone (not through Astro/Vite), so it can't use import.meta.env
// like the rest of the DDF code does — reads process.env directly and
// duplicates the minimal fetch/geocode logic instead of importing
// src/lib/ddf.ts, to avoid any risk to the already-working site code.
import { getStore } from '@netlify/blobs';

const DDF_ACCESS_TOKEN = process.env.DDF_ACCESS_TOKEN;
const DDF_API_BASE_URL = process.env.DDF_API_BASE_URL;
const GOOGLE_GEOCODING_API_KEY = process.env.GOOGLE_GEOCODING_API_KEY;
const DDF_NATIONAL_USERNAME = process.env.DDF_NATIONAL_USERNAME;
const DDF_NATIONAL_PASSWORD = process.env.DDF_NATIONAL_PASSWORD;
const CONCURRENCY = 15;

async function odataGet(resource, params) {
  const url = new URL(`${DDF_API_BASE_URL}${resource}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${DDF_ACCESS_TOKEN}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`${resource} -> HTTP ${res.status}: ${await res.text().catch(() => '')}`);
  return res.json();
}

// National Pool (CREA's own ddfapi.realtor.ca) — a free source of real
// Latitude/Longitude that AMPRE never populates. Every match here is one
// fewer paid Google Geocoding call. Join key confirmed empirically: this
// feed's `ListingId` equals AMPRE's `ListingKey` (e.g. "X12367294") — the
// two systems' own `ListingKey` values are unrelated internal IDs.
//
// Filters by `OriginatingSystemName` (the LSTAR board), not by City or a
// UnparsedAddress substring: National Pool is Canada-wide, so
// `contains(UnparsedAddress,'London')` mostly matches unrelated "London
// Road"/"London Street" addresses in other cities within the API's 100-row
// page cap, drowning out genuine London, Ontario matches. Filtering by
// originating board gets the real ~4,600-listing LSTAR pool (77% overlap
// with AMPRE's active London listings, verified 2026-07-16).
const NATIONAL_ORIGINATING_SYSTEM = 'London and St. Thomas Association of REALTORS®';
const NATIONAL_PAGE_SIZE = 100;
const NATIONAL_PAGE_CONCURRENCY = 10;

async function fetchNationalPage(token, skip) {
  const url = new URL('https://ddfapi.realtor.ca/odata/v1/Property');
  url.searchParams.set('$filter', `OriginatingSystemName eq '${NATIONAL_ORIGINATING_SYSTEM}'`);
  url.searchParams.set('$select', 'ListingId,Latitude,Longitude,StandardStatus');
  url.searchParams.set('$top', String(NATIONAL_PAGE_SIZE));
  url.searchParams.set('$skip', String(skip));
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  if (!res.ok) return [];
  const data = await res.json();
  return data.value || [];
}

async function getNationalGeoMap() {
  const map = new Map();
  if (!DDF_NATIONAL_USERNAME || !DDF_NATIONAL_PASSWORD) return map;

  try {
    const tokenRes = await fetch('https://identity.crea.ca/connect/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: DDF_NATIONAL_USERNAME,
        client_secret: DDF_NATIONAL_PASSWORD,
        grant_type: 'client_credentials',
        scope: 'DDFApi_Read',
      }),
    });
    if (!tokenRes.ok) return map;
    const { access_token } = await tokenRes.json();
    if (!access_token) return map;

    const addRows = (rows) => {
      for (const row of rows) {
        if (row.StandardStatus === 'Active' && row.Latitude && row.Longitude && row.ListingId) {
          map.set(String(row.ListingId).toLowerCase(), { lat: Number(row.Latitude), lng: Number(row.Longitude) });
        }
      }
    };

    const firstUrl = new URL('https://ddfapi.realtor.ca/odata/v1/Property');
    firstUrl.searchParams.set('$filter', `OriginatingSystemName eq '${NATIONAL_ORIGINATING_SYSTEM}'`);
    firstUrl.searchParams.set('$select', 'ListingId,Latitude,Longitude,StandardStatus');
    firstUrl.searchParams.set('$top', String(NATIONAL_PAGE_SIZE));
    firstUrl.searchParams.set('$count', 'true');
    const firstRes = await fetch(firstUrl, { headers: { Authorization: `Bearer ${access_token}`, Accept: 'application/json' } });
    if (!firstRes.ok) return map;
    const firstData = await firstRes.json();
    addRows(firstData.value || []);
    const total = Number(firstData['@odata.count'] || firstData.value?.length || 0);

    const remainingSkips = [];
    for (let skip = NATIONAL_PAGE_SIZE; skip < total; skip += NATIONAL_PAGE_SIZE) remainingSkips.push(skip);

    for (let i = 0; i < remainingSkips.length; i += NATIONAL_PAGE_CONCURRENCY) {
      const batch = remainingSkips.slice(i, i + NATIONAL_PAGE_CONCURRENCY);
      const pages = await Promise.all(batch.map((skip) => fetchNationalPage(access_token, skip)));
      for (const rows of pages) addRows(rows);
    }
  } catch {
    // National Pool unavailable — every listing just falls through to Google below.
  }
  return map;
}

async function geocodeGoogle(address) {
  try {
    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    url.searchParams.set('address', `${address}, Ontario, Canada`);
    url.searchParams.set('key', GOOGLE_GEOCODING_API_KEY);
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

export default async () => {
  if (!DDF_ACCESS_TOKEN || !DDF_API_BASE_URL || !GOOGLE_GEOCODING_API_KEY) {
    console.error('warm-geocode-cache: missing required env vars');
    return new Response('Missing required env vars', { status: 500 });
  }

  const store = getStore('ddf-geocode-cache');

  const [data, nationalGeoMap] = await Promise.all([
    odataGet('Property', {
      $filter: `contains(UnparsedAddress,'London')`,
      $select: 'ListingKey,UnparsedAddress,StandardStatus,PropertyType,TransactionType',
      $top: '5000',
    }),
    getNationalGeoMap(),
  ]);
  const all = data.value || [];
  const active = all.filter(
    (l) => l.StandardStatus === 'Active' && l.PropertyType !== 'Commercial' && l.TransactionType !== 'For Lease'
  );

  console.log(`warm-geocode-cache: ${active.length} active London listings to check (of ${all.length} fetched), ${nationalGeoMap.size} National Pool coordinates available`);

  let fromNationalPool = 0;
  let geocoded = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < active.length; i += CONCURRENCY) {
    const batch = active.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (listing) => {
        const address = listing.UnparsedAddress;
        if (!address) return;
        const cached = await store.get(address, { type: 'json' }).catch(() => null);
        if (cached) {
          skipped++;
          return;
        }
        const national = nationalGeoMap.get(String(listing.ListingKey || '').toLowerCase());
        if (national) {
          await store.setJSON(address, national);
          fromNationalPool++;
          return;
        }
        const geo = await geocodeGoogle(address);
        if (geo) {
          await store.setJSON(address, geo);
          geocoded++;
        } else {
          failed++;
        }
      })
    );
  }

  const summary = `warm-geocode-cache done: ${fromNationalPool} from National Pool (free), ${geocoded} newly geocoded via Google, ${skipped} already cached, ${failed} failed`;
  console.log(summary);
  return new Response(summary);
};

export const config = {
  schedule: '0 8 * * *', // daily, 8am UTC (~3-4am Eastern depending on DST)
};
