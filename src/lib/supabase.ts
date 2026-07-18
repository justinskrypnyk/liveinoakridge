// Server-only Supabase client — reads the heat map's precomputed aggregate
// snapshots (see supabase/schema.sql). Never imported by client-side script
// blocks: the service_role key bypasses RLS, so this must stay server-side
// only. The heat map page fetches once per request with this and embeds the
// result as inline JSON — the browser itself never talks to Supabase.
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;

export interface MarketMapSnapshotRow {
  area_slug: string;
  area_name: string;
  period_type: 'mid-month' | 'month-end';
  capture_date: string;
  median_list_price: number | null;
  active_count: number | null;
  new_listings_count: number | null;
  avg_days_on_market: number | null;
  median_sold_price: number | null;
  units_sold: number | null;
  avg_sale_to_list_ratio: number | null;
  price_per_sqft: number | null;
  price_per_sqft_sample_size: number | null;
}

export interface MarketMapChangeRow {
  area_slug: string;
  area_name: string;
  metric: string;
  period_type: 'mid-month' | 'month-end';
  capture_date: string;
  current_value: number | null;
  mom_pct_change: number | null;
  yoy_pct_change: number | null;
  is_notable: boolean;
}

function getClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

/** Latest snapshot row per area (one per area_slug, most recent capture_date). Empty array if not configured or no data yet. */
export async function getLatestMarketMapSnapshots(): Promise<MarketMapSnapshotRow[]> {
  const client = getClient();
  if (!client) return [];

  const { data: latestRow } = await client
    .from('market_map_snapshots')
    .select('capture_date')
    .order('capture_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!latestRow) return [];

  const { data, error } = await client
    .from('market_map_snapshots')
    .select('*')
    .eq('capture_date', latestRow.capture_date);

  if (error) {
    console.error('getLatestMarketMapSnapshots failed:', error.message);
    return [];
  }
  return data ?? [];
}

/** Notable (10%+ swing) MoM/YoY changes from the latest capture — powers "top movers" content workflows. */
export async function getLatestNotableChanges(limit = 10): Promise<MarketMapChangeRow[]> {
  const client = getClient();
  if (!client) return [];

  const { data: latestRow } = await client
    .from('market_map_changes')
    .select('capture_date')
    .order('capture_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!latestRow) return [];

  const { data, error } = await client
    .from('market_map_changes')
    .select('*')
    .eq('capture_date', latestRow.capture_date)
    .eq('is_notable', true)
    .order('mom_pct_change', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('getLatestNotableChanges failed:', error.message);
    return [];
  }
  return data ?? [];
}
