// Shared pieces for the listing alert jobs added 2026-09-27
// (price-drop-alerts-background, open-house-alerts-background): the London
// active pool, neighbourhood matching, saved-search criteria, and the GHL
// push. Same logic as saved-search-alerts-background.mjs (which predates
// this file and keeps its own copy) -- see that file's header for why the
// pool is one broad contains() fetch and why coordinates come from the
// geocode cache.
import { getStore } from '@netlify/blobs';
import { assignOwnerIfUnowned } from './ghl-owner.mjs';
// Imported (not read from disk) so the bundler inlines it into each function
// that uses this file -- a path relative to this module wouldn't survive bundling.
import areaBoundaries from '../data/area-boundaries.json' with { type: 'json' };

const FETCH_TIMEOUT_MS = 15000;
// The whole site shares Google's free geocoding allowance (~330/day); these
// jobs should almost always hit the warm cache instead.
const MAX_GOOGLE_GEOCODES_PER_RUN = 25;

const SELECT_FIELDS = [
  'ListingKey', 'StandardStatus', 'TransactionType', 'ListPrice', 'UnparsedAddress',
  'City', 'BedroomsTotal', 'BathroomsTotalInteger',
  'PropertyType', 'PropertySubType', 'OriginalEntryTimestamp',
].join(',');

export async function fetchActiveLondonPool() {
  const url = new URL(`${process.env.DDF_API_BASE_URL}Property`);
  url.searchParams.set('$filter', "contains(City,'London')");
  url.searchParams.set('$select', SELECT_FIELDS);
  url.searchParams.set('$top', '5000');
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.DDF_ACCESS_TOKEN}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`Property fetch -> HTTP ${res.status}`);
  const data = await res.json();
  return (data.value || []).filter(
    (l) => l.StandardStatus === 'Active' && l.PropertyType !== 'Commercial' && l.TransactionType !== 'For Lease'
  );
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

export function loadAreaRings() {
  return areaBoundaries.features.map((f) => ({ slug: f.properties.slug, ring: f.geometry.coordinates[0] }));
}

async function geocodeGoogle(address) {
  const key = process.env.GOOGLE_GEOCODING_API_KEY;
  if (!key) return null;
  try {
    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    url.searchParams.set('address', `${address}, Ontario, Canada`);
    url.searchParams.set('key', key);
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

/** Coordinates via the shared ddf-geocode-cache (keyed by UnparsedAddress), memoized for one run. */
export function makeGeocoder() {
  let store = null;
  try {
    store = getStore('ddf-geocode-cache');
  } catch {
    // No Blobs outside Netlify (local test runs) -- Google only, still capped.
  }
  const memo = new Map();
  let googleCalls = 0;
  return async (address) => {
    if (!address) return null;
    if (memo.has(address)) return memo.get(address);
    let geo = store ? await store.get(address, { type: 'json' }).catch(() => null) : null;
    if (!geo && googleCalls < MAX_GOOGLE_GEOCODES_PER_RUN) {
      googleCalls++;
      geo = await geocodeGoogle(address);
      if (geo && store) await store.setJSON(address, geo).catch(() => {});
    }
    memo.set(address, geo || null);
    return geo || null;
  };
}

/** Does listing `l` fit a saved_searches row's criteria? (No "new since" check -- callers decide what's new.) */
export async function matchesCriteria(sub, l, areaRings, geocode) {
  const price = Number(l.ListPrice) || 0;
  if (sub.min_price && price < sub.min_price) return false;
  if (sub.max_price && price > sub.max_price) return false;
  if (sub.min_beds && (Number(l.BedroomsTotal) || 0) < sub.min_beds) return false;
  if (sub.min_baths && (Number(l.BathroomsTotalInteger) || 0) < sub.min_baths) return false;
  if (sub.property_types && sub.property_types.length > 0) {
    const subType = String(l.PropertySubType || l.PropertyType || '').toLowerCase();
    if (!sub.property_types.some((t) => subType.includes(String(t).toLowerCase()))) return false;
  }
  if (sub.area_slug) {
    const areaRing = areaRings.find((a) => a.slug === sub.area_slug);
    if (!areaRing) return false;
    const geo = await geocode(l.UnparsedAddress);
    if (!geo || !pointInRing(geo.lat, geo.lng, areaRing.ring)) return false;
  }
  return true;
}

/**
 * Upsert the contact with the alert's fields, leave a note, then (re)add `tag`
 * so its GHL workflow sends the email. Same order and tag handling as
 * saved-search-alerts-background.mjs: no tags/source in the upsert (GHL
 * would replace them), tag removed then added so "tag added" fires again.
 */
export async function pushListingAlert({ email, firstName, lastName, phone, intro, lines, customFields, tag }) {
  const token = process.env.GHL_API_TOKEN;
  const locationId = process.env.GHL_LOCATION_ID;
  if (!token || !locationId) {
    console.error('GHL env vars missing, skipping push for', email);
    return false;
  }
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
    Version: '2021-07-28',
  };
  const res = await fetch('https://services.leadconnectorhq.com/contacts/upsert', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      firstName: firstName || undefined,
      lastName: lastName || undefined,
      email,
      phone: phone || undefined,
      locationId,
      customFields,
    }),
  });
  if (!res.ok) {
    console.error('GHL upsert failed:', res.status, await res.text().catch(() => ''));
    return false;
  }
  try {
    const upserted = await res.json();
    const contactId = upserted?.contact?.id;
    if (!contactId) return false;
    await assignOwnerIfUnowned(upserted, headers);
    const noteRes = await fetch(`https://services.leadconnectorhq.com/contacts/${contactId}/notes`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ body: [intro, ...lines].join('\n') }),
    });
    if (!noteRes.ok) console.error('GHL note failed:', noteRes.status, await noteRes.text().catch(() => ''));
    await fetch(`https://services.leadconnectorhq.com/contacts/${contactId}/tags`, {
      method: 'DELETE',
      headers,
      body: JSON.stringify({ tags: [tag] }),
    }).catch(() => {});
    const tagRes = await fetch(`https://services.leadconnectorhq.com/contacts/${contactId}/tags`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ tags: [tag] }),
    });
    if (!tagRes.ok) console.error('GHL add-tags failed:', tagRes.status, await tagRes.text().catch(() => ''));
    return tagRes.ok;
  } catch (err) {
    console.error('GHL note/tag failed:', err);
    return false;
  }
}
