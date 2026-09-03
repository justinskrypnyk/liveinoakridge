// Scheduled job -- pulls Closed (sold) listings for the outlying towns
// shown on the monthly digest's "Outlying Areas" list (Middlesex Centre,
// Strathroy-Caradoc, St. Thomas) via the same VOW-scoped AMPRE token as
// vow-sold-sync-background.mjs, and writes them into the SAME
// vow_sold_listings table that job already populates -- tagged with a
// synthetic area_slug ('outlying-<slug>') so they never collide with, or
// get counted into, the 39 real neighbourhood polygons' data (the heat map
// and monthly blog/digest totals only ever iterate the real polygon list
// from area-boundaries.json, so these extra rows are invisible to them;
// /sold-map also excludes them automatically since they're never geocoded
// -- see below).
//
// Exists because monthly-digest-background.mjs used to compute these towns'
// median sold price with a single live, undated $top=2000 fetch at email
// time -- no CloseDate filter at all, so the "this month" framing next to
// it was never actually true (Justin caught this 2026-09-03, same day as
// the units_sold/median_sold_price month-mislabeling fix). A date filter
// alone can't fix that: this AMPRE deployment's default sort empirically
// returns oldest-first with no $orderby available (same constraint
// documented in vow-sold-sync-background.mjs's header), so a single
// bounded fetch for a market that's been on this feed for years mostly
// never reaches recent closings at all. The only reliable fix is the same
// one that file already uses for the 39 in-city areas: walk the whole
// feed once via a persisted cursor, upsert what's found, and let a real
// CloseDate-range query (in monthly-digest-background.mjs) answer "what
// closed this month" from the synced data instead of a live guess.
//
// No geocoding or photo lookups here (unlike vow-sold-sync-background.mjs)
// -- these rows only ever feed a median-price calculation, never a map pin
// or a listing card, so lat/lng/photo would be wasted API calls.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const VOW_ACCESS_TOKEN = process.env.VOW_ACCESS_TOKEN;
const DDF_API_BASE_URL = process.env.DDF_API_BASE_URL;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const PAGE_SIZE = 100;
// Three cities walked per run, one cursor each -- a shared wall-clock
// budget (rather than a fixed page count per city like the single-city
// main sync uses) so a slow city can't starve the other two of their turn
// across repeated runs. Netlify's background-function hard kill is ~15min;
// this leaves headroom the same way vow-sold-sync-background.mjs's own
// budget does.
const TIME_BUDGET_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15000;
const SELECT_FIELDS =
  'ListingKey,UnparsedAddress,City,StandardStatus,PropertyType,PropertySubType,TransactionType,ClosePrice,CloseDate,ListPrice,BedroomsTotal,BathroomsTotalInteger,BuildingAreaTotal,ParkingTotal,ListingContractDate';

// Same source file monthly-digest-background.mjs's loadOutlyingAreas()
// reads -- self-contained copy per this directory's isolation convention
// (see vow-sold-sync-background.mjs's own header for the fuller reasoning).
// Deduped by mls_city (Delaware and Komoka/Kilworth both roll up to
// "Middlesex Centre" -- one cursor/one set of synced rows covers both).
// 'St. Thomas' is NOT one of this file's boundary features (it's a
// standing town, not a "villages near London" polygon) -- added here to
// match monthly-digest-background.mjs's own hardcoded extra push for it.
function loadOutlyingCities() {
  const dataPath = fileURLToPath(new URL('../../src/data/outlying-area-boundaries.json', import.meta.url));
  const raw = JSON.parse(readFileSync(dataPath, 'utf-8'));
  const mlsCities = new Set(raw.features.map((f) => f.properties.mls_city).filter(Boolean));
  mlsCities.add('St. Thomas');
  // Search term the AMPRE `contains(City, ...)` filter matches against --
  // same overrides monthly-digest-background.mjs's MLS_CITY_SEARCH_TERMS
  // used, needed because "Middlesex Centre"/"St. Thomas" as literal
  // City-field substrings don't reliably match this feed's actual values
  // (confirmed empirically: this feed silently 0-results any multi-word
  // contains() value).
  const SEARCH_TERM_OVERRIDES = { 'Middlesex Centre': 'Middlesex', 'St. Thomas': 'Thomas' };
  return [...mlsCities].map((mlsCity) => ({
    slug: mlsCity.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
    mlsCity,
    searchTerm: SEARCH_TERM_OVERRIDES[mlsCity] || mlsCity,
  }));
}

