// Scheduled job — pulls Closed (sold) listings via the VOW-scoped AMPRE
// token and writes them to Supabase (supabase/schema.sql's
// vow_sold_listings), powering the gated /sold-map page.
//
// Requires VOW_ACCESS_TOKEN — a SEPARATE authorization from DDF_ACCESS_TOKEN
// (same AMPRE OData endpoint, different token scope: DDF is active-listings
// only, VOW unlocks ClosePrice/CloseDate). See supabase/schema.sql's comment
// above vow_sold_listings for the compliance background.
//
// Pagination cursor, not a single $top fetch: this AMPRE deployment rejects
// EVERY filter operator except contains() (confirmed empirically — even a
// single non-compound `eq`/`ge` filter fails with the same
// "Edm.Boolean"/type-mismatch error the existing DDF code already documents
// for compound filters, see src/lib/ddf.ts's odataGet comment), and $orderby
// is rejected outright. There is no way to ask AMPRE for "recent sold
// listings only" — the only lever available is walking forward through
// $skiptoken pages. Default sort empirically returns oldest
// ModificationTimestamp first, so a single top=N fetch would return only
// decades-old closings forever. Instead the cursor advances a bounded number
// of pages per run and is persisted in Blobs, so repeated daily runs
// gradually walk the entire history forward. Once a run reaches the end (no
// nextLink), the cursor resets to the start — a self-healing cycle that
// also re-visits (and re-upserts, harmlessly) already-synced records rather
// than needing separate "catch new closings" logic.
import { getStore } from '@netlify/blobs';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const VOW_ACCESS_TOKEN = process.env.VOW_ACCESS_TOKEN;
const DDF_API_BASE_URL = process.env.DDF_API_BASE_URL;
const GOOGLE_GEOCODING_API_KEY = process.env.GOOGLE_GEOCODING_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const PAGES_PER_RUN = 15; // ~15 x 500 = 7,500 records/run -- comfortably inside Netlify's background function time budget
const PAGE_SIZE = 500;
// A run was observed hard-hanging for 20+ minutes with zero progress --
// none of this file's fetch() calls had a timeout, so a single unresponsive
// call to Google Geocoding or the AMPRE Media endpoint could block the
// entire invocation indefinitely instead of failing fast and moving on.
const FETCH_TIMEOUT_MS = 15000;
const SELECT_FIELDS =
  'ListingKey,UnparsedAddress,City,StandardStatus,PropertyType,PropertySubType,ClosePrice,CloseDate,ListPrice,BedroomsTotal,BathroomsTotalInteger,BuildingAreaTotal,ParkingTotal,ListingContractDate';

function loadAllAreaBoundaries() {
  const dataPath = fileURLToPath(new URL('../../src/data/area-boundaries.json', import.meta.url));
  const raw = JSON.parse(readFileSync(dataPath, 'utf-8'));
  return raw.features.map((f) => ({
    slug: f.properties.slug,
    name: f.properties.name,
    rings: f.geometry.coordinates,
  }));
}

// Ray casting — point-in-polygon test, mirrors heat-map-snapshot-background.mjs.
function pointInRing(lat, lng, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function findAreaForPoint(polygons, lat, lng) {
  for (const { slug, rings } of polygons) {
    if (rings[0] && pointInRing(lat, lng, rings[0])) return slug;
  }
  return null;
}

async function geocodeGoogle(address) {
  try {
    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    url.searchParams.set('address', `${address}, Ontario, Canada`);
    url.searchParams.set('key', GOOGLE_GEOCODING_API_KEY);
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status !== 'OK' || !data.results?.[0]) return null;
    const loc = data.results[0].geometry.location;
    return { lat: loc.lat, lng: loc.lng };
  } catch {
    return null;
  }
}

