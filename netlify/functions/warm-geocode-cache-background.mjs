// Scheduled background job — pre-warms the geocode cache (shared with
// src/lib/ddf.ts, same Blobs store/key convention) for every active London
// listing across all brokerages, so the "browse by neighbourhood, all
// brokerages" pages are always fast instead of geocoding hundreds of
// addresses live on someone's first page load.
//
// Runs standalone (not through Astro/Vite), so it can't use import.meta.env
// like the rest of the DDF code does — reads process.env directly and
// duplicates the minimal fetch/geocode logic instead of importing
// src/lib/ddf.ts, to avoid any risk to the already-working site code.
import { getStore } from '@netlify/blobs';

const DDF_ACCESS_TOKEN = process.env.DDF_ACCESS_TOKEN;
const DDF_API_BASE_URL = process.env.DDF_API_BASE_URL;
const GOOGLE_GEOCODING_API_KEY = process.env.GOOGLE_GEOCODING_API_KEY;
const CONCURRENCY = 15;

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

export default async () => {
  if (!DDF_ACCESS_TOKEN || !DDF_API_BASE_URL || !GOOGLE_GEOCODING_API_KEY) {
    console.error('warm-geocode-cache: missing required env vars');
    return new Response('Missing required env vars', { status: 500 });
  }

  const store = getStore('ddf-geocode-cache');

  const data = await odataGet('Property', {
    $filter: `contains(UnparsedAddress,'London')`,
    $select: 'UnparsedAddress,StandardStatus,PropertyType,TransactionType',
    $top: '5000',
  });
  const all = data.value || [];
  const active = all.filter(
    (l) => l.StandardStatus === 'Active' && l.PropertyType !== 'Commercial' && l.TransactionType !== 'For Lease'
  );

  console.log(`warm-geocode-cache: ${active.length} active London listings to check (of ${all.length} fetched)`);

  let geocoded = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < active.length; i += CONCURRENCY) {
    const batch = active.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (listing) => {
        const address = listing.UnparsedAddress;
        if (!address) return;
        const cached = await store.get(address, { type: 'json' }).catch(() => null);
        if (cached) {
          skipped++;
          return;
        }
        const geo = await geocodeGoogle(address);
        if (geo) {
          await store.setJSON(address, geo);
          geocoded++;
        } else {
          failed++;
        }
      })
    );
  }

  const summary = `warm-geocode-cache done: ${geocoded} newly geocoded, ${skipped} already cached, ${failed} failed`;
  console.log(summary);
  return new Response(summary);
};

export const config = {
  schedule: '0 8 * * *', // daily, 8am UTC (~3-4am Eastern depending on DST)
};
