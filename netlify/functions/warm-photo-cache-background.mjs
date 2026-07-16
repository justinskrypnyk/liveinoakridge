// Scheduled background job — pre-warms the photo cache (shared with
// src/lib/ddf.ts, same Blobs store/key convention) for every active London
// listing across all brokerages, so /search/'s map pins show a real photo
// preview instead of the emoji fallback, without live-fetching AMPRE Media
// for the full citywide set on every page load.
//
// Runs standalone (not through Astro/Vite), so it can't use import.meta.env
// like the rest of the DDF code does — reads process.env directly and
// duplicates the minimal fetch logic instead of importing src/lib/ddf.ts,
// same convention as warm-geocode-cache-background.mjs.
import { getStore } from '@netlify/blobs';

const DDF_ACCESS_TOKEN = process.env.DDF_ACCESS_TOKEN;
const DDF_API_BASE_URL = process.env.DDF_API_BASE_URL;
const CONCURRENCY = 10;
const PHOTO_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h, matches src/lib/ddf.ts

async function odataGet(resource, params) {
  const url = new URL(`${DDF_API_BASE_URL}${resource}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${DDF_ACCESS_TOKEN}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`${resource} -> HTTP ${res.status}: ${await res.text().catch(() => '')}`);
  return res.json();
}

async function fetchPhotoUrls(listingKey) {
  const data = await odataGet('Media', {
    $filter: `contains(ResourceRecordKey,'${listingKey}')`,
    $select: 'MediaURL,MediaCategory,MediaType,ImageSizeDescription,MediaObjectID,Order',
    $orderby: 'Order',
    $top: '250',
  });
  const seen = new Set();
  return (data.value || [])
    .filter((m) => m.MediaCategory === 'Photo' || m.MediaType?.startsWith('image'))
    .filter((m) => m.ImageSizeDescription === 'Largest') // watermarked full-res — never "LargestNoWatermark"
    .sort((a, b) => (a.Order ?? 0) - (b.Order ?? 0))
    .filter((m) => {
      if (seen.has(m.MediaObjectID)) return false;
      seen.add(m.MediaObjectID);
      return true;
    })
    .map((m) => m.MediaURL)
    .filter(Boolean);
}

export default async () => {
  if (!DDF_ACCESS_TOKEN || !DDF_API_BASE_URL) {
    console.error('warm-photo-cache: missing required env vars');
    return new Response('Missing required env vars', { status: 500 });
  }

  const store = getStore('ddf-photo-cache');

  const data = await odataGet('Property', {
    $filter: `contains(UnparsedAddress,'London')`,
    $select: 'ListingKey,ListingId,StandardStatus,PropertyType,TransactionType',
    $top: '5000',
  });
  const all = data.value || [];
  const active = all.filter(
    (l) => l.StandardStatus === 'Active' && l.PropertyType !== 'Commercial' && l.TransactionType !== 'For Lease'
  );

  console.log(`warm-photo-cache: ${active.length} active London listings to check (of ${all.length} fetched)`);

  let fetched = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < active.length; i += CONCURRENCY) {
    const batch = active.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (listing) => {
        const key = String(listing.ListingKey || listing.ListingId || '');
        if (!key) return;
        const cached = await store.get(key, { type: 'json' }).catch(() => null);
        if (cached && Date.now() - (cached.cachedAt || 0) < PHOTO_CACHE_TTL_MS) {
          skipped++;
          return;
        }
        try {
          const urls = await fetchPhotoUrls(key);
          await store.setJSON(key, { urls, cachedAt: Date.now() });
          fetched++;
        } catch {
          failed++;
        }
      })
    );
  }

  const summary = `warm-photo-cache done: ${fetched} newly fetched, ${skipped} already cached, ${failed} failed`;
  console.log(summary);
  return new Response(summary);
};

export const config = {
  schedule: '30 8 * * *', // daily, 8:30am UTC — offset from warm-geocode-cache-background.mjs
};
