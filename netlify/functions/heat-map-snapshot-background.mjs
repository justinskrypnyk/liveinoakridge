// Scheduled job — computes per-neighbourhood market stats across all 39
// London-area boundary polygons (not just the 7 areas the site's content
// pages serve) and writes aggregate-only snapshots to Supabase. Powers the
// /market-map heat map's pills (median list price, active count, new
// listings this period, avg days on market, price-per-sqft where available,
// median bedrooms/bathrooms, % detached homes, listings delisted this
// period) plus month-over-month/year-over-year change flags for the
// monthly blog/GBP/social "top movers" workflow (price/DOM-family metrics
// only -- see METRICS below).
//
// Two capture cadences from ONE daily-cron trigger, gated internally (same
// pattern as market-stats-snapshot-background.mjs, which already runs daily
// and no-ops except on the 15th/last-day — see that file's header comment
// for why Netlify cron can't express "last day of month" directly):
//   - the 16th  -> period_type = 'mid-month' (captures the FULL previous
//     day, the 15th -- moved from running ON the 15th itself, which missed
//     that day's own activity; run the morning after, same reasoning as
//     month-end below. Per Justin's ask 2026-09-16.)
//   - the 1st   -> period_type = 'month-end' (captures the PREVIOUS month's
//     close, run the morning after rather than the prior evening so
//     overnight MLS status changes have fully settled)
// The existing daily trigger already runs at 9am UTC, which lands at ~4-5am
// Eastern depending on DST -- close enough to the spec's "5:00 AM" ask to
// reuse rather than stand up a second cron.
//
// Sold-price, units-sold, and sale-to-list-ratio: computed from
// vow_sold_listings (see supabase/schema.sql and
// vow-sold-sync-background.mjs), which requires the separate VOW datafeed
// authorization -- active since 2026-07-22 (Membership #9636674). A rolling
// 90-day window of closed sales per area, not "since the last snapshot":
// twice-monthly capture periods (~15 days) are too thin a window for a
// stable per-neighbourhood median on their own. Price-per-sqft IS attempted
// from BuildingAreaTotal, but per Justin, his board likely doesn't release
// it either; sample_size is stored alongside so the UI can tell "no data"
// apart from "zero".
//
// Runs standalone (not through Astro/Vite), duplicating the minimal
// fetch/geocode-lookup logic instead of importing src/lib/ddf.ts -- same
// isolation convention as the other background jobs in this directory.
import { getStore } from '@netlify/blobs';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fetchVowLondonListings, firmSales, SALE_FIELDS, torontoDate, torontoMonthBounds } from '../../src/lib/vow-listings.mjs';

// Listings come from the VOW feed, not DDF -- DDF was missing ~15% of
// London's active listings (see src/lib/vow-listings.mjs).
const VOW_ACCESS_TOKEN = process.env.VOW_ACCESS_TOKEN;
const DDF_API_BASE_URL = process.env.DDF_API_BASE_URL;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// 10%+ move in either direction is what the spec calls "notable" -- applied
// uniformly across metrics for simplicity rather than a different threshold
// per metric.
const NOTABLE_PCT_THRESHOLD = 0.10;

// Captures before these dates used the old rules (DDF listings, sales by
// closing date, half-month new listings), so they're never used as the
// "previous month". The four month figures below can be rebuilt for any
// past month from the VOW feed, and the 2026-09-01 row's were (see
// ?backfill_month_metrics=true), so they compare from that capture; every
// other metric reads n/a until a capture under the current rules exists.
const CURRENT_METHOD_SINCE = '2026-10-01';
const MONTH_METRICS = ['units_sold_month', 'median_sold_price_month', 'avg_sale_to_list_ratio_month', 'new_listings_count'];
const MONTH_METRICS_SINCE = '2026-09-01';
const comparableSince = (metric) => (MONTH_METRICS.includes(metric) ? MONTH_METRICS_SINCE : CURRENT_METHOD_SINCE);

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