async function fetchPage(searchTerm, nextLink) {
  const url = nextLink
    ? new URL(nextLink)
    : (() => {
        const u = new URL(`${DDF_API_BASE_URL}Property`);
        u.searchParams.set('$filter', `contains(City,'${searchTerm}')`);
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

// Walks one city as far as the shared time budget allows, checkpointing
// its cursor after every page (same reasoning as vow-sold-sync-background.mjs:
// a mid-walk kill shouldn't lose already-paid-for pages). Returns whether
// it reached the end of this city's feed (cursor reset to start) or ran
// out of budget (cursor saved, continues next run).
async function syncCity(city, supabase, cursorStore, deadline) {
  let nextLink = null;
  try {
    nextLink = await cursorStore.get(`nextLink:${city.slug}`, { type: 'text' });
  } catch (err) {
    console.error(`outlying-sold-sync: cursor read failed for ${city.slug}:`, err.message);
  }

  let pagesFetched = 0;
  let closedSeen = 0;
  let upserted = 0;
  let reachedEnd = false;

  while (Date.now() < deadline) {
    const data = await fetchPage(city.searchTerm, nextLink || undefined);
    pagesFetched++;
    const rows = data.value || [];

    // Same TransactionType/PropertyType/ClosePrice gate as
    // vow-sold-sync-background.mjs -- leases stay in the table (tagged
    // is_lease) rather than excluded outright, matching that file's
    // reasoning, even though this pipeline's only consumer (median sold
    // price) already filters is_lease=false back out.
    //
    // l.City === city.mlsCity is NOT redundant with the contains() filter
    // above: `searchTerm` is deliberately a loose single-word substring
    // (this feed silently 0-results any multi-word contains() value), so
    // e.g. 'Middlesex' also matches 'North Middlesex' -- this is the exact
    // narrowing step monthly-digest-background.mjs's old live-fetch version
    // already relied on, carried over here so it isn't lost in the move.
    const closed = rows.filter(
      (l) => l.City === city.mlsCity && l.StandardStatus === 'Closed' && l.PropertyType !== 'Commercial' && Number(l.ClosePrice) > 0
    );
    closedSeen += closed.length;

    const upsertRows = closed
      .filter((l) => l.UnparsedAddress) // address is NOT NULL on this table
      .map((listing) => ({
        listing_key: listing.ListingKey,
        area_slug: `outlying-${city.slug}`,
        address: listing.UnparsedAddress,
        city: listing.City ?? null,
        lat: null,
        lng: null,
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
        photo_url: null,
        is_lease: listing.TransactionType === 'For Lease',
        updated_at: new Date().toISOString(),
      }));

    if (upsertRows.length > 0) {
      const { error } = await supabase.from('vow_sold_listings').upsert(upsertRows, { onConflict: 'listing_key' });
      if (error) {
        console.error(`outlying-sold-sync: upsert failed for ${city.slug}:`, error.message);
      } else {
        upserted += upsertRows.length;
      }
    }

    nextLink = data['@odata.nextLink'] || null;

    try {
      await cursorStore.set(`nextLink:${city.slug}`, nextLink || '');
    } catch (err) {
      console.error(`outlying-sold-sync: cursor checkpoint failed for ${city.slug}:`, err.message);
    }

    if (!nextLink) {
      reachedEnd = true;
      break;
    }
  }

  return { pagesFetched, closedSeen, upserted, reachedEnd };
}

export default async () => {
  if (!VOW_ACCESS_TOKEN || !DDF_API_BASE_URL || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('outlying-sold-sync: missing required env vars', {
      VOW_ACCESS_TOKEN: !!VOW_ACCESS_TOKEN,
      DDF_API_BASE_URL: !!DDF_API_BASE_URL,
      SUPABASE_URL: !!SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: !!SUPABASE_SERVICE_ROLE_KEY,
    });
    return new Response('Missing required env vars', { status: 500 });
  }

  const { getStore } = await import('@netlify/blobs');
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const cursorStore = getStore('outlying-sold-sync-cursor');
  const cities = loadOutlyingCities();
  const deadline = Date.now() + TIME_BUDGET_MS;

  const results = [];
  for (const city of cities) {
    if (Date.now() >= deadline) {
      results.push({ slug: city.slug, skipped: true });
      continue;
    }
    try {
      const result = await syncCity(city, supabase, cursorStore, deadline);
      results.push({ slug: city.slug, ...result });
    } catch (err) {
      console.error(`outlying-sold-sync: ${city.slug} failed:`, err.message);
      results.push({ slug: city.slug, error: err.message });
    }
  }

  const summary = `outlying-sold-sync done: ${results.map((r) =>
    r.error ? `${r.slug}=ERROR(${r.error})` : r.skipped ? `${r.slug}=skipped(no budget)` : `${r.slug}=${r.pagesFetched}pg/${r.upserted}upserted${r.reachedEnd ? '/reached-end' : ''}`
  ).join(', ')}`;
  console.log(summary);
  return new Response(summary);
};

export const config = {
  schedule: '0 11 * * *', // daily, 11am UTC -- an hour after vow-sold-sync-background.mjs, avoiding overlapping cold starts
};
