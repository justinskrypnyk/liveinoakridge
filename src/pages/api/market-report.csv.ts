// Gated CSV export of market_map_snapshots -- Justin's own private
// "neighbourhood data table" for reviewing offline, not a public feature
// (unlike /market-map/ itself, which is public). Protected by a secret key
// rather than full auth since this is just a convenience export of
// aggregate data that's already publicly visible in HTML form on
// /market-map/ -- the gate exists to keep casual bulk-scraping of the
// convenient CSV format from being trivial, not to protect anything not
// already substantially public.
//
// The "auto-log" already exists at the data layer: market_map_snapshots
// accumulates a permanent row per area/capture_date/period_type forever
// (see heat-map-snapshot-background.mjs), so this endpoint is just a view
// into that existing history -- ?history=true for everything ever
// captured, or the default (latest capture per area only) for a quick
// current snapshot.
import type { APIRoute } from 'astro';
import { getServiceRoleClient } from '@/lib/supabase';

export const prerender = false;

const COLUMNS = [
  'area_slug', 'area_name', 'period_type', 'capture_date',
  'median_list_price', 'active_count', 'new_listings_count', 'avg_days_on_market',
  'median_sold_price', 'units_sold', 'avg_sale_to_list_ratio',
  'price_per_sqft', 'median_bedrooms', 'median_bathrooms', 'pct_detached', 'delisted_count',
] as const;

function toCsv(rows: Record<string, unknown>[]): string {
  const header = COLUMNS.join(',');
  const lines = rows.map((row) =>
    COLUMNS.map((col) => {
      const v = row[col];
      if (v == null) return '';
      const s = String(v);
      return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(',')
  );
  return [header, ...lines].join('\n');
}

export const GET: APIRoute = async ({ url }) => {
  const key = url.searchParams.get('key');
  const expectedKey = import.meta.env.MARKET_REPORT_KEY;
  if (!expectedKey || key !== expectedKey) {
    return new Response('Not found', { status: 404 });
  }

  const supabase = getServiceRoleClient();
  if (!supabase) {
    return new Response('Report unavailable', { status: 500 });
  }

  const includeHistory = url.searchParams.get('history') === 'true';

  let rows: Record<string, unknown>[];
  if (includeHistory) {
    const { data, error } = await supabase
      .from('market_map_snapshots')
      .select(COLUMNS.join(','))
      .order('area_name', { ascending: true })
      .order('capture_date', { ascending: false });
    if (error) return new Response('Query failed', { status: 500 });
    rows = data ?? [];
  } else {
    const { data: latestRow } = await supabase
      .from('market_map_snapshots')
      .select('capture_date')
      .order('capture_date', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!latestRow) rows = [];
    else {
      const { data, error } = await supabase
        .from('market_map_snapshots')
        .select(COLUMNS.join(','))
        .eq('capture_date', latestRow.capture_date)
        .order('area_name', { ascending: true });
      if (error) return new Response('Query failed', { status: 500 });
      rows = data ?? [];
    }
  }

  const csv = toCsv(rows);
  const filename = `neighbourhood-report-${includeHistory ? 'full-history' : new Date().toISOString().slice(0, 10)}.csv`;

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
};
