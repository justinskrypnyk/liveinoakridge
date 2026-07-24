// Public read of the twice-monthly market-stats snapshot (see
// netlify/functions/market-stats-snapshot-background.mjs), fetched
// client-side by MarketTicker.astro. Deliberately not `prerender`d — the
// whole point of the ticker is that a page refresh shows the latest Blobs
// snapshot without needing a site rebuild.
import type { APIRoute } from 'astro';
import { getMarketStatsSnapshot, getSoldStatsByArea } from '@/lib/market-stats';

export const prerender = false;

export const GET: APIRoute = async () => {
  // Two independent sources, fetched in parallel: the twice-monthly active-
  // listing snapshot (Blobs) and the twice-monthly sold-stats snapshot
  // (Supabase market_map_snapshots — see getSoldStatsByArea). Either can be
  // empty (no data yet) without blocking the other from rendering its row.
  const [snapshot, sold] = await Promise.all([getMarketStatsSnapshot(), getSoldStatsByArea()]);

  const payload = { updatedAt: snapshot?.updatedAt ?? null, areas: snapshot?.areas ?? {}, sold };
  return new Response(JSON.stringify(payload), {
    status: 200,
    // Snapshots only change twice a month — a short cache is just to avoid
    // hammering Blobs/Supabase on every homepage view, not a freshness concern.
    headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${snapshot ? 3600 : 300}` },
  });
};
