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
//
// FIXED 2026-09-23 -- this job had never actually found a new listing:
//   1. The pool was `$top=500` with no ordering available (AMPRE rejects
//      $orderby), and AMPRE returns an arbitrary/oldest-first slice -- the
//      newest listing in those 500 was two months old. Now `$top=5000`,
//      which returns the whole London pool (~2,900 rows, no nextLink), same
//      as firm-sale-tracker/heat-map-snapshot.
//   2. AMPRE has NO coordinates on any listing (0 of ~1,900 active), so the
//      area_slug check never matched. Coordinates now come from the shared
//      `ddf-geocode-cache` blob store (kept warm by warm-geocode-cache),
//      falling back to Google for a bounded number of misses per run.
//   3. One GHL push per saved_searches ROW meant a person with several
//      searches (a school lead gets one per neighbourhood the school
//      serves) got several upserts in the same run, each overwriting the
//      same recommended_listing_1..3 fields before GHL could email them.
//      Now grouped: one push per email with its best 3 new matches.
//   4. The upsert sent `tags: ['search-area-alert']` and a `source` --
//      GHL's upsert REPLACES tags and overwrites source, so every alert
//      wiped the contact's Website Lead/School Search Lead/etc. tags and
//      relabelled where the lead came from. Tags now go through the
//      merging add-tags endpoint; source is only set on a brand-new contact.

import { getStore } from '@netlify/blobs';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DDF_ACCESS_TOKEN = process.env.DDF_ACCESS_TOKEN;
const DDF_API_BASE_URL = process.env.DDF_API_BASE_URL;
const GHL_API_TOKEN = process.env.GHL_API_TOKEN;
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID;
const GOOGLE_GEOCODING_API_KEY = process.env.GOOGLE_GEOCODING_API_KEY;
const SITE_URL = 'https://www.liveinoakridge.ca';

const FREQUENCY_MIN_HOURS = { daily: 20, mwf: 20, weekly: 24 * 6.5, monthly: 24 * 27 };
const FETCH_TIMEOUT_MS = 15000;
// warm-geocode-cache fills the store, so this job should rarely need Google
// at all. Kept small: the whole site shares Google's 10k/month free
// geocoding allowance (~330/day), and every job has its own per-run cap.
const MAX_GOOGLE_GEOCODES_PER_RUN = 25;

const SELECT_FIELDS = [
  'ListingKey', 'StandardStatus', 'TransactionType', 'ListPrice', 'UnparsedAddress',
  'City', 'BedroomsTotal', 'BathroomsTotalInteger',
  'PropertyType', 'PropertySubType', 'OriginalEntryTimestamp',
].join(',');

// 'mwf' (school leads, see api/ghl-lead.ts) is due on Monday, Wednesday and
// Friday mornings, Toronto time. The window between those runs still
// carries over (sinceIso is last_notified_at), so a Saturday listing shows
// up in Monday's email. Still only emails when there are new homes.
const MWF_DAYS = new Set(['Mon', 'Wed', 'Fri']);
function isMwfDay() {
  return MWF_DAYS.has(new Intl.DateTimeFormat('en-CA', { weekday: 'short', timeZone: 'America/Toronto' }).format(new Date()));
}

function isDue(sub) {
  if (sub.frequency === 'mwf' && !isMwfDay()) return false;
  if (!sub.last_notified_at) return true;
  const hoursSince = (Date.now() - new Date(sub.last_notified_at).getTime()) / (1000 * 60 * 60);
  return hoursSince >= (FREQUENCY_MIN_HOURS[sub.frequency] ?? FREQUENCY_MIN_HOURS.weekly);
}

async function fetchCandidatePool() {
  const url = new URL(`${DDF_API_BASE_URL}Property`);
  url.searchParams.set('$filter', "contains(City,'London')");
  url.searchParams.set('$select', SELECT_FIELDS);
  url.searchParams.set('$top', '5000');
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${DDF_ACCESS_TOKEN}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(60000),
  });
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

