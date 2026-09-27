// Listing thumbnails for the GHL Recommended Listing emails (see
// src/lib/listing-card.mjs). Every photo is cropped to the same 3:2 shape
// here because MLS photos come in all proportions and most email clients
// ignore object-fit -- without this, the cards in one email wouldn't line up.
//
// Active listings use the shared DDF photo cache; sold listings (nosy-
// neighbour alerts) fall back to the watermarked photo the VOW sold sync
// already caches. That photo URL is already served to anonymous visitors on
// /sold-map/, so exposing it here adds nothing new.
//
// No photo, a bad key, or an upstream failure all return a plain placeholder
// instead of an error, so an email never shows a broken image.
import type { APIRoute } from 'astro';
import sharp from 'sharp';
import { getListingPhotoUrl } from '@/lib/ddf';
import { getServiceRoleClient } from '@/lib/supabase';

export const prerender = false;

const WIDTH = 450; // 3x the 150px the card displays it at, for sharp phone screens
const HEIGHT = 300;

async function soldPhotoUrl(key: string): Promise<string | null> {
  const client = getServiceRoleClient();
  if (!client) return null;
  const { data } = await client.from('vow_sold_listings').select('photo_url').eq('listing_key', key).maybeSingle();
  return data?.photo_url ?? null;
}

function jpeg(body: Buffer, maxAge: number): Response {
  return new Response(body, {
    headers: {
      'Content-Type': 'image/jpeg',
      'Cache-Control': `public, max-age=${maxAge}`,
      'Netlify-CDN-Cache-Control': `public, durable, max-age=${maxAge}`,
    },
  });
}

async function placeholder(): Promise<Response> {
  const body = await sharp({ create: { width: WIDTH, height: HEIGHT, channels: 3, background: '#dbe4ea' } }).jpeg().toBuffer();
  return jpeg(body, 3600); // short, so a photo that shows up later replaces it
}

export const GET: APIRoute = async ({ params }) => {
  const key = String(params.key || '').replace(/\.jpg$/i, '');
  if (!/^[A-Za-z0-9]{4,20}$/.test(key)) return placeholder();
  try {
    const src = (await getListingPhotoUrl(key)) ?? (await soldPhotoUrl(key));
    if (!src) return placeholder();
    const res = await fetch(src, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return placeholder();
    const body = await sharp(Buffer.from(await res.arrayBuffer()))
      .rotate()
      .resize(WIDTH, HEIGHT, { fit: 'cover', position: 'centre' })
      .jpeg({ quality: 80, mozjpeg: true })
      .toBuffer();
    return jpeg(body, 7 * 24 * 3600);
  } catch (err) {
    console.error('email-thumb failed for', key, err instanceof Error ? err.message : err);
    return placeholder();
  }
};
