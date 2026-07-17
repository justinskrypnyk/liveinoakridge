// Scheduled job — computes per-neighbourhood market stats (median list
// price, active listing count, average days on market, and change since
// the last pull) twice a month, on the 15th and the last day of the month,
// and writes one JSON snapshot to Blobs. Two different pages read that same
// snapshot afterwards:
//  - src/pages/api/market-stats.json.ts -> MarketTicker.astro (client-side)
//  - src/pages/areas/[area]/index.astro / oakridge/index.astro's static
//    "as of [date]..." sentence block (server-rendered, read at request time)
//
// Netlify cron has no native "last day of month" expression (month lengths
// vary), so this runs on a DAILY schedule and no-ops unless today is
// actually the 15th or the last day — exact, rather than approximating with
// e.g. "28-31" which would fire inconsistently across different month
// lengths.
//
// Runs standalone (not through Astro/Vite), so it can't use import.meta.env
// like the rest of the DDF code does — reads process.env directly and
// duplicates the minimal fetch/geocode-lookup logic instead of importing
// src/lib/ddf.ts, same convention as warm-geocode-cache-background.mjs and
// warm-photo-cache-background.mjs (keeps this job isolated from any risk to
// the already-working site code). The area boundary polygons are pure data
// (not evolving logic), so those ARE read directly off disk below.
import { getStore } from '@netlify/blobs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DDF_ACCESS_TOKEN = process.env.DDF_ACCESS_TOKEN;
const DDF_API_BASE_URL = process.env.DDF_API_BASE_URL;

// The 7 areas the site actually serves (src/data/areas.ts AREAS list) — not
// the Oakridge sub-neighbourhoods (Oakridge Acres, Hunt Club, Hazelden,
// Oakridge Park), which are anchor sections within the one Oakridge page,
// not separate areas with their own boundary polygon or listings.
const AREAS = [
  { slug: 'oakridge', name: 'Oakridge' },
  { slug: 'byron', name: 'Byron' },
  { slug: 'westmount', name: 'Westmount' },
  { slug: 'riverbend', name: 'Riverbend' },
  { slug: 'lambeth', name: 'Lambeth' },
  { slug: 'whitehills', name: 'Whitehills' },
  { slug: 'west-london', name: 'West London' },
];

function isSnapshotDay(date) {
  const isLastDayOfMonth = date.getDate() === new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  return date.getDate() === 15 || isLastDayOfMonth;
}

function loadAreaBoundaries() {
  const dataPath = fileURLToPath(new URL('../../src/data/area-boundaries.json', import.meta.url));
  const raw = JSON.parse(readFileSync(dataPath, 'utf-8'));
  return raw.features.map((f) => ({ slug: f.properties.slug, rings: f.geometry.coordinates }));
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

function computeChange(previous, current) {
  if (previous == null || current == null) return null;
  const value = current - previous;
  return { value, direction: value > 0 ? 'up' : value < 0 ? 'down' : 'flat' };
}

export default async (req) => {
  const now = new Date();
  // `?force=true` bypasses the 15th/last-day gate — lets a real snapshot be
  // seeded on demand (e.g. right after this feature first ships, rather
  // than waiting up to ~2 weeks for the next scheduled date) without
  // touching the automatic cadence for every other run. Deliberately not
  // gated behind a secret: this function is a background job with no
  // public link anywhere on the site, and the worst case of someone
  // guessing the URL is a few extra AMPRE reads, not a data exposure.
  const forced = req && new URL(req.url).searchParams.get('force') === 'true';
  if (!forced && !isSnapshotDay(now)) {
    return new Response(`market-stats-snapshot: not a snapshot day (${now.toISOString().slice(0, 10)}), skipping`);
  }

  if (!DDF_ACCESS_TOKEN || !DDF_API_BASE_URL) {
    console.error('market-stats-snapshot: missing required env vars');
    return new Response('Missing required env vars', { status: 500 });
  }

  const geocodeStore = getStore('ddf-geocode-cache');
  const statsStore = getStore('market-stats');
  const polygons = loadAreaBoundaries();

  const data = await odataGet('Property', {
    $filter: `contains(UnparsedAddress,'London')`,
    $select: 'ListingKey,UnparsedAddress,StandardStatus,PropertyType,TransactionType,ListPrice,OriginalEntryTimestamp',
    $top: '5000',
  });
  const all = data.value || [];
  const active = all.filter(
    (l) => l.StandardStatus === 'Active' && l.PropertyType !== 'Commercial' && l.TransactionType !== 'For Lease'
  );

  // Bucket every active listing into its area via the same geocode cache the
  // warm-geocode-cache-background.mjs job keeps warm (read-only lookup here
  // — this job doesn't geocode anything itself).
  const byArea = new Map(AREAS.map((a) => [a.slug, []]));
  for (const listing of active) {
    const address = listing.UnparsedAddress;
    if (!address) continue;
    const geo = await geocodeStore.get(address, { type: 'json' }).catch(() => null);
    if (!geo) continue;
    const slug = findAreaForPoint(polygons, geo.lat, geo.lng);
    if (slug && byArea.has(slug)) byArea.get(slug).push(listing);
  }

  const previousSnapshot = await statsStore.get('latest', { type: 'json' }).catch(() => null);
  const updatedAt = now.toISOString();
  const areas = {};

  for (const { slug, name } of AREAS) {
    const listings = byArea.get(slug) || [];
    const medianListPrice = median(listings.map((l) => Number(l.ListPrice)).filter((n) => n > 0));
    const activeCount = listings.length;
    const avgDaysOnMarket = average(
      listings.map((l) => daysSince(l.OriginalEntryTimestamp)).filter((n) => n !== null)
    );

    const previous = previousSnapshot?.areas?.[slug];
    areas[slug] = {
      slug,
      name,
      medianListPrice,
      activeCount,
      avgDaysOnMarket,
      change: {
        medianListPrice: computeChange(previous?.medianListPrice, medianListPrice),
        activeCount: computeChange(previous?.activeCount, activeCount),
        avgDaysOnMarket: computeChange(previous?.avgDaysOnMarket, avgDaysOnMarket),
      },
    };
  }

  await statsStore.setJSON('latest', { updatedAt, areas });

  const summary = `market-stats-snapshot done (${updatedAt}): ${AREAS.map((a) => `${a.slug}=${areas[a.slug].activeCount}`).join(', ')}`;
  console.log(summary);
  return new Response(summary);
};

export const config = {
  schedule: '0 9 * * *', // daily, 9am UTC — internal isSnapshotDay() guard makes this an effective 15th/last-day-of-month cadence
};
