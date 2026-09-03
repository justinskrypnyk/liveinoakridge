-- Tracks the day each listing FIRST shows up as 'Active Under Contract' in
-- the AMPRE feed -- our own self-observed proxy for "the day a deal went
-- firm", since AMPRE's own PurchaseContractDate field stays null until a
-- deal actually closes (confirmed empirically 2026-09-03: none of the
-- currently-under-contract listings had it populated). Boards require a
-- sale to be reported within 24 hours, so a daily poll (see
-- firm-sale-tracker-background.mjs) catches the transition to within about
-- a day -- much closer to LSTAR's own live "Sales Activity" methodology
-- than our closing-date-based units_sold_month figure, which lags the real
-- event by a median 43 days (confirmed against our own August 2026 data).
--
-- Insert-only-if-not-already-tracked (see the background job's upsert with
-- ignoreDuplicates) -- once a listing_key is in here, went_firm_date never
-- changes, even if the deal later falls through and the listing returns to
-- Active (still genuinely went firm on that date, however briefly).
--
-- No close_price/close_date here -- those aren't known yet at the point
-- this row is written (the deal hasn't closed), and vow_sold_listings
-- already covers that once it does.
create table if not exists vow_firm_tracker (
  listing_key text primary key,
  area_slug text,
  address text not null,
  city text,
  list_price numeric,
  property_type text,
  property_sub_type text,
  went_firm_date date not null,
  created_at timestamptz not null default now()
);

create index if not exists vow_firm_tracker_area_idx on vow_firm_tracker (area_slug);
create index if not exists vow_firm_tracker_went_firm_date_idx on vow_firm_tracker (went_firm_date);

alter table vow_firm_tracker enable row level security;

-- Aggregate count, same _month semantics as units_sold_month/etc (full
-- month on a month-end capture, month-to-date on mid-month) -- see that
-- migration (003) and heat-map-snapshot-background.mjs's header comment.
-- No history exists before this tracker started (2026-09-03), so this
-- reads 0/null for August and earlier; it starts becoming meaningful from
-- September 2026 onward.
alter table market_map_snapshots
  add column if not exists units_firmed_month integer;