// One representative photo per listing -- "Large" size, lowest Order (the
// primary/cover photo). Media entity accepts $orderby fine on this AMPRE
// deployment (unlike Property) -- confirmed empirically.
async function fetchPrimaryPhoto(listingKey) {
  try {
    const url = new URL(`${DDF_API_BASE_URL}Media`);
    url.searchParams.set('$filter', `contains(ResourceRecordKey,'${listingKey}')`);
    url.searchParams.set('$select', 'MediaURL,MediaCategory,MediaType,ImageSizeDescription,Order');
    url.searchParams.set('$orderby', 'Order');
    url.searchParams.set('$top', '10');
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${VOW_ACCESS_TOKEN}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const rows = data.value || [];
    const photo = rows.find((m) => (m.MediaCategory === 'Photo' || m.MediaType?.startsWith('image')) && m.ImageSizeDescription === 'Large')
      || rows.find((m) => m.MediaCategory === 'Photo' || m.MediaType?.startsWith('image'));
    return photo?.MediaURL ?? null;
  } catch {
    return null;
  }
}

async function fetchPage(nextLink) {
  const url = nextLink
    ? new URL(nextLink)
    : (() => {
        const u = new URL(`${DDF_API_BASE_URL}Property`);
        u.searchParams.set('$filter', `contains(UnparsedAddress,'London')`);
        u.searchParams.set('$select', SELECT_FIELDS);
        u.searchParams.set('$top', String(PAGE_SIZE));
        return u;
      })();
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${VOW_ACCESS_TOKEN}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Property fetch failed -> HTTP ${res.status}: ${await res.text().catch(() => '')}`);
  return res.json();
}

export default async () => {
  if (!VOW_ACCESS_TOKEN || !DDF_API_BASE_URL || !GOOGLE_GEOCODING_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('vow-sold-sync: missing required env vars', {
      VOW_ACCESS_TOKEN: !!VOW_ACCESS_TOKEN,
      DDF_API_BASE_URL: !!DDF_API_BASE_URL,
      GOOGLE_GEOCODING_API_KEY: !!GOOGLE_GEOCODING_API_KEY,
      SUPABASE_URL: !!SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: !!SUPABASE_SERVICE_ROLE_KEY,
    });
    return new Response('Missing required env vars', { status: 500 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const geocodeStore = getStore('ddf-geocode-cache'); // shared with the DDF geocode jobs -- same address -> {lat,lng} convention
  const cursorStore = getStore('vow-sold-sync-cursor');
  const polygons = loadAllAreaBoundaries();

  let nextLink = null;
  try {
    nextLink = await cursorStore.get('nextLink', { type: 'text' });
  } catch (err) {
    console.error('vow-sold-sync: cursor read failed:', err.message);
  }
  console.log(`vow-sold-sync: cursor read -> ${nextLink ? `${nextLink.length} chars, starts "${nextLink.slice(0, 60)}"` : '(none/empty)'}`);
  let pagesFetched = 0;
  let closedSeen = 0;
  let upserted = 0;
  let geocodedNew = 0;
  let photosNew = 0;
  let reachedEnd = false;
  let stoppedEarly = false;

  // Netlify background functions are killed outright (~15 min) with no
  // chance to run cleanup code -- a run that's still deep in live
  // geocode/photo lookups when that happens previously lost ALL its
  // progress, because the cursor was only ever saved once at the very end.
  // This wall-clock budget bails out (and checkpoints below) well before
  // that hard kill, and every page now saves its own cursor position as it
  // goes, so a run that stops early -- by budget or by the hard kill --
  // never re-walks pages it already paid the geocode/photo cost for.
  const startedAt = Date.now();
  const TIME_BUDGET_MS = 12 * 60 * 1000;

  while (pagesFetched < PAGES_PER_RUN) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      stoppedEarly = true;
      break;
    }
    const data = await fetchPage(nextLink || undefined);
    pagesFetched++;
    const rows = data.value || [];

    const closed = rows.filter(
      (l) => l.StandardStatus === 'Closed' && l.PropertyType !== 'Commercial' && Number(l.ClosePrice) > 0
    );
    closedSeen += closed.length;

    // Skip photo fetches for listings already synced with a photo -- avoids
    // re-fetching Media on every pass through the self-healing cursor cycle.
    const existingPhotos = new Map();
    if (closed.length > 0) {
      const { data: existingRows } = await supabase
        .from('vow_sold_listings')
        .select('listing_key, photo_url')
        .in('listing_key', closed.map((l) => l.ListingKey));
      for (const row of existingRows || []) {
        if (row.photo_url) existingPhotos.set(row.listing_key, row.photo_url);
      }
    }

    const upsertRows = [];
    for (const listing of closed) {
      const address = listing.UnparsedAddress;
      if (!address) continue;

      let geo = await geocodeStore.get(address, { type: 'json' }).catch(() => null);
      if (!geo) {
        geo = await geocodeGoogle(address);
        if (geo) {
          await geocodeStore.setJSON(address, geo);
          geocodedNew++;
        }
      }

      const areaSlug = geo ? findAreaForPoint(polygons, geo.lat, geo.lng) : null;

      let photoUrl = existingPhotos.get(listing.ListingKey) ?? null;
      if (!photoUrl) {
        photoUrl = await fetchPrimaryPhoto(listing.ListingKey);
        if (photoUrl) photosNew++;
      }

      upsertRows.push({
        listing_key: listing.ListingKey,
        area_slug: areaSlug,
        address,
        city: listing.City ?? null,
        lat: geo?.lat ?? null,
        lng: geo?.lng ?? null,
        close_price: Number(listing.ClosePrice) || null,
        close_date: listing.CloseDate ?? null,
        list_price: Number(listing.ListPrice) || null,
        beds: Number.isFinite(Number(listing.BedroomsTotal)) ? Number(listing.BedroomsTotal) : null,
        baths: Number.isFinite(Number(listing.BathroomsTotalInteger)) ? Number(listing.BathroomsTotalInteger) : null,
        sqft: Number(listing.BuildingAreaTotal) || null,
        parking_total: Number.isFinite(Number(listing.ParkingTotal)) ? Math.round(Number(listing.ParkingTotal)) : null,
        listing_contract_date: listing.ListingContractDate ?? null,
        property_type: listing.PropertyType ?? null,
        property_sub_type: listing.PropertySubType ?? null,
        photo_url: photoUrl,
        updated_at: new Date().toISOString(),
      });
    }

    if (upsertRows.length > 0) {
      const { error } = await supabase.from('vow_sold_listings').upsert(upsertRows, { onConflict: 'listing_key' });
      if (error) {
        console.error('vow-sold-sync: upsert failed:', error.message);
      } else {
        upserted += upsertRows.length;
      }
    }

    nextLink = data['@odata.nextLink'] || null;

    // Checkpoint after every page rather than once at the end -- if this
    // invocation gets killed by Netlify's hard timeout partway through,
    // the pages already paid for (geocoded/upserted above) stay banked
    // instead of being silently redone next run.
    try {
      await cursorStore.set('nextLink', nextLink || '');
    } catch (err) {
      console.error('vow-sold-sync: cursor checkpoint failed:', err.message);
    }

    if (!nextLink) {
      reachedEnd = true;
      break;
    }
  }

  console.log(`vow-sold-sync: cursor at exit -> ${nextLink ? `${nextLink.length} chars` : '(empty/reset)'}${stoppedEarly ? ' (stopped early on time budget)' : ''}`);

  const summary = `vow-sold-sync done: ${pagesFetched} pages, ${closedSeen} closed listings seen, ${upserted} upserted, ${geocodedNew} newly geocoded, ${photosNew} new photos fetched${reachedEnd ? ' -- reached end of feed, cursor reset to start' : ' -- cursor saved, continuing next run'}`;
  console.log(summary);
  return new Response(summary);
};

export const config = {
  schedule: '0 10 * * *', // daily, 10am UTC -- satisfies the agreement's 24-hour refresh minimum (6.3(h)); offset an hour after the heat-map/geocode jobs to avoid overlapping cold starts
};