// Same as firm-sale-tracker-background.mjs's geocodeGoogle -- duplicated per
// this directory's isolation convention.
async function geocodeGoogle(address) {
  if (!GOOGLE_GEOCODING_API_KEY) return null;
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

// Coordinates for a listing via the shared geocode cache (keyed by
// UnparsedAddress, same as every other DDF job), memoized for this run.
function makeGeocoder() {
  const store = getStore('ddf-geocode-cache');
  const memo = new Map();
  let googleCalls = 0;
  return async (address) => {
    if (!address) return null;
    if (memo.has(address)) return memo.get(address);
    let geo = await store.get(address, { type: 'json' }).catch(() => null);
    if (!geo && googleCalls < MAX_GOOGLE_GEOCODES_PER_RUN) {
      googleCalls++;
      geo = await geocodeGoogle(address);
      if (geo) await store.setJSON(address, geo).catch(() => {});
    }
    memo.set(address, geo || null);
    return geo || null;
  };
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
  // Always all 3 -- an empty value clears the field (confirmed live), so a
  // 1-listing alert doesn't email last time's leftover listings 2 and 3.
  const customFields = [0, 1, 2].map((i) => ({ key: `recommended_listing_${i + 1}`, fieldValue: lines[i] ?? '' }));

  // No tags/source in the upsert -- GHL would replace the contact's tags and
  // overwrite its original source. See the header comment.
  const res = await fetch('https://services.leadconnectorhq.com/contacts/upsert', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      firstName: firstName || undefined,
      lastName: lastName || undefined,
      email,
      phone: phone || undefined,
      locationId: GHL_LOCATION_ID,
      customFields,
    }),
  });
  if (!res.ok) {
    console.error('GHL upsert failed:', res.status, await res.text().catch(() => ''));
    return;
  }
  try {
    const upserted = await res.json();
    const contactId = upserted?.contact?.id;
    if (!contactId) return;

    // A "Notify Me" search from /search never went through a form, so the
    // alert can be the contact's first touch -- label only those.
    if (upserted.new) {
      await fetch(`https://services.leadconnectorhq.com/contacts/${contactId}`, {
        method: 'PUT',
        headers: authHeaders,
        body: JSON.stringify({ source: 'Website — Saved Search Alert' }),
      }).catch(() => {});
    }

    const noteRes = await fetch(`https://services.leadconnectorhq.com/contacts/${contactId}/notes`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ body: [intro, ...lines].join('\n') }),
    });
    if (!noteRes.ok) console.error('GHL note failed:', noteRes.status, await noteRes.text().catch(() => ''));

    // Last, so the tag-triggered GHL workflow sees the fields/note already set.
    // Merges with the contact's existing tags. Remove first, then add: GHL
    // workflows fire on "tag added", which never happens if the tag is still
    // on the contact from a previous alert (e.g.
    // one sent before the workflow existed, or a workflow that doesn't strip
    // it). Removing a tag the contact doesn't have is a harmless no-op.
    await fetch(`https://services.leadconnectorhq.com/contacts/${contactId}/tags`, {
      method: 'DELETE',
      headers: authHeaders,
      body: JSON.stringify({ tags: ['search-area-alert'] }),
    }).catch(() => {});
    const tagRes = await fetch(`https://services.leadconnectorhq.com/contacts/${contactId}/tags`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ tags: ['search-area-alert'] }),
    });
    if (!tagRes.ok) console.error('GHL add-tags failed:', tagRes.status, await tagRes.text().catch(() => ''));
  } catch (err) {
    console.error('GHL note/tag failed:', err);
  }
}

async function matchesSearch(sub, l, sinceIso, areaRings, geocode) {
  if (!l.OriginalEntryTimestamp || new Date(l.OriginalEntryTimestamp) <= new Date(sinceIso)) return false;
  if (sub.min_price && (Number(l.ListPrice) || 0) < sub.min_price) return false;
  if (sub.max_price && (Number(l.ListPrice) || 0) > sub.max_price) return false;
  if (sub.min_beds && (Number(l.BedroomsTotal) || 0) < sub.min_beds) return false;
  if (sub.min_baths && (Number(l.BathroomsTotalInteger) || 0) < sub.min_baths) return false;
  if (sub.property_types && sub.property_types.length > 0) {
    const sub_type = String(l.PropertySubType || l.PropertyType || '').toLowerCase();
    if (!sub.property_types.some((t) => sub_type.includes(String(t).toLowerCase()))) return false;
  }
  // Area check last -- it's the only one that may need a geocode.
  if (sub.area_slug) {
    const areaRing = areaRings.find((a) => a.slug === sub.area_slug);
    if (!areaRing) return false;
    const geo = await geocode(l.UnparsedAddress);
    if (!geo || !pointInRing(geo.lat, geo.lng, areaRing.ring)) return false;
  }
  return true;
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
  const geocode = makeGeocoder();

  // Group due searches by person so each gets ONE push per run.
  const byEmail = new Map();
  for (const sub of dueSearches) {
    const key = String(sub.email).trim().toLowerCase();
    if (!byEmail.has(key)) byEmail.set(key, []);
    byEmail.get(key).push(sub);
  }

  let sent = 0;
  for (const subs of byEmail.values()) {
    const matched = new Map(); // ListingKey -> listing
    for (const sub of subs) {
      const sinceIso = sub.last_notified_at || sub.created_at;
      for (const l of candidates) {
        if (matched.has(l.ListingKey)) continue;
        if (await matchesSearch(sub, l, sinceIso, areaRings, geocode)) matched.set(l.ListingKey, l);
      }
    }

    const top = [...matched.values()]
      .sort((a, b) => String(b.OriginalEntryTimestamp).localeCompare(String(a.OriginalEntryTimestamp)))
      .slice(0, 3);

    if (top.length > 0) {
      const first = subs[0];
      await pushToGhl({
        email: first.email,
        firstName: first.first_name,
        lastName: first.last_name,
        phone: first.phone,
        intro: 'New homes matching your search:',
        lines: top.map((l) =>
          `${l.UnparsedAddress} — $${Math.round(Number(l.ListPrice) || 0).toLocaleString('en-CA')} — ${SITE_URL}/search/${l.ListingKey}/`
        ),
      });
      sent++;
    }

    const nowIso = new Date().toISOString();
    await supabase.from('saved_searches').update({ last_notified_at: nowIso }).in('id', subs.map((s) => s.id));
  }

  const summary = `saved-search-alerts: checked ${dueSearches.length} due searches for ${byEmail.size} people, sent ${sent} alerts`;
  console.log(summary);
  return new Response(summary);
};

export const config = {
  schedule: '30 11 * * *', // daily, 11:30am UTC -- alongside home-watch-alerts
};
