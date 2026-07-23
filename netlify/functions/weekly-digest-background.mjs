// Scheduled job -- emails Justin a plain-numbers weekly digest (previous
// Mon-Sun) of active + sold market activity: citywide totals, a
// per-neighbourhood breakdown for the 7 areas this site actually serves, a
// property-type split, and notable individual sales (highest/lowest/fastest
// price this week). Deliberately NOT an AI-authored summary: every number
// here is computed by this script (plain JS math over DDF active listings +
// vow_sold_listings), and the email is assembled from a fixed template --
// no LLM touches the underlying data at any point, consistent with the VOW
// agreement's Article 6.2(a) AI System restriction on the sold-data half of
// this (see supabase/schema.sql's comment above vow_sold_listings).
import { getStore } from '@netlify/blobs';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DDF_ACCESS_TOKEN = process.env.DDF_ACCESS_TOKEN;
const DDF_API_BASE_URL = process.env.DDF_API_BASE_URL;
const GOOGLE_GEOCODING_API_KEY = process.env.GOOGLE_GEOCODING_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const DIGEST_TO_EMAIL = process.env.DIGEST_TO_EMAIL || 'info@homeswithjustin.ca';

// The 7 areas this site's own content pages serve -- same set as
// market-map.astro's SERVED_AREA_SLUGS. Everything else (of the 39 total
// boundaries) still counts toward citywide totals but isn't broken out by
// name in the digest -- bolded AND sorted first (in this fixed order,
// then every other area alphabetically after) in the per-neighbourhood
// table below, per Justin.
const SERVED_AREA_ORDER = ['oakridge', 'byron', 'westmount', 'riverbend', 'lambeth', 'whitehills', 'west-london'];
const SERVED_AREA_SLUGS = new Set(SERVED_AREA_ORDER);

function sortAreasServedFirst(areas) {
  return [...areas].sort((a, b) => {
    const aIdx = SERVED_AREA_ORDER.indexOf(a.slug);
    const bIdx = SERVED_AREA_ORDER.indexOf(b.slug);
    if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
    if (aIdx !== -1) return -1;
    if (bIdx !== -1) return 1;
    return a.name.localeCompare(b.name);
  });
}

const TYPE_CATEGORIES = [
  { label: 'Detached', match: (s) => s.includes('detached') && !s.includes('semi') },
  { label: 'Semi-Detached', match: (s) => s.includes('semi') },
  { label: 'Townhouse', match: (s) => s.includes('townhouse') || s.includes('row') },
  { label: 'Condo/Apartment', match: (s) => s.includes('condo') || s.includes('apartment') },
  { label: 'Other', match: () => true },
];
function categorize(subType) {
  const s = (subType || '').toLowerCase();
  return TYPE_CATEGORIES.find((c) => c.match(s)).label;
}

function loadAllAreaBoundaries() {
  const dataPath = fileURLToPath(new URL('../../src/data/area-boundaries.json', import.meta.url));
  const raw = JSON.parse(readFileSync(dataPath, 'utf-8'));
  return raw.features.map((f) => ({ slug: f.properties.slug, name: f.properties.name, rings: f.geometry.coordinates }));
}
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

function averageRatio(numbers) {
  if (numbers.length === 0) return null;
  return Math.round((numbers.reduce((sum, n) => sum + n, 0) / numbers.length) * 1000) / 1000;
}

function daysSince(timestamp) {
  const then = new Date(timestamp).getTime();
  if (Number.isNaN(then)) return null;
  return Math.max(0, Math.floor((Date.now() - then) / (1000 * 60 * 60 * 24)));
}

function fmtPrice(n) {
  if (n == null) return 'n/a';
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(n);
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function sendDigestEmail(subject, html) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Live In Oakridge Reports <onboarding@resend.dev>',
      to: DIGEST_TO_EMAIL,
      subject,
      html,
    }),
  });
  if (!res.ok) throw new Error(`Resend send failed -> HTTP ${res.status}: ${await res.text().catch(() => '')}`);
}

