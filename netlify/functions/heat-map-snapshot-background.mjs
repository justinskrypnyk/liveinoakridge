// Scheduled job — computes per-neighbourhood market stats across all 39
// London-area boundary polygons (not just the 7 areas the site's content
// pages serve) and writes aggregate-only snapshots to Supabase. Powers the
// /market-map heat map's pills (median list price, active count, new
// listings this period, avg days on market, price-per-sqft where available)
// plus month-over-month/year-over-year change flags for the monthly
// blog/GBP/social "top movers" workflow.
//
// Two capture cadences from ONE daily-cron trigger, gated internally (same
// pattern as market-stats-snapshot-background.mjs, which already runs daily
// and no-ops except on the 15th/last-day — see that file's header comment
// for why Netlify cron can't express "last day of month" directly):
//   - the 15th  -> period_type = 'mid-month'
//   - the 1st   -> period_type = 'month-end' (captures the PREVIOUS month's
//     close, run the morning after rather than the prior evening so
//     overnight MLS status changes have fully settled)
// The existing daily trigger already runs at 9am UTC, which lands at ~4-5am
// Eastern depending on DST -- close enough to the spec's "5:00 AM" ask to
// reuse rather than stand up a second cron.
//
// Sold-price, units-sold, and sale-to-list-ratio are NOT computed here: the
// DDF Member Website feed is active-listings-only (sold data needs
// VOW-level board access Justin doesn't have yet). Those columns exist in
// the Supabase schema and stay null until that access exists -- see
// supabase/schema.sql. Price-per-sqft IS attempted from BuildingAreaTotal,
// but per Justin, his board likely doesn't release it either; sample_size
// is stored alongside so the UI can tell "no data" apart from "zero".
//
// Runs standalone (not through Astro/Vite), duplicating the minimal
// fetch/geocode-lookup logic instead of importing src/lib/ddf.ts -- same
// isolation convention as the other background jobs in this directory.
import { getStore } from '@netlify/blobs';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DDF_ACCESS_TOKEN = process.env.DDF_ACCESS_TOKEN;
const DDF_API_BASE_URL = process.env.DDF_API_BASE_URL;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// 10%+ move in either direction is what the spec calls "notable" -- applied
// uniformly across metrics for simplicity rather than a different threshold
// per metric.
const NOTABLE_PCT_THRESHOLD = 0.10;

function loadAllAreaBoundaries() {
  const dataPath = fileURLToPath(new URL('../../src/data/area-boundaries.json', import.meta.url));
  const raw = JSON.parse(readFileSync(dataPath, 'utf-8'));
  return raw.features.map((f) => ({
    slug: f.properties.slug,
    name: f.properties.name,
    rings: f.geometry.coordinates,
  }));
}

// Ray casting — point-in-polygon test, mirrors src/lib/area-boundaries.ts.
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
  });
  if (!res.ok) throw new Error(`${resource} -> HTTP ${res.status}: ${await res.text().catch(() => '')}`);
  return res.json();
}

function median(numbers) {
  if (numbers.length === 0) return null;
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid];
}

function average(numbers) {
  if (numbers.length === 0) return null;
  return Math.round(numbers.reduce((sum, n) => sum + n, 0) / numbers.length);
}

function daysSince(timestamp) {
  const listed = new Date(timestamp).getTime();
  if (Number.isNaN(listed)) return null;
  return Math.max(0, Math.floor((Date.now() - listed) / (1000 * 60 * 60 * 24)));
}

function captureKind(date) {
  if (date.getDate() === 15) return 'mid-month';
  if (date.getDate() === 1) return 'month-end';
  return null;
}

function pctChange(previous, current) {
  if (previous == null || current == null || previous === 0) return null;
  return (current - previous) / previous;
}

const METRICS = [
  'median_list_price',
  'active_count',
  'new_listings_count',
  'avg_days_on_market',
  'price_per_sqft',
];

