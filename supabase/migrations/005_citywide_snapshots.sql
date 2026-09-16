-- Citywide (all of London, no per-neighbourhood split) stats history --
-- powers month-over-month % change on the citywide median sale price /
-- median list price / days-on-market numbers shown in monthly-digest,
-- mid-month-digest, and the monthly blog post (added 2026-09-16, per
-- Justin's ask). Deliberately its OWN table, not a row in
-- market_map_snapshots -- that table is per-neighbourhood only, and every
-- one of its other consumers (the public /market-map/ page, the Forest
-- City Homes JSON bridge, the CSV export, market-update-mailout) treats
-- every row in it as a real neighbourhood polygon. A synthetic "citywide"
-- row there would leak into all of those as a phantom 40th neighbourhood
-- (see mid-month-digest-background.mjs's getCitywideStats comment for the
-- fuller reasoning). This table has no other readers -- safe to shape
-- however's most convenient for the 3 functions that write/read it.
--
-- Same period_type/capture_date semantics as market_map_snapshots: a
-- 'month-end' row's capture_date is the day it ran (the 1st), reporting
-- the PREVIOUS full calendar month; a 'mid-month' row's capture_date is
-- the day it ran (the 16th), reporting the current month month-to-date.
-- MoM comparison is always against the most recent PRIOR row of the SAME
-- period_type -- same rule heat-map-snapshot-background.mjs already uses
-- for the per-neighbourhood market_map_changes table.
create table if not exists citywide_snapshots (
  id bigint generated always as identity primary key,
  period_type text not null check (period_type in ('mid-month', 'month-end')),
  capture_date date not null,
  captured_at timestamptz not null default now(),

  median_list_price numeric,
  avg_days_on_market numeric,
  median_sold_price numeric,
  units_sold integer,
  active_count integer,

  created_at timestamptz not null default now(),

  unique (period_type, capture_date)
);

create index if not exists citywide_snapshots_capture_date_idx
  on citywide_snapshots (capture_date desc);

alter table citywide_snapshots enable row level security;
-- No public policies -- only the service_role key can read/write, same as
-- every other table in schema.sql.
