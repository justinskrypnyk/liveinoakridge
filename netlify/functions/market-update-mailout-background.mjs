// Scheduled job -- monthly "here's what's happening in your area" mailout.
// Reuses the same market_map_snapshots/market_map_changes aggregate tables
// heat-map-snapshot-background.mjs already writes (median price, MoM/YoY
// change) -- no new data pipeline, just a new send target. Pulls its
// audience (email + area of interest) from whichever of the three lead
// tables actually has one: a saved search's area_slug, a saved listing's
// area_slug, or a home-watch address's derived area. Same AI-free
// principle as every other automated email here -- one templated sentence
// built from already-computed numbers, no interpretation.
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GHL_API_TOKEN = process.env.GHL_API_TOKEN;
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID;

function fmtPrice(n) {
  if (n == null) return 'n/a';
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(n);
}

function fmtPct(n) {
  if (n == null) return null;
  return `${n > 0 ? '+' : ''}${(n * 100).toFixed(1)}%`;
}

// Ray casting point-in-polygon -- same duplication reasoning as the other
// scheduled functions in this file's neighbourhood.
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

async function loadAreaRings() {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const dataPath = fileURLToPath(new URL('../../src/data/area-boundaries.json', import.meta.url));
  const raw = JSON.parse(readFileSync(dataPath, 'utf-8'));
  return raw.features.map((f) => ({ slug: f.properties.slug, name: f.properties.name, ring: f.geometry.coordinates[0] }));
}

function areaForPoint(lat, lng, areaRings) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const match = areaRings.find((a) => pointInRing(lat, lng, a.ring));
  return match?.slug ?? null;
}

async function pushMarketUpdate({ email, firstName, lastName, phone, summary }) {
  if (!GHL_API_TOKEN || !GHL_LOCATION_ID) {
    console.error('GHL env vars missing, skipping market update for', email);
    return;
  }
  const authHeaders = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Authorization: `Bearer ${GHL_API_TOKEN}`,
    Version: '2021-07-28',
  };
  const res = await fetch('https://services.leadconnectorhq.com/contacts/upsert', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      firstName: firstName || undefined,
      lastName: lastName || undefined,
      email,
      phone: phone || undefined,
      locationId: GHL_LOCATION_ID,
      tags: ['market-update'],
      customFields: [{ key: 'contact.market_update_summary', field_value: summary }],
      source: 'Website — Automated Recommendation',
    }),
  });
  if (!res.ok) {
    console.error('GHL upsert failed:', res.status, await res.text().catch(() => ''));
    return;
  }
  try {
    const upserted = await res.json();
    const contactId = upserted?.contact?.id;
    if (contactId) {
      const noteRes = await fetch(`https://services.leadconnectorhq.com/contacts/${contactId}/notes`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ body: summary }),
      });
      if (!noteRes.ok) console.error('GHL note failed:', noteRes.status, await noteRes.text().catch(() => ''));
    }
  } catch (err) {
    console.error('GHL note failed:', err);
  }
}

export default async () => {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('market-update-mailout: missing Supabase env vars');
    return new Response('Missing env vars', { status: 500 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: latestSnap } = await supabase
    .from('market_map_snapshots')
    .select('capture_date')
    .eq('period_type', 'month-end')
    .order('capture_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!latestSnap) return new Response('No month-end snapshot yet');

  const [{ data: snapshots }, { data: changes }, areaRings] = await Promise.all([
    supabase.from('market_map_snapshots').select('*').eq('capture_date', latestSnap.capture_date),
    supabase.from('market_map_changes').select('*').eq('capture_date', latestSnap.capture_date).eq('metric', 'median_sold_price_month'),
    loadAreaRings(),
  ]);

  const snapshotByArea = new Map((snapshots || []).map((s) => [s.area_slug, s]));
  const changeByArea = new Map((changes || []).map((c) => [c.area_slug, c]));

  function summaryForArea(areaSlug) {
    const snap = snapshotByArea.get(areaSlug);
    const areaName = areaRings.find((a) => a.slug === areaSlug)?.name || areaSlug;
    if (!snap) return `We don't have enough recent sales data in ${areaName} yet for a monthly update.`;
    const change = changeByArea.get(areaSlug);
    const momText = fmtPct(change?.mom_pct_change);
    return [
      `This month in ${areaName}: median sold price ${fmtPrice(snap.median_sold_price_month)}`,
      momText ? `(${momText} vs. last month)` : '',
      `· ${snap.units_sold_month ?? 0} homes sold · ${snap.new_listings_count ?? 0} new listings.`,
    ].filter(Boolean).join(' ');
  }

  // Pull (email, area_slug, name, phone) from each lead source that has an
  // area signal -- last one wins on duplicate emails, fine for this purpose.
  const audience = new Map();

  const { data: savedSearches } = await supabase.from('saved_searches').select('email, first_name, last_name, phone, area_slug').not('area_slug', 'is', null);
  for (const r of savedSearches || []) audience.set(r.email, r);

  const { data: savedListings } = await supabase.from('saved_listings').select('email, first_name, last_name, phone, area_slug').not('area_slug', 'is', null);
  for (const r of savedListings || []) audience.set(r.email, r);

  const { data: homeWatches } = await supabase.from('home_watch_subscriptions').select('email, first_name, last_name, phone, latitude, longitude');
  for (const r of homeWatches || []) {
    const areaSlug = areaForPoint(r.latitude, r.longitude, areaRings);
    if (areaSlug) audience.set(r.email, { ...r, area_slug: areaSlug });
  }

  let sent = 0;
  for (const person of audience.values()) {
    await pushMarketUpdate({
      email: person.email,
      firstName: person.first_name,
      lastName: person.last_name,
      phone: person.phone,
      summary: summaryForArea(person.area_slug),
    });
    sent++;
  }

  const summaryLine = `market-update-mailout: sent ${sent} updates for ${latestSnap.capture_date}`;
  console.log(summaryLine);
  return new Response(summaryLine);
};

export const config = {
  schedule: '0 15 1 * *', // 1st of month, 3pm UTC -- after monthly-digest (1pm) and its map render
};
