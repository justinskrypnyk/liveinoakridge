// Gated aggregate feed of the citywide 39-area heat-map snapshot (see
// netlify/functions/heat-map-snapshot-background.mjs, which writes it to
// Supabase's market_map_snapshots table -- this just reads the latest
// capture via getLatestMarketMapSnapshots() and reshapes it as JSON).
//
// Built as a one-way bridge so Forest City Homes' own /market-map can show
// real numbers before it has its own DDF/VOW credentials, rather than
// reading this site's Supabase project directly (same "no shared database
// between independent sites" principle as schema.sql). Once that site has
// its own feed, it should compute its own snapshot the same way (this
// job's logic is a reasonable starting point) and this endpoint can be
// retired -- it's a bridge, not a permanent dependency.
//
// Gated with a shared secret rather than left fully open: this is Justin's
// computed aggregate data (no PII, no individual listings -- DDF/VOW terms
// aren't implicated), but there's no reason to let any scraper or
// competitor pull it for free just by finding the URL. Cache-Control is
// deliberately private/no-store -- a CDN caching a response keyed only by
// URL (ignoring the auth header) could otherwise serve an authorized
// response to the next unauthenticated request.
import type { APIRoute } from 'astro';
import { getLatestMarketMapSnapshots, type MarketMapSnapshotRow } from '@/lib/supabase';

export const prerender = false;

const SYNC_SECRET = import.meta.env.MARKET_MAP_SYNC_SECRET;

export const GET: APIRoute = async ({ request }) => {
  if (!SYNC_SECRET || request.headers.get('x-api-key') !== SYNC_SECRET) {
    return new Response('Unauthorized', {
      status: 401,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  }

  const rows = await getLatestMarketMapSnapshots();
  if (rows.length === 0) {
    return new Response(JSON.stringify({ updatedAt: null, areas: {} }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
    });
  }

  // Explicit allow-list rather than spreading the row -- select('*') in
  // getLatestMarketMapSnapshots() also returns internal columns not on the
  // MarketMapSnapshotRow type (id, created_at, captured_at; see
  // supabase/schema.sql), which have no business leaking into a public
  // response.
  const areas: Record<string, Omit<MarketMapSnapshotRow, 'area_slug' | 'period_type' | 'capture_date'>> = {};
  for (const row of rows) {
    areas[row.area_slug] = {
      area_name: row.area_name,
      median_list_price: row.median_list_price,
      active_count: row.active_count,
      new_listings_count: row.new_listings_count,
      avg_days_on_market: row.avg_days_on_market,
      median_sold_price: row.median_sold_price,
      units_sold: row.units_sold,
      avg_sale_to_list_ratio: row.avg_sale_to_list_ratio,
      price_per_sqft: row.price_per_sqft,
      price_per_sqft_sample_size: row.price_per_sqft_sample_size,
      median_bedrooms: row.median_bedrooms,
      median_bathrooms: row.median_bathrooms,
      pct_detached: row.pct_detached,
      delisted_count: row.delisted_count,
    };
  }

  // captured_at isn't declared on the MarketMapSnapshotRow type, but
  // select('*') returns it anyway (see supabase/schema.sql) -- every row in
  // one capture batch shares the same value, so the first row's is enough.
  const updatedAt = (rows[0] as unknown as { captured_at: string }).captured_at ?? null;

  return new Response(JSON.stringify({ updatedAt, areas }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
  });
};