export default async () => {
  if (!DDF_ACCESS_TOKEN || !DDF_API_BASE_URL || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !RESEND_API_KEY) {
    console.error('weekly-digest: missing required env vars', {
      DDF_ACCESS_TOKEN: !!DDF_ACCESS_TOKEN, DDF_API_BASE_URL: !!DDF_API_BASE_URL,
      SUPABASE_URL: !!SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: !!SUPABASE_SERVICE_ROLE_KEY,
      RESEND_API_KEY: !!RESEND_API_KEY,
    });
    return new Response('Missing required env vars', { status: 500 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const polygons = loadAllAreaBoundaries();
  const now = new Date();

  // Previous Mon-Sun -- this runs Monday morning, so "previous week" is the
  // 7 days ending yesterday.
  const weekEnd = new Date(now);
  weekEnd.setDate(weekEnd.getDate() - 1);
  const weekStart = new Date(weekEnd);
  weekStart.setDate(weekStart.getDate() - 6);
  const weekStartStr = weekStart.toISOString().slice(0, 10);
  const weekEndStr = weekEnd.toISOString().slice(0, 10);

  // ---- Active listings, citywide, then area-matched via the shared geocode cache ----
  const activeData = await odataGet('Property', {
    $filter: `contains(UnparsedAddress,'London')`,
    $select: 'ListingKey,UnparsedAddress,StandardStatus,PropertyType,PropertySubType,TransactionType,ListPrice,OriginalEntryTimestamp',
    $top: '5000',
  });
  const active = (activeData.value || []).filter(
    (l) => l.StandardStatus === 'Active' && l.PropertyType !== 'Commercial' && l.TransactionType !== 'For Lease'
  );
  const newThisWeek = active.filter((l) => {
    const d = new Date(l.OriginalEntryTimestamp);
    return d >= weekStart && d <= now;
  });

  let geocodeStore = null;
  try {
    geocodeStore = getStore('ddf-geocode-cache'); // shared with DDF/heat-map jobs -- read-only here, cache-hit-only (no new Google calls from this job)
  } catch {
    // Blobs unavailable (e.g. local invocation without Netlify's runtime) -- area breakdown just comes back empty below.
  }
  const activeByArea = new Map(polygons.map((a) => [a.slug, []]));
  if (geocodeStore) {
    for (const listing of active) {
      const address = listing.UnparsedAddress;
      if (!address) continue;
      const geo = await geocodeStore.get(address, { type: 'json' }).catch(() => null);
      if (!geo) continue;
      const slug = findAreaForPoint(polygons, geo.lat, geo.lng);
      if (slug && activeByArea.has(slug)) activeByArea.get(slug).push(listing);
    }
  }

  const activePrices = active.map((l) => Number(l.ListPrice)).filter((n) => n > 0);
  const activeDom = active.map((l) => daysSince(l.OriginalEntryTimestamp)).filter((n) => n !== null);

  const activeByType = new Map();
  for (const l of active) {
    const cat = categorize(l.PropertySubType || l.PropertyType);
    if (!activeByType.has(cat)) activeByType.set(cat, []);
    activeByType.get(cat).push(l);
  }

  // ---- Sold, citywide -- resale only (excludes pre-construction/future-dated closings) ----
  const todayStr = now.toISOString().slice(0, 10);
  const soldDateTo = weekEndStr < todayStr ? weekEndStr : todayStr;
  const { data: soldRows } = await supabase
    .from('vow_sold_listings')
    .select('address, area_slug, close_price, list_price, close_date, listing_contract_date, property_sub_type')
    .gte('close_date', weekStartStr)
    .lte('close_date', soldDateTo);
  const sold = soldRows || [];

  const soldPrices = sold.map((r) => Number(r.close_price)).filter((n) => n > 0);
  const saleToListRatios = sold
    .map((r) => (Number(r.list_price) > 0 ? Number(r.close_price) / Number(r.list_price) : null))
    .filter((n) => n !== null);

  const soldByArea = new Map(polygons.map((a) => [a.slug, []]));
  for (const r of sold) {
    if (r.area_slug && soldByArea.has(r.area_slug)) soldByArea.get(r.area_slug).push(r);
  }

  const soldByType = new Map();
  for (const r of sold) {
    const cat = categorize(r.property_sub_type);
    if (!soldByType.has(cat)) soldByType.set(cat, []);
    soldByType.get(cat).push(r);
  }

  // Notable sales -- highest/lowest always computable; fastest only among
  // rows that already have listing_contract_date populated (added to the
  // sync going forward, not backfilled for already-synced rows -- see
  // supabase/schema.sql).
  const soldWithPrice = sold.filter((r) => Number(r.close_price) > 0);
  const highest = soldWithPrice.length > 0 ? soldWithPrice.reduce((a, b) => (Number(a.close_price) > Number(b.close_price) ? a : b)) : null;
  const lowest = soldWithPrice.length > 0 ? soldWithPrice.reduce((a, b) => (Number(a.close_price) < Number(b.close_price) ? a : b)) : null;
  const withDom = sold
    .filter((r) => r.listing_contract_date && r.close_date)
    .map((r) => ({ ...r, dom: Math.round((new Date(r.close_date) - new Date(r.listing_contract_date)) / (1000 * 60 * 60 * 24)) }))
    .filter((r) => r.dom >= 0);
  const fastest = withDom.length > 0 ? withDom.reduce((a, b) => (a.dom < b.dom ? a : b)) : null;

  // ---- Build the email ----
  // All 39 areas from the heat map, not just the 7 this site's own content
  // pages serve -- per Justin. The 7 served areas first (fixed order),
  // then every other area alphabetically.
  const areaRows = sortAreasServedFirst(polygons)
    .map((a) => {
      const areaActive = activeByArea.get(a.slug) || [];
      const areaSold = soldByArea.get(a.slug) || [];
      const areaSoldPrices = areaSold.map((r) => Number(r.close_price)).filter((n) => n > 0);
      const isServed = SERVED_AREA_SLUGS.has(a.slug);
      const nameCell = isServed ? `<strong>${esc(a.name)}</strong>` : esc(a.name);
      return `<tr>
        <td style="padding:4px 10px;">${nameCell}</td>
        <td style="padding:4px 10px;">${areaActive.length}</td>
        <td style="padding:4px 10px;">${areaSold.length}</td>
        <td style="padding:4px 10px;">${fmtPrice(median(areaSoldPrices))}</td>
      </tr>`;
    }).join('');

  const typeRows = TYPE_CATEGORIES.map((t) => {
    const typeActive = activeByType.get(t.label) || [];
    const typeSold = soldByType.get(t.label) || [];
    const typeSoldPrices = typeSold.map((r) => Number(r.close_price)).filter((n) => n > 0);
    if (typeActive.length === 0 && typeSold.length === 0) return '';
    return `<tr>
      <td style="padding:4px 10px;">${esc(t.label)}</td>
      <td style="padding:4px 10px;">${typeActive.length}</td>
      <td style="padding:4px 10px;">${typeSold.length}</td>
      <td style="padding:4px 10px;">${fmtPrice(median(typeSoldPrices))}</td>
    </tr>`;
  }).join('');

  const html = `
    <h2>Weekly Market Digest — ${weekStartStr} to ${weekEndStr}</h2>

    <h3>Citywide Totals</h3>
    <ul>
      <li>Active listings: ${active.length} (${newThisWeek.length} new this week)</li>
      <li>Median list price: ${fmtPrice(median(activePrices))} · Avg days on market: ${average(activeDom) ?? 'n/a'}</li>
      <li>Units sold this week: ${soldPrices.length} (resale only, excludes pre-construction)</li>
      <li>Median sold price: ${fmtPrice(median(soldPrices))} · Avg sale-to-list: ${saleToListRatios.length > 0 ? `${(averageRatio(saleToListRatios) * 100).toFixed(1)}%` : 'n/a'}</li>
    </ul>

    <h3>By Neighbourhood (all 39 -- bold are your 7 served areas)</h3>
    <table style="border-collapse:collapse;font-size:13px;">
      <tr style="font-weight:bold;border-bottom:1px solid #ccc;"><td style="padding:4px 10px;">Area</td><td style="padding:4px 10px;">Active</td><td style="padding:4px 10px;">Sold</td><td style="padding:4px 10px;">Median Sold</td></tr>
      ${areaRows}
    </table>

    <h3>By Property Type</h3>
    <table style="border-collapse:collapse;font-size:13px;">
      <tr style="font-weight:bold;border-bottom:1px solid #ccc;"><td style="padding:4px 10px;">Type</td><td style="padding:4px 10px;">Active</td><td style="padding:4px 10px;">Sold</td><td style="padding:4px 10px;">Median Sold</td></tr>
      ${typeRows}
    </table>

    <h3>Notable Sales This Week</h3>
    <ul>
      <li>Highest: ${highest ? `${esc(highest.address)} — ${fmtPrice(highest.close_price)}` : 'n/a'}</li>
      <li>Lowest: ${lowest ? `${esc(lowest.address)} — ${fmtPrice(lowest.close_price)}` : 'n/a'}</li>
      <li>Fastest: ${fastest ? `${esc(fastest.address)} — sold in ${fastest.dom} days` : 'not enough data yet (tracking starts now)'}</li>
    </ul>

    <p style="font-size:12px;color:#888;">Auto-generated from live MLS data -- no AI involved in compiling these numbers.</p>
  `;

  await sendDigestEmail(`Weekly Market Digest — ${weekStartStr} to ${weekEndStr}`, html);

  const summary = `weekly-digest sent: ${active.length} active (${newThisWeek.length} new), ${soldPrices.length} sold this week`;
  console.log(summary);
  return new Response(summary);
};

export const config = {
  schedule: '0 13 * * 1', // Monday, 1pm UTC (~8-9am Eastern)
};
