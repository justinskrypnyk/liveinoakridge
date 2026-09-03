-- Adds true calendar-month sold figures to market_map_snapshots, alongside
-- the existing 90-day rolling ones (median_sold_price/units_sold/
-- avg_sale_to_list_ratio unchanged -- still right for the heat map's own
-- medians, see heat-map-snapshot-background.mjs's header comment).
--
-- Added 2026-09-03 after the monthly blog post/digest/mailout were found to
-- be reporting the 90-day rolling `units_sold` figure as if it were a
-- single month's sales ("2,531 homes sold in August 2026" vs LSTAR's
-- official board-wide 526 for the same month). These new columns are what
-- those three narratives now read instead.
--
-- Semantics depend on period_type (Justin's own framing, confirmed
-- 2026-09-03): on a 'month-end' row, the FULL calendar month that just
-- closed; on a 'mid-month' row, the CURRENT calendar month MONTH-TO-DATE
-- (partial, since that month isn't over yet).
--
-- Run this once in the Supabase SQL Editor if your table predates this
-- migration -- schema.sql itself already includes these columns for anyone
-- setting the tables up fresh.
alter table market_map_snapshots
  add column if not exists median_sold_price_month numeric,
  add column if not exists units_sold_month integer,
  add column if not exists avg_sale_to_list_ratio_month numeric;
