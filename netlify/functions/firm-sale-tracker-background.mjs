// Scheduled job -- daily -- detects the day each listing FIRST shows up as
// 'Active Under Contract' in the AMPRE feed: our own self-observed proxy
// for "the day a deal went firm". AMPRE's own PurchaseContractDate field
// stays null until a deal actually closes (confirmed empirically
// 2026-09-03 -- none of the currently-under-contract listings had it
// populated), so that field can't answer "how many deals firmed up this
// month" in anything close to real time; by the time it's filled in, the
// deal has already closed, which is exactly the closing-date lag
// (median 43 days, confirmed against real August 2026 data) this job
// exists to avoid.
//
// Boards require a sale to be reported within 24 hours, so a DAILY poll
// catches the Active -> Active Under Contract transition to within about a
// day -- much closer to LSTAR's own live "Sales Activity" methodology than
// units_sold_month (which is closing-date based, see
// heat-map-snapshot-background.mjs). Writes to vow_firm_tracker
// (migrations/004): insert-only, a listing_key already tracked is never
// touched again even if the deal later falls through and the listing
// returns to Active -- it genuinely went firm on that first-observed date,
// however briefly.
//
// Self-contained rather than importing heat-map-snapshot-background.mjs's
// helpers -- same isolation convention as every function in this
// directory (see vow-sold-sync-background.mjs's header for the fuller
// reasoning).
import { getStore } from '@netlify/blobs';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DDF_ACCESS_TOKEN = process.env.DDF_ACCESS_TOKEN;
const DDF_API_BASE_URL = process.env.DDF_API_BASE_URL;
const GOOGLE_GEOCODING_API_KEY = process.env.GOOGLE_GEOCODING_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const FETCH_TIMEOUT_MS = 15000;

function loadAllAreaBoundaries() {
  const dataPath = fileURLToPath(new URL('../../src/data/area-boundaries.json', import.meta.url));
  const raw = JSON.parse(readFileSync(dataPath, 'utf-8'));
  return raw.features.map((f) => ({ slug: f.properties.slug, rings: f.geometry.coordinates }));
}

// Ray casting point-in-polygon -- same as heat-map-snapshot-background.mjs
// and vow-sold-sync-background.mjs.
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

async function odataGet(resource, params) {
  const url = new URL(`${DDF_API_BASE_URL}${resource}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${DDF_ACCESS_TOKEN}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${resource} -> HTTP ${res.status}: ${await res.text().catch(() => '')}`);
  return res.json();
}

// Same as vow-sold-sync-background.mjs's geocodeGoogle -- duplicated per
// this directory's isolation convention.
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

export default async () => {
  if (!DDF_ACCESS_TOKEN || !DDF_API_BASE_URL || !GOOGLE_GEOCODING_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('firm-sale-tracker: missing required env vars', {
      DDF_ACCESS_TOKEN: !!DDF_ACCESS_TOKEN,
      DDF_API_BASE_URL: !!DDF_API_BASE_URL,
      GOOGLE_GEOCODING_API_KEY: !!GOOGLE_GEOCODING_API_KEY,
      SUPABASE_URL: !!SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: !!SUPABASE_SERVICE_ROLE_KEY,
    });
    return new Response('Missing required env vars', { status: 500 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const geocodeStore = getStore('ddf-geocode-cache'); // shared cache, same convention as the other DDF/VOW jobs
  const polygons = loadAllAreaBoundaries();

  const data = await odataGet('Property', {
    $filter: `contains(UnparsedAddress,'London')`,
    $select: 'ListingKey,UnparsedAddress,City,StandardStatus,PropertyType,PropertySubType,ListPrice',
    $top: '5000', // single fetch, no cursor -- same as heat-map-snapshot-background.mjs's active-listings pull; this is a live snapshot of CURRENTLY under-contract listings, not a historical walk
  });
  const underContract = (data.value || []).filter(
    (l) => l.StandardStatus === 'Active Under Contract' && l.PropertyType !== 'Commercial'
  );

  // Only look up/geocode listings we haven't already recorded -- a listing
  // stays "Active Under Contract" for weeks while conditions clear, so most
  // days this is re-fetching the same set and finding nothing new.
  const keys = underContract.map((l) => l.ListingKey);
  const { data: existing, error: existingError } = await supabase
    .from('vow_firm_tracker')
    .select('listing_key')
    .in('listing_key', keys.length ? keys : ['__none__']);
  if (existingError) {
    console.error('firm-sale-tracker: existing-keys lookup failed:', existingError.message);
    return new Response('Existing-keys lookup failed', { status: 500 });
  }
  const alreadyTracked = new Set((existing || []).map((r) => r.listing_key));
  const newlySeen = underContract.filter((l) => !alreadyTracked.has(l.ListingKey));

  const wentFirmDate = new Date().toISOString().slice(0, 10);
  const insertRows = [];
  let geocodedNew = 0;
  for (const listing of newlySeen) {
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

    insertRows.push({
      listing_key: listing.ListingKey,
      area_slug: areaSlug,
      address,
      city: listing.City ?? null,
      list_price: Number(listing.ListPrice) || null,
      property_type: listing.PropertyType ?? null,
      property_sub_type: listing.PropertySubType ?? null,
      went_firm_date: wentFirmDate,
    });
  }

  if (insertRows.length > 0) {
    // ignoreDuplicates -- INSERT ... ON CONFLICT DO NOTHING. went_firm_date
    // must never be overwritten once set, even on a re-run the same day.
    const { error: insertError } = await supabase
      .from('vow_firm_tracker')
      .upsert(insertRows, { onConflict: 'listing_key', ignoreDuplicates: true });
    if (insertError) {
      console.error('firm-sale-tracker: insert failed:', insertError.message);
      return new Response('Insert failed', { status: 500 });
    }
  }

  const summary = `firm-sale-tracker done: ${underContract.length} currently under contract, ${newlySeen.length} newly seen today (went_firm_date ${wentFirmDate}), ${geocodedNew} newly geocoded`;
  console.log(summary);
  return new Response(summary);
};

export const config = {
  schedule: '0 12 * * *', // daily, noon UTC -- offset from vow-sold-sync (10am) and outlying-sold-sync (11am) to avoid overlapping cold starts
};
