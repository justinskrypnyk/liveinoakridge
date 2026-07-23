// Scheduled job -- "new homes in the area you're searching" alerts. Checks
// every saved_searches row (captured via the "🔔 Notify Me" button on
// /search, see api/save-search.json.ts) for active listings that are both a
// match on that row's criteria AND newly listed since it was last checked.
// Public active-listing/DDF data only (same feed /search already shows to
// anyone) -- no VOW registration question here, unlike home-watch-alerts.
//
// AMPRE only supports a single contains() filter with no compound
// conditions (see project notes) -- so this fetches one broad London-area
// candidate pool, then applies every other criterion (price/type/beds/area/
// recency) in plain JS per saved search, same pattern as searchMarketListings
// in src/lib/ddf.ts. Self-contained rather than importing that file --
// this repo keeps Netlify Functions and src/lib deliberately separate.
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DDF_ACCESS_TOKEN = process.env.DDF_ACCESS_TOKEN;
const DDF_API_BASE_URL = process.env.DDF_API_BASE_URL;
const GHL_API_TOKEN = process.env.GHL_API_TOKEN;
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID;
const SITE_URL = 'https://www.liveinoakridge.ca';

const FREQUENCY_MIN_HOURS = { daily: 20, weekly: 24 * 6.5, monthly: 24 * 27 };

const SELECT_FIELDS = [
  'ListingKey', 'StandardStatus', 'TransactionType', 'ListPrice', 'UnparsedAddress',
  'City', 'Latitude', 'Longitude', 'BedroomsTotal', 'BathroomsTotalInteger',
  'PropertyType', 'PropertySubType', 'OriginalEntryTimestamp',
].join(',');

function isDue(sub) {
  if (!sub.last_notified_at) return true;
  const hoursSince = (Date.now() - new Date(sub.last_notified_at).getTime()) / (1000 * 60 * 60);
  return hoursSince >= (FREQUENCY_MIN_HOURS[sub.frequency] ?? FREQUENCY_MIN_HOURS.weekly);
}

async function fetchCandidatePool() {
  const url = new URL(`${DDF_API_BASE_URL}Property`);
  url.searchParams.set('$filter', "contains(City,'London')");
  url.searchParams.set('$select', SELECT_FIELDS);
  url.searchParams.set('$top', '500');
  const res = await fetch(url, { headers: { Authorization: `Bearer ${DDF_ACCESS_TOKEN}`, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Property fetch -> HTTP ${res.status}`);
  const data = await res.json();
  return (data.value || []).filter(
    (l) => l.StandardStatus === 'Active' && l.PropertyType !== 'Commercial' && l.TransactionType !== 'For Lease'
  );
}

// Ray casting point-in-polygon, same algorithm as src/lib/area-boundaries.ts
// -- duplicated rather than imported for the same cross-boundary reason as
// elsewhere in this file.
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
  return raw.features.map((f) => ({ slug: f.properties.slug, ring: f.geometry.coordinates[0] }));
}

async function pushToGhl({ email, firstName, lastName, phone, intro, lines }) {
  if (!GHL_API_TOKEN || !GHL_LOCATION_ID) {
    console.error('GHL env vars missing, skipping push for', email);
    return;
  }
  const authHeaders = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Authorization: `Bearer ${GHL_API_TOKEN}`,
    Version: '2021-07-28',
  };
  const customFields = lines.map((value, i) => ({ key: `contact.recommended_listing_${i + 1}`, field_value: value }));

  const res = await fetch('https://services.leadconnectorhq.com/contacts/upsert', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      firstName: firstName || undefined,
      lastName: lastName || undefined,
      email,
      phone: phone || undefined,
      locationId: GHL_LOCATION_ID,
      tags: ['search-area-alert'],
      customFields,
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
        body: JSON.stringify({ body: [intro, ...lines].join('\n') }),
      });
      if (!noteRes.ok) console.error('GHL note failed:', noteRes.status, await noteRes.text().catch(() => ''));
    }
  } catch (err) {
    console.error('GHL note failed:', err);
  }
}

export default async () => {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !DDF_ACCESS_TOKEN || !DDF_API_BASE_URL) {
    console.error('saved-search-alerts: missing required env vars');
    return new Response('Missing env vars', { status: 500 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: searches, error: searchesError } = await supabase.from('saved_searches').select('*');
  if (searchesError) {
    console.error('saved-search-alerts: query failed:', searchesError.message);
    return new Response('Query failed', { status: 500 });
  }
  if (!searches || searches.length === 0) return new Response('No saved searches');

  const dueSearches = searches.filter(isDue);
  if (dueSearches.length === 0) return new Response('Nothing due');

  const [candidates, areaRings] = await Promise.all([fetchCandidatePool(), loadAreaRings()]);

  let sent = 0;
  for (const sub of dueSearches) {
    const sinceIso = sub.last_notified_at || sub.created_at;

    const matches = candidates.filter((l) => {
      if (l.OriginalEntryTimestamp && new Date(l.OriginalEntryTimestamp) <= new Date(sinceIso)) return false;
      if (sub.min_price && (Number(l.ListPrice) || 0) < sub.min_price) return false;
      if (sub.max_price && (Number(l.ListPrice) || 0) > sub.max_price) return false;
      if (sub.min_beds && (Number(l.BedroomsTotal) || 0) < sub.min_beds) return false;
      if (sub.min_baths && (Number(l.BathroomsTotalInteger) || 0) < sub.min_baths) return false;
      if (sub.property_types && sub.property_types.length > 0) {
        const sub_type = String(l.PropertySubType || l.PropertyType || '').toLowerCase();
        if (!sub.property_types.some((t) => sub_type.includes(String(t).toLowerCase()))) return false;
      }
      if (sub.area_slug) {
        const lat = Number(l.Latitude), lng = Number(l.Longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
        const areaRing = areaRings.find((a) => a.slug === sub.area_slug);
        if (!areaRing || !pointInRing(lat, lng, areaRing.ring)) return false;
      }
      return true;
    }).slice(0, 3);

    if (matches.length > 0) {
      await pushToGhl({
        email: sub.email,
        firstName: sub.first_name,
        lastName: sub.last_name,
        phone: sub.phone,
        intro: 'New homes matching your search:',
        lines: matches.map((l) =>
          `${l.UnparsedAddress} — $${Math.round(Number(l.ListPrice) || 0).toLocaleString('en-CA')} — ${SITE_URL}/search/${l.ListingKey}/`
        ),
      });
      sent++;
    }

    await supabase.from('saved_searches').update({ last_notified_at: new Date().toISOString() }).eq('id', sub.id);
  }

  const summary = `saved-search-alerts: checked ${dueSearches.length} due searches, sent ${sent} alerts`;
  console.log(summary);
  return new Response(summary);
};

export const config = {
  schedule: '30 11 * * *', // daily, 11:30am UTC -- alongside home-watch-alerts
};
