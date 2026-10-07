// Nightly index behind /admin/comps/ (Justin, 2026-10-07: "give an address,
// find like properties that are active, sold or conditionally sold" for his
// CMAs). Internal-only use of the VOW feed, per Justin.
//
// One pass over the VOW feed for London plus the nearby towns, keeping:
//   - active listings
//   - conditional sales (MlsStatus "Sold Conditional...")
//   - sales that went firm in the last 24 months
// with every field that matters for picking comps (style, age range, size
// range, lot, basement, garage, septic/well...). Written to Blobs as one
// compact JSON so the admin page can score everything in the browser and
// re-sort instantly as Justin changes the subject's specs.
//
// AMPRE never populates Latitude/Longitude, so coordinates come from the
// shared ddf-geocode-cache (warmed by warm-geocode-cache + vow-sold-sync),
// then the same postal code, then the postal area's (FSA) centre. Each row
// carries how precise its location is. A few Google geocodes per run (most
// recent misses first) slowly improve that without touching the shared
// ~330/day cap (see reference-google-geocoding-billing).
import { getStore } from '@netlify/blobs';
import { fetchVow } from '../../src/lib/vow-listings.mjs';
import { COMPS_SELECT, isSale, statusOf, slim, placeOf } from '../../src/lib/comps-shared.mjs';

const VOW_ACCESS_TOKEN = process.env.VOW_ACCESS_TOKEN;
const DDF_API_BASE_URL = process.env.DDF_API_BASE_URL;
const GOOGLE_GEOCODING_API_KEY = process.env.GOOGLE_GEOCODING_API_KEY;

const SOLD_WINDOW_DAYS = 730;
const MAX_GOOGLE_GEOCODES_PER_RUN = 40;
const BLOB_CONCURRENCY = 40;

// London itself via the address filter (same as every other VOW job), then
// the towns around it so rural/edge-of-city subjects have comps too. The
// feed 0-results any contains() value with a space, so one word per town.
const TOWN_TERMS = ['Middlesex', 'Strathroy', 'Thames', 'Thomas', 'Elgin', 'Southwold', 'Lucan'];

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }));
  return out;
}

async function geocodeGoogle(address) {
  if (!GOOGLE_GEOCODING_API_KEY) return null;
  try {
    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    url.searchParams.set('address', `${address}, Ontario, Canada`);
    url.searchParams.set('key', GOOGLE_GEOCODING_API_KEY);
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const data = await res.json();
    const loc = data.status === 'OK' ? data.results?.[0]?.geometry?.location : null;
    return loc ? { lat: loc.lat, lng: loc.lng } : null;
  } catch {
    return null;
  }
}

export default async () => {
  if (!VOW_ACCESS_TOKEN || !DDF_API_BASE_URL) return new Response('VOW env missing', { status: 500 });
  const started = Date.now();
  const cutoffIso = new Date(Date.now() - SOLD_WINDOW_DAYS * 86400000).toISOString().slice(0, 10);
  const select = COMPS_SELECT;
  const opts = { baseUrl: DDF_API_BASE_URL, token: VOW_ACCESS_TOKEN, select };

  const batches = [
    await fetchVow({ ...opts, filter: "contains(UnparsedAddress,'London')", keep: (l) => isSale(l) && /^London\b/.test(l.City || '') }),
  ];
  for (const term of TOWN_TERMS) {
    try {
      batches.push(await fetchVow({ ...opts, filter: `contains(City,'${term}')`, keep: (l) => isSale(l) && !/^London\b/.test(l.City || '') }));
    } catch (err) {
      console.error(`comps-index: town ${term} failed:`, err.message);
    }
  }

  const byKey = new Map();
  for (const l of batches.flat()) {
    const st = statusOf(l, cutoffIso);
    if (st && l.UnparsedAddress && !byKey.has(l.ListingKey)) byKey.set(l.ListingKey, slim(l, st));
  }
  const rows = [...byKey.values()];

  // Coordinates: exact (geocode cache) -> same postal code -> postal area.
  const geoStore = getStore('ddf-geocode-cache');
  await mapLimit(rows, BLOB_CONCURRENCY, async (r) => {
    const g = await geoStore.get(r.a, { type: 'json' }).catch(() => null);
    if (g && Number.isFinite(g.lat)) { r.lat = g.lat; r.lng = g.lng; r.gp = 'exact'; }
  });

  let googled = 0;
  const misses = rows.filter((r) => r.gp !== 'exact').sort((x, y) => (y.d || '').localeCompare(x.d || ''));
  for (const r of misses.slice(0, MAX_GOOGLE_GEOCODES_PER_RUN)) {
    const g = await geocodeGoogle(r.a);
    if (!g) continue;
    googled++;
    r.lat = g.lat; r.lng = g.lng; r.gp = 'exact';
    await geoStore.setJSON(r.a, g).catch(() => {});
  }

  const centre = (key) => {
    const m = new Map();
    for (const r of rows) {
      if (r.gp !== 'exact' || !r.pc) continue;
      const k = key(r.pc);
      const e = m.get(k) || { lat: 0, lng: 0, n: 0 };
      e.lat += r.lat; e.lng += r.lng; e.n++;
      m.set(k, e);
    }
    return m;
  };
  const byPostal = centre((pc) => pc);
  const byFsa = centre((pc) => pc.slice(0, 3));
  for (const r of rows) {
    if (r.gp === 'exact' || !r.pc) continue;
    const e = byPostal.get(r.pc) || byFsa.get(r.pc.slice(0, 3));
    if (!e) continue;
    r.lat = e.lat / e.n; r.lng = e.lng / e.n;
    r.gp = byPostal.has(r.pc) ? 'postal' : 'area';
  }

  for (const r of rows) {
    if (r.lat == null) continue;
    Object.assign(r, placeOf(r.lat, r.lng));
  }

  const counts = { A: 0, C: 0, S: 0, exact: 0, approx: 0, noLocation: 0 };
  for (const r of rows) {
    counts[r.st]++;
    if (r.gp === 'exact') counts.exact++;
    else if (r.lat != null) counts.approx++;
    else counts.noLocation++;
  }

  const builtAt = new Date().toISOString();
  await getStore('comps-index').setJSON('latest', { builtAt, soldSince: cutoffIso, counts, rows });

  const summary = `comps-index: ${rows.length} rows (${counts.A} active, ${counts.C} conditional, ${counts.S} sold since ${cutoffIso}); location exact ${counts.exact}, approx ${counts.approx}, none ${counts.noLocation}; ${googled} new Google geocodes; ${Math.round((Date.now() - started) / 1000)}s`;
  console.log(summary);
  return new Response(summary);
};

export const config = {
  schedule: '30 12 * * *', // daily, 12:30 UTC -- after vow-sold-sync (10:00) has geocoded the newest sales, and after the 12:00 jobs
};
