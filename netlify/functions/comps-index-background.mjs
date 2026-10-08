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
// carries how precise its location is.
//
// Cache misses (mostly the towns, ~4,800 homes nothing else geocodes) get a
// free lookup first: the Government of Canada geolocator (NRCan road
// network + OpenStreetMap), one request at a time -- it 500s on parallel
// requests -- and only accepted on an exact house-number match within 80 km.
// It finds ~57% of town homes (tested 2026-10-07 on 150). Addresses it can't
// find are remembered for 60 days, and only those go to Google, a few per
// run, inside the shared ~330/day cap (see reference-google-geocoding-billing).
import { getStore } from '@netlify/blobs';
import { fetchVow } from '../../src/lib/vow-listings.mjs';
import { COMPS_SELECT, isSale, statusOf, slim, placeOf } from '../../src/lib/comps-shared.mjs';

const VOW_ACCESS_TOKEN = process.env.VOW_ACCESS_TOKEN;
const DDF_API_BASE_URL = process.env.DDF_API_BASE_URL;
const GOOGLE_GEOCODING_API_KEY = process.env.GOOGLE_GEOCODING_API_KEY;

const SOLD_WINDOW_DAYS = 730;
const MAX_GOOGLE_GEOCODES_PER_RUN = 40;
// Time box for the free lookups; the rest wait for the next run. Overridable
// for a one-off backfill run outside Netlify.
const FREE_GEOCODE_BUDGET_MS = Number(process.env.COMPS_FREE_GEOCODE_BUDGET_MS) || 8 * 60 * 1000;
const FREE_MISS_RETRY_DAYS = 60;
const LONDON = { lat: 42.9849, lng: -81.2453 };
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

function km(aLat, aLng, bLat, bLng) {
  const R = 6371, t = Math.PI / 180;
  const h = Math.sin(((bLat - aLat) * t) / 2) ** 2 + Math.cos(aLat * t) * Math.cos(bLat * t) * Math.sin(((bLng - aLng) * t) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const STREET_WORDS = /^(st|rd|dr|ave|street|road|drive|avenue|crescent|cres|court|crt|lane|line|way|place|blvd|boulevard|trail|north|south|east|west|terrace|gate|circle)$/;

// Free geocode. Returns {lat, lng} only for an exact house-number match on
// the right street in Ontario near London; anything vaguer returns null.
async function geocodeFree(address) {
  // "41 Earlscourt Terrace 24, Middlesex Centre, ON N0L 1R0" -> 41 / Earlscourt Terrace / Middlesex Centre
  const m = address.match(/^(?:[\w-]+-)?(\d+[A-Za-z]?)\s+([^,]+?)(?:\s+(?:unit\s*)?#?\d+[A-Za-z]?)?\s*,\s*([^,]+)/i);
  if (!m) return null;
  const [, num, street, town] = m;
  const words = norm(street).split(' ');
  const word = words.find((w) => w.length > 2 && !STREET_WORDS.test(w)) || words[0];
  const q = `${num} ${street}, ${town}, Ontario`;
  for (let tries = 0; tries < 2; tries++) {
    try {
      const res = await fetch(`https://geolocator.api.geo.ca/?q=${encodeURIComponent(q)}`, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(String(res.status));
      const hits = await res.json();
      if (!Array.isArray(hits)) return null;
      const hit = hits.find((x) => x.province === 'Ontario' && `${norm(x.name)} `.startsWith(`${norm(num)} `) && norm(x.name).includes(word));
      if (!hit || !Number.isFinite(hit.lat) || km(hit.lat, hit.lng, LONDON.lat, LONDON.lng) > 80) return null;
      return { lat: hit.lat, lng: hit.lng };
    } catch {
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  return null;
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

  // Free lookups, newest first, one at a time; remember what they can't find.
  const missStore = getStore('comps-geo-misses');
  const freeMisses = (await missStore.get('free', { type: 'json' }).catch(() => null)) || {};
  const retryBefore = new Date(Date.now() - FREE_MISS_RETRY_DAYS * 86400000).toISOString();
  const uncached = [...new Map(rows.filter((r) => r.gp !== 'exact').sort((x, y) => (y.d || '').localeCompare(x.d || '')).map((r) => [r.a, r])).values()];
  const found = new Map();
  let freeFound = 0, freeTried = 0;
  const freeStop = Date.now() + FREE_GEOCODE_BUDGET_MS;
  for (const r of uncached) {
    if (Date.now() > freeStop) break;
    if (freeMisses[r.a] && freeMisses[r.a] > retryBefore) continue;
    freeTried++;
    const g = await geocodeFree(r.a);
    if (g) {
      freeFound++;
      found.set(r.a, g);
      delete freeMisses[r.a];
      await geoStore.setJSON(r.a, { ...g, src: 'geo.ca' }).catch(() => {});
    } else {
      freeMisses[r.a] = new Date().toISOString();
    }
    await new Promise((res) => setTimeout(res, 200));
  }
  await missStore.setJSON('free', freeMisses).catch(() => {});

  // Google only for what the free lookup couldn't find, newest first.
  let googled = 0;
  for (const r of uncached.filter((x) => freeMisses[x.a]).slice(0, MAX_GOOGLE_GEOCODES_PER_RUN)) {
    const g = await geocodeGoogle(r.a);
    if (!g) continue;
    googled++;
    delete freeMisses[r.a];
    found.set(r.a, g);
    await geoStore.setJSON(r.a, g).catch(() => {});
  }
  if (googled) await missStore.setJSON('free', freeMisses).catch(() => {});
  for (const r of rows) {
    const g = r.gp !== 'exact' && found.get(r.a);
    if (g) { r.lat = g.lat; r.lng = g.lng; r.gp = 'exact'; }
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

  const summary = `comps-index: ${rows.length} rows (${counts.A} active, ${counts.C} conditional, ${counts.S} sold since ${cutoffIso}); location exact ${counts.exact}, approx ${counts.approx}, none ${counts.noLocation}; free lookups ${freeFound}/${freeTried} found; ${googled} new Google geocodes; ${Math.round((Date.now() - started) / 1000)}s`;
  console.log(summary);
  return new Response(summary);
};

export const config = {
  schedule: '30 12 * * *', // daily, 12:30 UTC -- after vow-sold-sync (10:00) has geocoded the newest sales, and after the 12:00 jobs
};
