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

  -- Feed-derived, no board/VOW access needed -- BedroomsTotal and
  -- BathroomsTotalInteger are 100% filled on this feed; PropertySubType is
  -- fully categorized. Lot size was considered too (LotSizeArea) but its
  -- units are inconsistent garbage in this feed (Acres/SquareFeet/Feet/
  -- Hectares/SquareMeters all mixed, ~15% filled) -- deliberately not
  -- included rather than ship a metric built on bad unit conversions.
  median_bedrooms numeric,
  median_bathrooms numeric,
  pct_detached numeric,
  delisted_count integer,

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

-- VOW (Virtual Office Website) sold-listing storage. Requires the PropTx
-- VOW Datafeed Agreement (Membership #9636674, active since 2026-07-22) —
-- a genuinely separate authorization from the DDF Member feed above. Per
-- Article 6.3(h) of that agreement, VOW data must refresh at least every 24
-- hours (see vow-sold-sync-background.mjs's daily schedule) and per 6.3(b)
-- any single response to a consumer is capped at 100 listings (enforced in
-- src/pages/api/sold-listings.json.ts, not here).
--
-- Individual listing records (unlike the aggregate-only tables above) --
-- gated entirely behind Supabase Auth (see profiles below); RLS has no
-- public policies, service_role only, same as every other table here.
create table if not exists vow_sold_listings (
  listing_key text primary key,
  area_slug text,
  address text not null,
  city text,
  lat double precision,
  lng double precision,
  close_price numeric,
  close_date date,
  list_price numeric,
  beds integer,
  baths integer,
  sqft numeric,
  parking_total integer,
  property_type text,
  property_sub_type text,
  photo_url text,
  listing_contract_date date,
  updated_at timestamptz not null default now()
);

-- Enables "days on market" / fastest-sale-of-the-week style metrics
-- (close_date - listing_contract_date) for the weekly/monthly digest emails
-- -- not backfilled for already-synced rows (would mean re-walking the
-- whole feed again for a nice-to-have metric); populates going forward as
-- the sync job re-visits listings on its normal cursor cycle.
alter table vow_sold_listings add column if not exists listing_contract_date date;

-- Added after the table's initial creation -- explicit ALTER since `create
-- table if not exists` above is a no-op once the table already exists.
alter table vow_sold_listings add column if not exists parking_total integer;
-- One representative (watermarked, per 6.3(c)) photo per listing, cached at
-- sync time -- same reasoning as parking_total above, plus: fetching Media
-- live per map-viewport request would mean up to 100 extra AMPRE calls per
-- pan/zoom, which the pre-synced-table design this map is built on exists
-- specifically to avoid. Served to BOTH authenticated and locked map
-- responses -- the URL itself is an opaque hashed AMPRE path, not the
-- address, so it's safe to send to anonymous visitors; the gate is a CSS
-- blur applied client-side to the locked case, matching the masked-price
-- treatment already used for locked listings.
alter table vow_sold_listings add column if not exists photo_url text;

create index if not exists vow_sold_listings_area_idx on vow_sold_listings (area_slug);
create index if not exists vow_sold_listings_close_date_idx on vow_sold_listings (close_date desc);

alter table vow_sold_listings enable row level security;

-- VOW registrant profiles -- Supabase Auth handles the actual identity
-- (auth.users); this stores the compliance-relevant bits the VOW Policy and
-- Rules require: proof of who registered and that they accepted the
-- consumer-use terms (6.3(k)'s bona-fide-interest notice), not just an
-- email address in auth.users.
create table if not exists profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  phone text,
  terms_accepted_at timestamptz,
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;

-- "Nosy Neighbour" style alerts: watch a specific address (not tied to a
-- login/account) and get emailed (via a GHL workflow, not directly) when
-- something new sells nearby. Public/active listing data only -- no VOW
-- fields here, so no VOW-registration requirement attaches to this table.
create table if not exists home_watch_subscriptions (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  first_name text,
  last_name text,
  phone text,
  address_label text not null, -- what the person typed in, shown back to them
  latitude double precision not null,
  longitude double precision not null,
  radius_km numeric not null default 1.0,
  frequency text not null default 'weekly', -- 'daily' | 'weekly' | 'monthly'
  created_at timestamptz not null default now(),
  last_notified_at timestamptz
);

create index if not exists home_watch_subscriptions_email_idx on home_watch_subscriptions (email);

alter table home_watch_subscriptions enable row level security;

-- One row per "hearted" listing -- captures a real snapshot of the listing's
-- own details at save time (price/beds/baths/type/area), which the old
-- save-listing flow never stored anywhere (only address + MLS# went to
-- GHL as a note). This is what a "homes like this one" match is computed
-- against; recommendation_sent_at marks once the GHL push has fired so a
-- retry/rerun of the matching job doesn't double-send.
create table if not exists saved_listings (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  first_name text,
  last_name text,
  phone text,
  listing_key text not null,
  address text,
  list_price numeric,
  property_type text,
  property_sub_type text,
  bedrooms int,
  bathrooms int,
  building_area_total numeric,
  area_slug text,
  latitude double precision,
  longitude double precision,
  photo_url text,
  saved_at timestamptz not null default now(),
  recommendation_sent_at timestamptz
);

create index if not exists saved_listings_email_idx on saved_listings (email);

alter table saved_listings enable row level security;

-- A saved search: someone's criteria (area + filters) from /search, matched
-- against new active listings going forward. area_slug is nullable since a
-- search might be criteria-only (price/type/beds) with no specific area.
create table if not exists saved_searches (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  first_name text,
  last_name text,
  phone text,
  area_slug text,
  min_price numeric,
  max_price numeric,
  property_types text[],
  min_beds int,
  min_baths int,
  frequency text not null default 'weekly', -- 'daily' | 'weekly' | 'monthly'
  created_at timestamptz not null default now(),
  last_notified_at timestamptz
);

create index if not exists saved_searches_email_idx on saved_searches (email);
create index if not exists saved_searches_area_idx on saved_searches (area_slug);

alter table saved_searches enable row level security;