export default async (req) => {
  const now = new Date();
  const forced = req && new URL(req.url).searchParams.get('force') === 'true';
  const forcedKind = req && new URL(req.url).searchParams.get('period_type');
  const kind = forced ? (forcedKind === 'month-end' ? 'month-end' : 'mid-month') : captureKind(now);

  if (!kind) {
    return new Response(`heat-map-snapshot: not a capture day (${now.toISOString().slice(0, 10)}), skipping`);
  }
  if (!DDF_ACCESS_TOKEN || !DDF_API_BASE_URL || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('heat-map-snapshot: missing required env vars', {
      DDF_ACCESS_TOKEN: !!DDF_ACCESS_TOKEN,
      DDF_API_BASE_URL: !!DDF_API_BASE_URL,
      SUPABASE_URL: !!SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: !!SUPABASE_SERVICE_ROLE_KEY,
    });
    return new Response('Missing required env vars', { status: 500 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const geocodeStore = getStore('ddf-geocode-cache');
  const polygons = loadAllAreaBoundaries();

  const data = await odataGet('Property', {
    $filter: `contains(UnparsedAddress,'London')`,
    $select:
      'ListingKey,UnparsedAddress,StandardStatus,PropertyType,TransactionType,ListPrice,OriginalEntryTimestamp,BuildingAreaTotal',
    $top: '5000',
  });
  const all = data.value || [];
  const active = all.filter(
    (l) => l.StandardStatus === 'Active' && l.PropertyType !== 'Commercial' && l.TransactionType !== 'For Lease'
  );

  // Most recent capture across EITHER period type — "new listings this
  // period" means new since the last pull of any kind (pulls happen ~every
  // 15 days regardless of which label they carry), not new since the last
  // pull of this exact period_type specifically.
  const { data: lastAnyCapture } = await supabase
    .from('market_map_snapshots')
    .select('captured_at')
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const sincePrevious = lastAnyCapture ? new Date(lastAnyCapture.captured_at).getTime() : null;

  const byArea = new Map(polygons.map((p) => [p.slug, []]));
  for (const listing of active) {
    const address = listing.UnparsedAddress;
    if (!address) continue;
    const geo = await geocodeStore.get(address, { type: 'json' }).catch(() => null);
    if (!geo) continue;
    const slug = findAreaForPoint(polygons, geo.lat, geo.lng);
    if (slug && byArea.has(slug)) byArea.get(slug).push(listing);
  }

  const captureDate = now.toISOString().slice(0, 10);
  const capturedAt = now.toISOString();
  const snapshotRows = [];

  for (const { slug, name } of polygons) {
    const listings = byArea.get(slug) || [];
    const prices = listings.map((l) => Number(l.ListPrice)).filter((n) => n > 0);
    const dom = listings.map((l) => daysSince(l.OriginalEntryTimestamp)).filter((n) => n !== null);
    const newListings = sincePrevious == null
      ? null
      : listings.filter((l) => new Date(l.OriginalEntryTimestamp).getTime() > sincePrevious).length;

    const sqftPrices = listings
      .map((l) => {
        const sqft = Number(l.BuildingAreaTotal);
        const price = Number(l.ListPrice);
        return sqft > 0 && price > 0 ? price / sqft : null;
      })
      .filter((n) => n !== null);

    snapshotRows.push({
      area_slug: slug,
      area_name: name,
      period_type: kind,
      capture_date: captureDate,
      captured_at: capturedAt,
      median_list_price: median(prices),
      active_count: listings.length,
      new_listings_count: newListings,
      avg_days_on_market: average(dom),
      price_per_sqft: sqftPrices.length > 0 ? median(sqftPrices) : null,
      price_per_sqft_sample_size: sqftPrices.length,
    });
  }

  const { error: upsertError } = await supabase
    .from('market_map_snapshots')
    .upsert(snapshotRows, { onConflict: 'area_slug,capture_date,period_type' });
  if (upsertError) {
    console.error('heat-map-snapshot: snapshot upsert failed:', upsertError.message);
    return new Response('Snapshot upsert failed', { status: 500 });
  }

  // History for MoM/YoY, fetched once for all areas rather than per-area
  // queries — a couple thousand rows at most even after several years at
  // this cadence.
  const { data: history } = await supabase
    .from('market_map_snapshots')
    .select('area_slug, capture_date, median_list_price, active_count, new_listings_count, avg_days_on_market, price_per_sqft')
    .eq('period_type', kind)
    .lt('capture_date', captureDate)
    .order('capture_date', { ascending: false });

  const historyByArea = new Map();
  for (const row of history || []) {
    if (!historyByArea.has(row.area_slug)) historyByArea.set(row.area_slug, []);
    historyByArea.get(row.area_slug).push(row);
  }

  const elevenMonthsAgo = new Date(now);
  elevenMonthsAgo.setMonth(elevenMonthsAgo.getMonth() - 11);
  const elevenMonthsAgoStr = elevenMonthsAgo.toISOString().slice(0, 10);

  const changeRows = [];
  for (const row of snapshotRows) {
    const rows = historyByArea.get(row.area_slug) || [];
    const momRow = rows[0] || null; // most recent prior row of this period_type
    const yoyRow = rows.find((r) => r.capture_date <= elevenMonthsAgoStr) || null;

    for (const metric of METRICS) {
      const currentValue = row[metric];
      const momPrevious = momRow ? momRow[metric] : null;
      const yoyPrevious = yoyRow ? yoyRow[metric] : null;
      const momPct = pctChange(momPrevious, currentValue);
      const yoyPct = pctChange(yoyPrevious, currentValue);

      changeRows.push({
        area_slug: row.area_slug,
        area_name: row.area_name,
        metric,
        period_type: kind,
        capture_date: captureDate,
        current_value: currentValue,
        mom_previous_value: momPrevious,
        mom_pct_change: momPct,
        yoy_previous_value: yoyPrevious,
        yoy_pct_change: yoyPct,
        is_notable: momPct != null && Math.abs(momPct) >= NOTABLE_PCT_THRESHOLD,
      });
    }
  }

  const { error: changesError } = await supabase
    .from('market_map_changes')
    .upsert(changeRows, { onConflict: 'area_slug,metric,capture_date,period_type' });
  if (changesError) {
    console.error('heat-map-snapshot: changes upsert failed:', changesError.message);
    // Not fatal — the snapshot itself (what the map actually renders) already saved above.
  }

  const summary = `heat-map-snapshot done (${kind}, ${captureDate}): ${polygons.length} areas, ${changeRows.filter((c) => c.is_notable).length} notable changes`;
  console.log(summary);
  return new Response(summary);
};

export const config = {
  schedule: '0 9 * * *', // daily, 9am UTC — internal captureKind() guard makes this an effective 15th/1st-of-month cadence
};
