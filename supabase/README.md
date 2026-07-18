# Neighbourhood Heat Map — /market-map/

Citywide (39-neighbourhood) real estate heat map. Pills switch which metric
colors the choropleth; hover shows a value, click zooms in, the legend
doubles as a click-to-filter. Data comes from a twice-monthly Supabase
snapshot — the page itself never calls DDF/PropTx or Supabase from the
browser.

## One-time setup (Justin)

1. **Run the schema.** Supabase dashboard → SQL Editor → New query → paste
   the contents of `supabase/schema.sql` → Run. Creates two tables
   (`market_map_snapshots`, `market_map_changes`), both with RLS on and no
   public policies — only the service_role key can touch them. If your
   tables already existed before 2026-07-18, also run
   `supabase/migrations/001_feed_derived_metrics.sql` once to add the newer
   bedrooms/bathrooms/% detached/delisted-count columns.
2. **Get your API keys.** Supabase dashboard → Project Settings → API →
   copy the **Project URL** and the **service_role secret key** (not the
   `anon` key — that one's for client-side use, which this feature
   deliberately never does).
3. **Add two Netlify environment variables** (Site configuration →
   Environment variables): `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`,
   values from step 2. Both the scheduled function and the live site need
   them.
4. **Seed the first snapshot.** Once env vars are live, hit
   `https://www.liveinoakridge.ca/.netlify/functions/heat-map-snapshot-background?force=true`
   once — bypasses the 15th/1st-of-month gate so the map has real data
   immediately rather than waiting up to ~2 weeks. Add `&period_type=month-end`
   to seed that variant too. Same pattern as the existing
   `market-stats-snapshot-background` job's `?force=true`.

## How it works

- **`netlify/functions/heat-map-snapshot-background.mjs`** — one scheduled
  function, daily cron, no-ops except on the 15th (`period_type =
  'mid-month'`) or the 1st (`period_type = 'month-end'`, capturing the
  *previous* month's close). Pulls active DDF/PropTx listings, buckets them
  into all 39 `src/data/area-boundaries.json` polygons, computes stats, and
  upserts into Supabase — plus a second upsert into `market_map_changes`
  with month-over-month/year-over-year % change and a `is_notable` flag
  (10%+ swing) for the monthly blog/GBP/social "top movers" workflow.
- **`src/lib/supabase.ts`** — server-only reads (latest snapshot per area,
  latest notable changes). Used once per page request by
  `src/pages/market-map.astro`.
- **`src/components/HeatMap.astro`** — the map itself. Leaflet + the
  boundary/river GeoJSON load lazily (`IntersectionObserver`, ~200px before
  the map scrolls into view) so this never blocks initial page render. All
  metric data for all 39 areas is embedded once at page load; switching
  pills or clicking the legend re-renders client-side only — no further
  network calls.
- **`src/components/MarketMapNotifyForm.astro`** — "get notified" email
  capture, same Netlify Forms → `/api/ghl-lead` pattern as every other form
  on the site, tagged `Market Map Subscriber` (see `FORM_TAG_LABELS` in
  `src/pages/api/ghl-lead.ts`) so it doesn't merge with other lead lists.

## Feed-derived metrics (median bedrooms/bathrooms, % detached, delisted count)

Added 2026-07-18, all computed purely from fields already in the DDF feed —
no new data source, no VOW/board access needed. `BedroomsTotal` and
`BathroomsTotalInteger` are 100% filled on this feed; `PropertySubType` is
fully categorized (`% Detached Homes` = share of active listings whose
`PropertySubType` is exactly `'Detached'`). "Left Market This Period"
diffs each run's per-area `ListingKey` set against the previous run's
(stored in a `heat-map-previous-keys` Blobs store, not Supabase — pure
job-scoped state) — a market-velocity proxy that works without any
sold-price data. Lot size (`LotSizeArea`) was considered too but dropped:
only ~15% filled and its units are inconsistent in this feed (`Acres`,
`SquareFeet`, `Feet`, `Hectares`, `SquareMeters` all mixed on the same
field) — not reliable enough to convert and show as a real metric.

## Sold-data metrics ("coming soon" pills)

Median sold price, units sold, and sale-to-list ratio are **not**
computed — the DDF Member Website feed is active-listings-only; sold data
needs VOW-level board access Justin doesn't have yet. Their columns exist
in `market_map_snapshots` and stay `null`. The pills render disabled with a
"(coming soon)" label. Price-per-sqft *is* computed from `BuildingAreaTotal`
when present, but Justin's board likely doesn't release it either — expect
it to render as "no data" almost everywhere until/unless that changes;
`price_per_sqft_sample_size` is stored so a future check can tell
"unfilled" apart from "genuinely zero."

## Adding a new metric later

1. Add a column to `market_map_snapshots` (and to `market_map_changes`'
   `METRICS` list if you want MoM/YoY tracked for it) via a new SQL
   migration.
2. Compute it in `heat-map-snapshot-background.mjs`'s per-area loop and
   include it in `snapshotRows.push({...})`.
3. Add it to the `METRICS` array in `src/components/HeatMap.astro`'s client
   script (`key`, `label`, `format`, `available: true`). That's the only
   place the UI needs to know about it — pills, legend, and tooltips all
   read from this array.

## Adjusting the schedule

Both capture days run off the **same** cron (`0 9 * * *`, daily, gated
internally by `captureKind()`) rather than two separate Netlify schedules —
mirrors the existing `market-stats-snapshot-background.mjs` convention,
since Netlify cron can't express "1st of next month" and "15th" as a single
expression cleanly alongside each other. To change which calendar days
count as mid-month/month-end, edit `captureKind()` in
`heat-map-snapshot-background.mjs`. To change the time of day, edit the
`schedule` value in that file's `export const config`.