// Sale-to-list ratio lives near 1.0 (e.g. 0.98-1.03) -- average()'s
// integer rounding would flatten that entirely, so this keeps 3 decimals.
function averageRatio(numbers) {
  if (numbers.length === 0) return null;
  return Math.round((numbers.reduce((sum, n) => sum + n, 0) / numbers.length) * 1000) / 1000;
}

function daysSince(timestamp) {
  const listed = new Date(timestamp).getTime();
  if (Number.isNaN(listed)) return null;
  return Math.max(0, Math.floor((Date.now() - listed) / (1000 * 60 * 60 * 24)));
}

function captureKind(date) {
  if (date.getDate() === 16) return 'mid-month';
  if (date.getDate() === 1) return 'month-end';
  if (date.getDate() === 6) return 'sales-recount';
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
  'median_sold_price',
  'units_sold',
  'avg_sale_to_list_ratio',
  'median_sold_price_month',
  'units_sold_month',
  'avg_sale_to_list_ratio_month',
  'units_firmed_month',
  'median_bedrooms',
  'median_bathrooms',
  'pct_detached',
  'delisted_count',
  'months_of_inventory',
];

export default async (req) => {
  const forced = req && new URL(req.url).searchParams.get('force') === 'true';
  // On the 6th the scheduled run recounts the month that just closed: sales
  // that went firm late in the month keep reaching the MLS for days (Sept
  // 2026: 371 on the 1st, 377 that evening), so the monthly reports now go
  // out on the 6th (Justin + Smile, 2026-10-02). It rewrites only the month
  // figures on the 1st's month-end row -- active listings and the month-end
  // keys stay as captured on the 1st.
  const salesRecount = !forced && captureKind(new Date()) === 'sales-recount';
  // ?as_of=2026-09-01 (forced runs only): compute as if it were that
  // morning -- the month figures, which the VOW feed keeps for any past
  // month, come out right; active-listing figures still reflect today.
  const asOf = forced ? new URL(req.url).searchParams.get('as_of') : null;
  const firstOfMonth = new Date().toISOString().slice(0, 8) + '01';
  const now = salesRecount
    ? new Date(`${firstOfMonth}T09:00:00Z`)
    : /^\d{4}-\d{2}-\d{2}$/.test(asOf || '') ? new Date(`${asOf}T09:00:00Z`) : new Date();
  const backfillMonthMetrics = salesRecount || (forced && new URL(req.url).searchParams.get('backfill_month_metrics') === 'true');
  const forcedKind = req && new URL(req.url).searchParams.get('period_type');
  const kind = forced ? (forcedKind === 'month-end' ? 'month-end' : 'mid-month') : captureKind(now);
  // POST {"dryRun":true} with ?force=true: compute and return the rows,
  // write nothing (no Supabase rows, no saved listing keys).
  let dryRun = false;
  try {
    dryRun = (await req?.json?.())?.dryRun === true;
  } catch {
    // scheduled runs have no body
  }

  if (!VOW_ACCESS_TOKEN || !DDF_API_BASE_URL || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('heat-map-snapshot: missing required env vars', {
      VOW_ACCESS_TOKEN: !!VOW_ACCESS_TOKEN,
      DDF_API_BASE_URL: !!DDF_API_BASE_URL,
      SUPABASE_URL: !!SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: !!SUPABASE_SERVICE_ROLE_KEY,
    });
    return new Response('Missing required env vars', { status: 500 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  if (!kind) {
    // Supabase free-tier projects auto-pause after 7 days with no API
    // activity, but real capture days are 14-16 days apart -- a trivial
    // read on every off-day run keeps the project alive in between.
    await supabase.from('market_map_snapshots').select('area_slug').limit(1);
    return new Response(`heat-map-snapshot: not a capture day (${now.toISOString().slice(0, 10)}), keep-alive ping sent`);
  }

  const geocodeStore = getStore('ddf-geocode-cache');
  const polygons = loadAllAreaBoundaries();

  // Every status, so new listings that already sold or were pulled still
  // count. Residential for sale only -- the old `!== 'For Lease'` check let
  // 'For Sub-Lease' rentals through.
  const all = await fetchVowLondonListings({
    baseUrl: DDF_API_BASE_URL,
    token: VOW_ACCESS_TOKEN,
    select: ['ListingKey', 'UnparsedAddress', 'PropertySubType', 'OriginalEntryTimestamp', 'BuildingAreaTotal', 'BedroomsTotal', 'BathroomsTotalInteger', ...SALE_FIELDS],
  });
  const active = all.filter((l) => l.StandardStatus === 'Active');

  // The month this capture reports on: the full month that just closed on a
  // month-end capture, month-to-date on a mid-month one. New listings and
  // "left market" both cover exactly this range (they used to cover only the
  // ~15 days since the previous capture, so a month-end report showed half
  // a month -- caught 2026-10-01).
  const reportMonth = kind === 'month-end'
    ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const { start: reportStartMs, end: reportEndMs } = torontoMonthBounds(reportMonth.getUTCFullYear(), reportMonth.getUTCMonth());
  const enteredInRange = all.filter((l) => {
    const t = new Date(l.OriginalEntryTimestamp).getTime();
    return t >= reportStartMs && t < Math.min(reportEndMs, now.getTime());
  });

  // "Listings that left active status this period" — a market-velocity
  // proxy that needs no sold/VOW data at all: just the previous run's
  // per-area ListingKey set, diffed against this run's. Stored in Blobs
  // (not Supabase) since it's pure job-scoped state, same convention as the
  // geocode cache above.
  //
  // Diffed against the last MONTH-END capture's keys (not the last capture
  // of any kind), so both captures cover the same range as new listings:
  // month-end = the whole month, mid-month = month-to-date. No month-end
  // key set yet (the first run under these rules) means n/a, not a diff
  // against some other date.
  const previousKeysStore = getStore('heat-map-previous-keys');
  const previousKeysByArea = (await previousKeysStore.get('month-end', { type: 'json' }).catch(() => null)) || {};

  // Addresses are geocoded ahead of time by warm-geocode-cache-background.mjs.
  // Read up front, 40 at a time -- ~4,000 one-by-one reads ran past
  // the background function's 15-minute limit.
  const geoByAddress = new Map();
  {
    const needed = [...active, ...enteredInRange, ...firmSales(all, torontoDate(90), torontoDate())];
    const addresses = [...new Set(needed.map((l) => l.UnparsedAddress).filter(Boolean))];
    for (let i = 0; i < addresses.length; i += 40) {
      await Promise.all(addresses.slice(i, i + 40).map(async (a) => {
        geoByAddress.set(a, await geocodeStore.get(a, { type: 'json' }).catch(() => null));
      }));
    }
  }
  const areaOf = async (listing) => {
    const geo = listing.UnparsedAddress ? geoByAddress.get(listing.UnparsedAddress) : null;
    return geo ? findAreaForPoint(polygons, geo.lat, geo.lng) : null;
  };
  const byArea = new Map(polygons.map((p) => [p.slug, []]));
  const newByArea = new Map(polygons.map((p) => [p.slug, 0]));
  let notGeocoded = 0;
  for (const listing of active) {
    const slug = await areaOf(listing);
    if (!slug && listing.UnparsedAddress) notGeocoded++;
    if (slug && byArea.has(slug)) byArea.get(slug).push(listing);
  }
  for (const listing of enteredInRange) {
    const slug = await areaOf(listing);
    if (slug && newByArea.has(slug)) newByArea.set(slug, newByArea.get(slug) + 1);
  }
  console.log(`heat-map-snapshot: ${active.length} active, ${enteredInRange.length} new in range, ${notGeocoded} active not geocoded yet`);

  // Sales, counted by the date they went firm (the MLS "Sold Date") straight
  // from the VOW pull above -- see firmSales in src/lib/vow-listings.mjs for
  // why not vow_sold_listings.close_date (possession day; Oakridge Sept 2026
  // showed 19 vs the MLS's 11). Two windows:
  //  - rolling 90 days, for the map's median sold price / sale-to-list pills
  //    and months of inventory (a half-month alone is too thin a sample);
  //  - the report month (full month on month-end, month-to-date mid-month),
  //    for every "sold in <month>" figure.
  const monthRangeStart = reportMonth;
  const monthRangeEnd = kind === 'month-end'
    ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)) // last day of the month that just closed
    : now; // mid-month: month-to-date, through today
  const ymd = (d) => d.toISOString().slice(0, 10);

  const recentSales = firmSales(all, torontoDate(90), torontoDate());
  const monthSales = firmSales(all, ymd(monthRangeStart), ymd(monthRangeEnd));

  // Sold listings are often older than the geocode cache's window, so fall
  // back to the coordinates vow-sold-sync stored for them.
  const soldCoords = new Map();
  const saleKeys = [...new Set(recentSales.map((l) => l.ListingKey))];
  for (let i = 0; i < saleKeys.length; i += 200) {
    const { data, error } = await supabase
      .from('vow_sold_listings')
      .select('listing_key, lat, lng')
      .in('listing_key', saleKeys.slice(i, i + 200));
    if (error) console.error('heat-map-snapshot: sold coordinates query failed:', error.message);
    for (const r of data || []) if (r.lat && r.lng) soldCoords.set(r.listing_key, { lat: r.lat, lng: r.lng });
  }
  const saleArea = async (l) => {
    const c = soldCoords.get(l.ListingKey);
    return c ? findAreaForPoint(polygons, c.lat, c.lng) : areaOf(l);
  };
  const toRow = (l) => ({ close_price: Number(l.ClosePrice), list_price: Number(l.ListPrice) });
  const soldsByArea = new Map();
  const monthSoldsByArea = new Map();
  const monthSaleKeys = new Set(monthSales.map((l) => l.ListingKey));
  let salesNotPlaced = 0;
  for (const l of recentSales) {
    const slug = await saleArea(l);
    if (!slug) { salesNotPlaced++; continue; }
    if (!soldsByArea.has(slug)) soldsByArea.set(slug, []);
    soldsByArea.get(slug).push(toRow(l));
    if (monthSaleKeys.has(l.ListingKey)) {
      if (!monthSoldsByArea.has(slug)) monthSoldsByArea.set(slug, []);
      monthSoldsByArea.get(slug).push(toRow(l));
    }
  }
  console.log(`heat-map-snapshot: ${recentSales.length} sales in 90 days, ${monthSales.length} in the report month, ${salesNotPlaced} not placed in a neighbourhood`);

  // Firm-sale counts for the same month range, from vow_firm_tracker
  // (populated daily by firm-sale-tracker-background.mjs) -- a much closer
  // match to LSTAR's own firm-date "Sales Activity" than the closing-date
  // monthSoldsByArea count above. No history before 2026-09-03 (migrations/004),
  // so this reads 0 for any month range entirely before that date.
  const monthFirmedByArea = new Map();
  const SOLDS_PAGE_SIZE = 1000;
  {
    const monthFirmed = [];
    for (let from = 0; ; from += SOLDS_PAGE_SIZE) {
      const { data: page, error: monthFirmedError } = await supabase
        .from('vow_firm_tracker')
        .select('area_slug')
        .gte('went_firm_date', monthRangeStart.toISOString().slice(0, 10))
        .lte('went_firm_date', monthRangeEnd.toISOString().slice(0, 10))
        .not('area_slug', 'is', null)
        .range(from, from + SOLDS_PAGE_SIZE - 1);
      if (monthFirmedError) {
        console.error('heat-map-snapshot: monthFirmed query failed:', monthFirmedError.message);
        break;
      }
      monthFirmed.push(...(page || []));
      if (!page || page.length < SOLDS_PAGE_SIZE) break;
    }
    for (const row of monthFirmed) {
      monthFirmedByArea.set(row.area_slug, (monthFirmedByArea.get(row.area_slug) || 0) + 1);
    }
  }

  // A forced re-run can overwrite a specific capture (e.g. ?capture_date=2026-10-01
  // to redo that morning's month-end row under the current rules).
  const captureDateParam = forced ? new URL(req.url).searchParams.get('capture_date') : null;
  const captureDate = salesRecount
    ? firstOfMonth
    : /^\d{4}-\d{2}-\d{2}$/.test(captureDateParam || '') ? captureDateParam : now.toISOString().slice(0, 10);
  const capturedAt = now.toISOString();
  const snapshotRows = [];

  const currentKeysByArea = {};

  for (const { slug, name } of polygons) {
    const listings = byArea.get(slug) || [];
    const prices = listings.map((l) => Number(l.ListPrice)).filter((n) => n > 0);
    const dom = listings.map((l) => daysSince(l.OriginalEntryTimestamp)).filter((n) => n !== null);
    const newListings = newByArea.get(slug) || 0;

    const sqftPrices = listings
      .map((l) => {
        const sqft = Number(l.BuildingAreaTotal);
        const price = Number(l.ListPrice);
        return sqft > 0 && price > 0 ? price / sqft : null;
      })
      .filter((n) => n !== null);

    const beds = listings.map((l) => Number(l.BedroomsTotal)).filter((n) => Number.isFinite(n) && n >= 0);
    const baths = listings.map((l) => Number(l.BathroomsTotalInteger)).filter((n) => Number.isFinite(n) && n >= 0);
    const detachedCount = listings.filter((l) => l.PropertySubType === 'Detached').length;

    const currentKeys = listings.map((l) => l.ListingKey).filter(Boolean);
    currentKeysByArea[slug] = currentKeys;
    const previousKeys = previousKeysByArea[slug] || null;
    const delistedCount = previousKeys ? previousKeys.filter((k) => !currentKeys.includes(k)).length : null;

    const solds = soldsByArea.get(slug) || [];
    const soldPrices = solds.map((s) => Number(s.close_price)).filter((n) => n > 0);
    const saleToListRatios = solds
      .map((s) => (Number(s.list_price) > 0 ? Number(s.close_price) / Number(s.list_price) : null))
      .filter((n) => n !== null);

    // True calendar-month versions of the three fields above -- null on
    // mid-month captures (no completed month to report yet).
    const monthSolds = monthSoldsByArea.get(slug) || [];
    const monthSoldPrices = monthSolds.map((s) => Number(s.close_price)).filter((n) => n > 0);
    const monthSaleToListRatios = monthSolds
      .map((s) => (Number(s.list_price) > 0 ? Number(s.close_price) / Number(s.list_price) : null))
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
      median_sold_price: soldPrices.length > 0 ? median(soldPrices) : null,
      units_sold: solds.length,
      avg_sale_to_list_ratio: averageRatio(saleToListRatios),
      // True calendar-month figures -- full month on a month-end capture,
      // month-to-date on a mid-month capture. See monthRangeStart/End above.
      units_sold_month: monthSolds.length,
      median_sold_price_month: monthSoldPrices.length > 0 ? median(monthSoldPrices) : null,
      avg_sale_to_list_ratio_month: monthSaleToListRatios.length > 0 ? averageRatio(monthSaleToListRatios) : null,
      // Firm-sale count for the same month range -- see monthFirmedByArea
      // comment above. 0 (not null) when nothing's been tracked yet, same
      // as units_sold_month reading 0 rather than null for a quiet month.
      units_firmed_month: monthFirmedByArea.get(slug) || 0,
      price_per_sqft: sqftPrices.length > 0 ? median(sqftPrices) : null,
      price_per_sqft_sample_size: sqftPrices.length,
      median_bedrooms: median(beds),
      median_bathrooms: median(baths),
      pct_detached: listings.length > 0 ? detachedCount / listings.length : null,
      delisted_count: delistedCount,
      // Months of inventory (months of supply): at the current sales pace,
      // how long to sell everything active. Uses the 90-day rolling
      // `solds` count above (not the calendar-month figure) so this needs
      // no separate pace-adjustment for a mid-month vs. month-end capture
      // -- both read off the same rolling window. Null when there have
      // been zero sales in the last 90 days (undefined pace), same
      // convention as avg_sale_to_list_ratio.
      months_of_inventory: solds.length > 0 ? Math.round((listings.length / (solds.length / 3)) * 10) / 10 : null,
    });
  }

  // History for MoM/YoY, fetched once for all areas rather than per-area
  // queries — a couple thousand rows at most even after several years at
  // this cadence.
  const { data: history } = await supabase
    .from('market_map_snapshots')
    .select('area_slug, capture_date, median_list_price, active_count, new_listings_count, avg_days_on_market, price_per_sqft, median_sold_price, units_sold, avg_sale_to_list_ratio, median_sold_price_month, units_sold_month, avg_sale_to_list_ratio_month, units_firmed_month, median_bedrooms, median_bathrooms, pct_detached, delisted_count, months_of_inventory')
    .eq('period_type', kind)
    .lt('capture_date', captureDate)
    .gte('capture_date', MONTH_METRICS_SINCE)
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
    for (const metric of METRICS) {
      // Most recent prior row of this period_type made under rules this
      // metric can be compared with (see comparableSince).
      const usable = rows.filter((r) => r.capture_date >= comparableSince(metric));
      const momRow = usable[0] || null;
      const yoyRow = usable.find((r) => r.capture_date <= elevenMonthsAgoStr) || null;
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

  if (dryRun) {
    return new Response(JSON.stringify({ kind, captureDate, rows: snapshotRows, changes: changeRows }, null, 1), { headers: { 'Content-Type': 'application/json' } });
  }

  // Rewrites only the four month figures on an existing capture (e.g. the
  // 2026-09-01 row, rebuilt with ?as_of=2026-09-01) so they can serve as the
  // previous month under the current rules. Nothing else is touched.
  if (backfillMonthMetrics) {
    for (const row of snapshotRows) {
      const { error } = await supabase
        .from('market_map_snapshots')
        .update(Object.fromEntries(MONTH_METRICS.map((m) => [m, row[m]])))
        .eq('area_slug', row.area_slug)
        .eq('capture_date', captureDate)
        .eq('period_type', kind);
      if (error) return new Response(`Backfill failed for ${row.area_slug}: ${error.message}`, { status: 500 });
    }
    // Their MoM changes too -- market-update-mailout reads median_sold_price_month's.
    const { error: changesError } = await supabase
      .from('market_map_changes')
      .upsert(changeRows.filter((c) => MONTH_METRICS.includes(c.metric)), { onConflict: 'area_slug,metric,capture_date,period_type' });
    if (changesError) console.error('heat-map-snapshot: month changes upsert failed:', changesError.message);
    console.log(`heat-map-snapshot: recounted ${MONTH_METRICS.join(', ')} on ${kind} ${captureDate}`);
    return new Response(`heat-map-snapshot: backfilled ${MONTH_METRICS.join(', ')} for ${snapshotRows.length} areas on ${kind} ${captureDate}`);
  }

  await previousKeysStore.setJSON('latest', currentKeysByArea);
  if (kind === 'month-end') await previousKeysStore.setJSON('month-end', currentKeysByArea);

  const { error: upsertError } = await supabase
    .from('market_map_snapshots')
    .upsert(snapshotRows, { onConflict: 'area_slug,capture_date,period_type' });
  if (upsertError) {
    console.error('heat-map-snapshot: snapshot upsert failed:', upsertError.message);
    return new Response('Snapshot upsert failed', { status: 500 });
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
  schedule: '0 9 * * *', // daily, 9am UTC — internal captureKind() guard: captures on the 1st and 16th, sales recount on the 6th
};
