// Public read of the twice-monthly market-stats snapshot (see
// netlify/functions/market-stats-snapshot-background.mjs), fetched
// client-side by MarketTicker.astro. Deliberately not `prerender`d — the
// whole point of the ticker is that a page refresh shows the latest Blobs
// snapshot without needing a site rebuild.
import type { APIRoute } from 'astro';
import { getMarketStatsSnapshot } from '@/lib/market-stats';

export const prerender = false;

export const GET: APIRoute = async () => {
  const snapshot = await getMarketStatsSnapshot();
  if (!snapshot) {
    return new Response(JSON.stringify({ updatedAt: null, areas: {} }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
    });
  }
  return new Response(JSON.stringify(snapshot), {
    status: 200,
    // Snapshot only changes twice a month — a short cache is just to avoid
    // hammering Blobs on every homepage view, not a freshness concern.
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' },
  });
};
