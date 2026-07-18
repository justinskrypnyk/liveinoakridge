-- Heat map aggregate storage. Run this once in the Supabase SQL Editor
-- (Project -> SQL Editor -> New query -> paste -> Run). See README.md
-- ("Heat Map — Setup") for the env vars this pairs with.
--
-- Both tables are aggregate-only (per-neighbourhood counts/medians/ratios) —
-- never raw individual listing records. RLS is enabled with NO public
-- policies, so only the service_role key (used server-side by the Netlify
-- scheduled functions and by the Astro page's server-side render) can read
-- or write. There is no anon/client-side access to Supabase at all — the
-- Astro page fetches once per request on the server and embeds the result
-- as inline JSON, so the browser never talks to Supabase directly.

create table if not exists market_map_snapshots (
  id bigint generated always as identity primary key,
  area_slug text not null,
  area_name text not null,
  period_type text not null check (period_type in ('mid-month', 'month-end')),
  capture_date date not null,
  captured_at timestamptz not null default now(),

  -- Available today, computed from active DDF/PropTx listings only.
  median_list_price numeric,
  active_count integer,
  new_listings_count integer,
  avg_days_on_market numeric,

  -- Not computable yet (board doesn't release sold data / sqft is ~0.1%
  -- filled in the feed) — columns exist now so the pipeline can start
  -- populating them the moment the data becomes available, with no schema
  -- change needed. Leave null until then; the UI shows these pills as
  -- disabled/"coming soon" while null.
  median_sold_price numeric,
  units_sold integer,
  avg_sale_to_list_ratio numeric,
  price_per_sqft numeric,
  price_per_sqft_sample_size integer,

  created_at timestamptz not null default now(),

  unique (area_slug, capture_date, period_type)
);

create index if not exists market_map_snapshots_capture_date_idx
  on market_map_snapshots (capture_date desc);

alter table market_map_snapshots enable row level security;

-- Precomputed month-over-month / year-over-year change per area per metric,
-- written by the same scheduled function right after it writes the new
-- snapshot row above. Keeping this as its own table (rather than computing
-- deltas on the fly with window functions every time) is what makes the
-- monthly "top 3 movers" content-workflow query a single flat SELECT.
create table if not exists market_map_changes (
  id bigint generated always as identity primary key,
  area_slug text not null,
  area_name text not null,
  metric text not null,
  period_type text not null check (period_type in ('mid-month', 'month-end')),
  capture_date date not null,

  current_value numeric,
  mom_previous_value numeric,
  mom_pct_change numeric,
  yoy_previous_value numeric,
  yoy_pct_change numeric,

  -- True when |mom_pct_change| >= 0.10 (10%+ swing) — the threshold named
  -- explicitly in the spec for surfacing notable shifts.
  is_notable boolean not null default false,

  created_at timestamptz not null default now(),

  unique (area_slug, metric, capture_date, period_type)
);

create index if not exists market_map_changes_notable_idx
  on market_map_changes (capture_date desc, is_notable)
  where is_notable = true;

alter table market_map_changes enable row level security;

-- Example "top 3 movers this month" query for the blog/GBP/social workflow:
--
--   select area_name, metric, current_value, mom_pct_change
--   from market_map_changes
--   where capture_date = (select max(capture_date) from market_map_changes)
--     and is_notable = true
--   order by abs(mom_pct_change) desc
--   limit 3;
