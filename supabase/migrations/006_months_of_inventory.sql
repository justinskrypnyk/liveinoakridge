-- Months of inventory (a.k.a. months of supply / absorption rate) -- the
-- classic buyer's-market/seller's-market signal: at the current sales
-- pace, how long would it take to sell everything currently listed?
-- Added 2026-09-16 per Justin: wants this shown per neighbourhood, for
-- London as a whole, and on the public /market-map/ page.
--
-- Formula: active_count / (units_sold / 3) -- units_sold is ALREADY the
-- existing 90-day rolling sold count (see heat-map-snapshot-
-- background.mjs's own comment on why a twice-monthly capture period is
-- too thin a window for a stable per-neighbourhood figure on its own).
-- Reusing that same 90-day basis here means months_of_inventory needs no
-- separate pace-adjustment for a mid-month (partial-month) capture vs. a
-- month-end (full-month) one -- both read off the same rolling window.
-- Null when units_sold is 0 (no recent sales to compute a pace from) --
-- same "null when the ratio is undefined" convention as
-- avg_sale_to_list_ratio.
alter table market_map_snapshots
  add column if not exists months_of_inventory numeric;

-- Citywide equivalent (see mid-month-digest-background.mjs's
-- getCitywideStats comment for why this lives in its own table rather
-- than a market_map_snapshots row). Same 90-day-rolling-count basis,
-- computed citywide instead of per-area.
alter table citywide_snapshots
  add column if not exists months_of_inventory numeric;
