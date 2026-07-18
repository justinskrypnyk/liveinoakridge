-- Adds feed-derived metrics (median bedrooms/bathrooms, % detached homes,
-- listings delisted this period) to an already-existing market_map_snapshots
-- table. Run this once in the Supabase SQL Editor if your table was created
-- before this migration -- `schema.sql` itself already includes these
-- columns for anyone setting the tables up fresh.
alter table market_map_snapshots
  add column if not exists median_bedrooms numeric,
  add column if not exists median_bathrooms numeric,
  add column if not exists pct_detached numeric,
  add column if not exists delisted_count integer;
