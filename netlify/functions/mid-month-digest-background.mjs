// Scheduled job -- emails Justin + Smile a lightweight "where things stand"
// check-in on the 16th of each month, using the mid-month capture
// heat-map-snapshot-background.mjs already writes to market_map_snapshots
// that same morning (9am UTC vs this job's 10am UTC, same day -- the gap
// guarantees the row already exists, same pattern as monthly-digest-
// background.mjs).
//
// Runs the 16th, not the 15th, so the underlying capture has a FULL day of
// the 15th's activity to report rather than only whatever happened before
// heat-map-snapshot's early-morning run on the 15th itself -- per Justin's
// ask 2026-09-16. He asked for 3am EST specifically; that's ~8am UTC, which
// would fire BEFORE heat-map-snapshot's 9am UTC capture and read last
// month's stale mid-month row instead of a fresh one. 10am UTC (~5-6am
// Eastern depending on DST) is the earliest this can safely run after that
// dependency.
//
// Deliberately a SUBSET of monthly-digest's per-neighbourhood metrics --
// started running-counts-only (active listings, new listings since the
// last capture, units sold month-to-date) on the theory that half a month
// is too thin a sample per neighbourhood for a median to mean much. Same
// day, Justin asked for median sale price + days on market added back in
// anyway -- included now (LIGHT_METRICS below), with a standing caveat in
// the email itself that a lower-volume area's mid-month median is
// directional, not exact. Sale-to-list ratio / median list price per
// neighbourhood still stay exclusive to the full month-end review on the
// 1st, alongside the neighbourhood map -- this remains a "how's it
// trending so far" pulse check, not a second full report.
//
// EXCEPTION, added 2026-09-16 per Justin: a citywide (all of London, not
// broken out by neighbourhood) median sold price / median list price /
// days-on-market IS included -- citywide sample size is large enough even
// mid-month, and Justin wants the same 3 headline numbers here that
// monthly-digest shows per neighbourhood, just for the city as a whole.
// Computed fresh via a live DDF pull + a direct vow_sold_listings query
// (same pattern weekly-digest-background.mjs already uses for its own
// citywide totals), NOT sourced from market_map_snapshots -- that table is
// per-neighbourhood only, and every one of its other consumers (the public
// /market-map/ page, the Forest City Homes JSON bridge, the CSV export,
// market-update-mailout) treats every row in it as a real neighbourhood
// polygon. Writing a synthetic "citywide" row into that shared table would
// leak into all of those as a phantom 40th neighbourhood -- deliberately
// kept out of it entirely instead.
//
// Same AI-free compilation principle as the other digests: every number
// here is a fixed lookup/aggregate over live MLS data, not an AI
// interpreting it.
import { createClient } from '@supabase/supabase-js';

const DDF_ACCESS_TOKEN = process.env.DDF_ACCESS_TOKEN;
const DDF_API_BASE_URL = process.env.DDF_API_BASE_URL;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const DIGEST_TO_EMAIL = process.env.DIGEST_TO_EMAIL || 'info@homeswithjustin.ca';

// Same backstop as every other function that touches vow_sold_listings --
// see weekly-digest-background.mjs's own copy of this constant for the
// full story (AMPRE leases occasionally sync with is_lease wrongly false).
const MIN_PLAUSIBLE_SALE_PRICE = 30000;

const SERVED_AREA_ORDER = ['oakridge', 'byron', 'westmount', 'riverbend', 'lambeth', 'whitehills', 'west-london'];

function sortAreasServedFirst(areas) {
  return [...areas].sort((a, b) => {
    const aIdx = SERVED_AREA_ORDER.indexOf(a.area_slug);
    const bIdx = SERVED_AREA_ORDER.indexOf(b.area_slug);
    if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
    if (aIdx !== -1) return -1;
    if (bIdx !== -1) return 1;
    return a.area_name.localeCompare(b.area_name);
  });
}

// Per-neighbourhood metrics shown in the breakdown table. Started as
// running counts only (no medians/ratios), on the theory that half a
// month is too thin a sample per neighbourhood -- Justin asked for
// median sale price + days on market added back in anyway (2026-09-16),
// so they're included with that caveat still worth keeping in mind for a
// low-volume area. Sale-to-list ratio / median list price stay excluded
// (noisier still, and month-end already covers them in full).
const LIGHT_METRICS = [
  { key: 'units_sold_month', label: 'Sold So Far', fmt: (n) => (n == null ? 'n/a' : String(n)) },
  { key: 'new_listings_count', label: 'New Listings', fmt: (n) => (n == null ? 'n/a' : String(n)) },
  { key: 'active_count', label: 'Active Listings', fmt: (n) => (n == null ? 'n/a' : String(n)) },
  { key: 'median_sold_price_month', label: 'Med. Sale Price', fmt: fmtPrice },
  { key: 'avg_days_on_market', label: 'Days on Market', fmt: (n) => (n == null ? 'n/a' : String(Math.round(n))) },
];
const METRIC_LABELS = Object.fromEntries(LIGHT_METRICS.map((m) => [m.key, m.label]));

function fmtPct(n) {
  if (n == null) return 'n/a';
  return `${n > 0 ? '+' : ''}${(n * 100).toFixed(1)}%`;
}

function fmtPrice(n) {
  if (n == null) return 'n/a';
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(n);
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function median(numbers) {
  if (numbers.length === 0) return null;
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid];
}

function average(numbers) {
  if (numbers.length === 0) return null;
  return Math.round(numbers.reduce((sum, n) => sum + n, 0) / numbers.length);
}

function daysSince(timestamp) {
  const listed = new Date(timestamp).getTime();
  if (Number.isNaN(listed)) return null;
  return Math.max(0, Math.floor((Date.now() - listed) / (1000 * 60 * 60 * 24)));
}

async function odataGet(resource, params) {
  const url = new URL(`${DDF_API_BASE_URL}${resource}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${DDF_ACCESS_TOKEN}`, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${resource} -> HTTP ${res.status}: ${await res.text().catch(() => '')}`);
  return res.json();
}

function pctChange(previous, current) {
  if (previous == null || current == null || previous === 0) return null;
  return (current - previous) / previous;
}

// Citywide (all of London, no per-neighbourhood split -- so no geocoding
// needed at all) median list price + days on market from a live DDF pull,
// plus median sold price for the given date range from vow_sold_listings.
// See header comment for why this is computed live rather than sourced
// from market_map_snapshots.
//
// Also computes month-over-month % change and persists this capture into
// the citywide_snapshots table (see supabase/migrations/005) so NEXT
// month's run has a prior row of the same period_type to compare against
// -- added 2026-09-16 per Justin's ask. Same "compare only against the
// most recent prior row of the SAME period_type" rule
// heat-map-snapshot-background.mjs already uses for the per-neighbourhood
// market_map_changes table (mid-month vs. mid-month, never vs. month-end).
async function getCitywideStats(supabase, monthStart, monthEnd, periodType, captureDate) {
  const data = await odataGet('Property', {
    $filter: `contains(UnparsedAddress,'London')`,
    $select: 'ListPrice,StandardStatus,PropertyType,TransactionType,OriginalEntryTimestamp',
    $top: '5000',
  });
  const active = (data.value || []).filter(
    (l) => l.StandardStatus === 'Active' && l.PropertyType !== 'Commercial' && l.TransactionType !== 'For Lease'
  );
  const listPrices = active.map((l) => Number(l.ListPrice)).filter((n) => n > 0);
  const dom = active.map((l) => daysSince(l.OriginalEntryTimestamp)).filter((n) => n !== null);

  // Paginated explicitly -- Supabase's default .select() caps at 1,000 rows
  // with no error (see heat-map-snapshot-background.mjs's own comment on
  // this exact bug, caught 2026-08).
  const soldPrices = [];
  const PAGE_SIZE = 1000;
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data: page, error } = await supabase
      .from('vow_sold_listings')
      .select('close_price')
      .eq('is_lease', false)
      .gte('close_price', MIN_PLAUSIBLE_SALE_PRICE)
      .gte('close_date', monthStart)
      .lte('close_date', monthEnd)
      .range(from, from + PAGE_SIZE - 1);
    if (error) {
      console.error('mid-month-digest: citywide sold query failed:', error.message);
      break;
    }
    soldPrices.push(...(page || []).map((r) => Number(r.close_price)).filter((n) => n > 0));
    if (!page || page.length < PAGE_SIZE) break;
  }

  const current = {
    activeCount: active.length,
    medianListPrice: median(listPrices),
    avgDaysOnMarket: average(dom),
    medianSoldPrice: soldPrices.length > 0 ? median(soldPrices) : null,
    unitsSold: soldPrices.length,
  };

  const { data: prevRows, error: prevError } = await supabase
    .from('citywide_snapshots')
    .select('median_list_price, avg_days_on_market, median_sold_price')
    .eq('period_type', periodType)
    .lt('capture_date', captureDate)
    .order('capture_date', { ascending: false })
    .limit(1);
  if (prevError) console.error('mid-month-digest: citywide_snapshots history query failed:', prevError.message);
  const prev = prevRows?.[0] || null;

  const { error: upsertError } = await supabase
    .from('citywide_snapshots')
    .upsert({
      period_type: periodType,
      capture_date: captureDate,
      median_list_price: current.medianListPrice,
      avg_days_on_market: current.avgDaysOnMarket,
      median_sold_price: current.medianSoldPrice,
      units_sold: current.unitsSold,
      active_count: current.activeCount,
    }, { onConflict: 'period_type,capture_date' });
  if (upsertError) console.error('mid-month-digest: citywide_snapshots upsert failed:', upsertError.message);

  return {
    ...current,
    momMedianSoldPrice: prev ? pctChange(prev.median_sold_price, current.medianSoldPrice) : null,
    momMedianListPrice: prev ? pctChange(prev.median_list_price, current.medianListPrice) : null,
    momAvgDaysOnMarket: prev ? pctChange(prev.avg_days_on_market, current.avgDaysOnMarket) : null,
  };
}

async function sendDigestEmail(subject, html) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      // Verified domain sender -- see monthly-digest-background.mjs's
      // sendDigestEmail comment for the full Resend sandbox-403 story.
      from: 'Live In Oakridge Reports <reports@mail.liveinoakridge.ca>',
      to: [DIGEST_TO_EMAIL, 'smile@homeswithjustin.ca'],
      subject,
      html,
    }),
  });
  if (!res.ok) throw new Error(`Resend send failed -> HTTP ${res.status}: ${await res.text().catch(() => '')}`);
}

// Best-effort failure alert, same pattern as monthly-digest-background.mjs
// -- Justin-only, not Smile, since this is an ops alert not a report.
async function sendFailureAlert(message) {
  if (!RESEND_API_KEY) return;
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Live In Oakridge Reports <reports@mail.liveinoakridge.ca>',
        to: [DIGEST_TO_EMAIL],
        subject: '⚠️ Mid-month digest FAILED to send',
        html: `<p>${esc(message)}</p><p>Check Netlify function logs for mid-month-digest-background.</p>`,
      }),
    });
  } catch (err) {
    console.error('mid-month-digest: failure alert itself failed to send:', err.message);
  }
}

export default async () => {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !RESEND_API_KEY || !DDF_ACCESS_TOKEN || !DDF_API_BASE_URL) {
    console.error('mid-month-digest: missing required env vars', {
      SUPABASE_URL: !!SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: !!SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY: !!RESEND_API_KEY,
      DDF_ACCESS_TOKEN: !!DDF_ACCESS_TOKEN, DDF_API_BASE_URL: !!DDF_API_BASE_URL,
    });
    return new Response('Missing required env vars', { status: 500 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: latestMidMonth } = await supabase
    .from('market_map_snapshots')
    .select('capture_date')
    .eq('period_type', 'mid-month')
    .order('capture_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!latestMidMonth) {
    console.log('mid-month-digest: no mid-month snapshot found yet, skipping');
    return new Response('No mid-month snapshot found yet');
  }

  // Unlike monthly-digest's month-end capture, a mid-month row's
  // capture_date IS the month being reported (month-to-date through the
  // 15th, even though the capture itself runs the 16th) -- no prior-month
  // offset needed here. See heat-map-snapshot-background.mjs's
  // monthRangeStart/End comment.
  const captureDateObj = new Date(`${latestMidMonth.capture_date}T00:00:00Z`);
  const monthLabel = captureDateObj.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  // Citywide month-to-date range -- 1st of the current month through today
  // (the 16th, when this runs), same "real dates within the month, not a
  // rolling window" logic as heat-map-snapshot-background.mjs's own
  // mid-month monthRangeStart/End.
  const now = new Date();
  const cityMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const cityMonthEnd = now.toISOString().slice(0, 10);

  try {
    const [{ data: snapshotRows, error: snapError }, { data: changeRows, error: changeError }, citywide] = await Promise.all([
      supabase
        .from('market_map_snapshots')
        .select(['area_slug', 'area_name', 'capture_date', ...LIGHT_METRICS.map((m) => m.key)].join(','))
        .eq('period_type', 'mid-month')
        .eq('capture_date', latestMidMonth.capture_date),
      supabase
        .from('market_map_changes')
        .select('area_slug, area_name, metric, current_value, mom_pct_change, is_notable')
        .eq('period_type', 'mid-month')
        .eq('capture_date', latestMidMonth.capture_date)
        .in('metric', LIGHT_METRICS.map((m) => m.key)),
      getCitywideStats(supabase, cityMonthStart, cityMonthEnd, 'mid-month', cityMonthEnd),
    ]);

    if (snapError || !snapshotRows) {
      console.error('mid-month-digest: snapshot query failed:', snapError?.message);
      return new Response('Query failed', { status: 500 });
    }
    if (changeError) console.error('mid-month-digest: change query failed:', changeError.message);

    const sortedRows = sortAreasServedFirst(snapshotRows);

    const totalSoldSoFar = snapshotRows.reduce((sum, r) => sum + (r.units_sold_month || 0), 0);
    const totalNewListings = snapshotRows.reduce((sum, r) => sum + (r.new_listings_count || 0), 0);
    const totalActive = snapshotRows.reduce((sum, r) => sum + (r.active_count || 0), 0);

    // Same "notable" convention as monthly-digest -- 10%+ move, MoM here
    // meaning against last month's mid-month capture (same period_type),
    // not against the 1st. Served areas first, per Justin.
    const notable = (changeRows || []).filter((c) => c.is_notable).sort((a, b) => Math.abs(b.mom_pct_change) - Math.abs(a.mom_pct_change));
    const notableServed = notable.filter((c) => SERVED_AREA_ORDER.includes(c.area_slug));
    const notableOther = notable.filter((c) => !SERVED_AREA_ORDER.includes(c.area_slug));

    function notableLineHtml(c) {
      const direction = c.mom_pct_change > 0 ? '▲' : '▼';
      const label = METRIC_LABELS[c.metric] || c.metric;
      return `<li>${direction} <strong>${esc(c.area_name)}</strong> — ${esc(label)}: ${fmtPct(c.mom_pct_change)} vs. last month's mid-point (now ${c.current_value})</li>`;
    }

    const tableRows = sortedRows.map((r) => {
      const isServed = SERVED_AREA_ORDER.includes(r.area_slug);
      const nameCell = isServed ? `<strong>${esc(r.area_name)}</strong>` : esc(r.area_name);
      return `<tr>
        <td style="padding:4px 10px;">${nameCell}</td>
        <td style="padding:4px 10px;">${r.active_count ?? 'n/a'}</td>
        <td style="padding:4px 10px;">${r.new_listings_count ?? 'n/a'}</td>
        <td style="padding:4px 10px;">${r.units_sold_month ?? 'n/a'}</td>
        <td style="padding:4px 10px;">${fmtPrice(r.median_sold_price_month)}</td>
        <td style="padding:4px 10px;">${r.avg_days_on_market != null ? Math.round(r.avg_days_on_market) : 'n/a'}</td>
      </tr>`;
    }).join('');

    const html = `
      <h2>Mid-Month Check-In — ${esc(monthLabel)}</h2>
      <p>Active Listings: ${totalActive} · New Listings: ${totalNewListings} · Sold So Far: ${totalSoldSoFar} · ${snapshotRows.length} neighbourhoods</p>
      <p style="font-size:12px;color:#888;">Month-to-date through the 15th -- a partial picture, not the final month. Full stats + neighbourhood map land on the 1st, like always.</p>

      <h3>🏙️ London — Citywide</h3>
      <p>Med. Sale Price: ${fmtPrice(citywide.medianSoldPrice)} (${fmtPct(citywide.momMedianSoldPrice)} vs. last month's mid-point, ${citywide.unitsSold} sold) · Med. List Price: ${fmtPrice(citywide.medianListPrice)} (${fmtPct(citywide.momMedianListPrice)}) · Med. Days on Market: ${citywide.avgDaysOnMarket ?? 'n/a'} (${fmtPct(citywide.momAvgDaysOnMarket)})</p>

      <h3>🔔 Notable Moves — Your 7 Areas (10%+ vs. last month's mid-point)</h3>
      ${notableServed.length > 0 ? `<ul>${notableServed.map(notableLineHtml).join('')}</ul>` : '<p style="color:#888;">None this period (or not enough history yet to compute a % change).</p>'}

      <h3>Other Notable Moves (10%+ vs. last month's mid-point)</h3>
      ${notableOther.length > 0 ? `<ul>${notableOther.slice(0, 15).map(notableLineHtml).join('')}</ul>` : '<p style="color:#888;">None this period.</p>'}

      <table style="border-collapse:collapse;font-size:13px;">
        <tr style="font-weight:bold;border-bottom:1px solid #ccc;"><td style="padding:4px 10px;">Neighbourhood</td><td style="padding:4px 10px;">Active</td><td style="padding:4px 10px;">New</td><td style="padding:4px 10px;">Sold So Far</td><td style="padding:4px 10px;">Med. Sale Price</td><td style="padding:4px 10px;">Days on Market</td></tr>
        ${tableRows}
      </table>
      <p>Bold = your 7 served areas. Med. Sale Price/Days on Market are month-to-date per neighbourhood -- a small sample for a lower-volume area, treat as directional rather than exact until the full month-end numbers land on the 1st.</p>
      <p style="font-size:12px;color:#888;">Auto-generated from live MLS data -- no AI involved in compiling these numbers.</p>
    `;

    await sendDigestEmail(`Mid-Month Check-In — ${monthLabel}`, html);

    const summary = `mid-month-digest sent: ${sortedRows.length} areas, ${totalActive} active, ${totalNewListings} new, ${totalSoldSoFar} sold so far, citywide med. sold ${citywide.medianSoldPrice ?? 'n/a'}`;
    console.log(summary);
    return new Response(summary);
  } catch (err) {
    console.error('mid-month-digest: failed:', err.message);
    await sendFailureAlert(`Mid-month digest for ${monthLabel} failed: ${esc(err.message)}`);
    return new Response(`Failed: ${err.message}`, { status: 500 });
  }
};

export const config = {
  schedule: '0 10 16 * *', // 16th of month, 10am UTC (~5-6am Eastern) -- shortly after heat-map-snapshot's 9am UTC mid-month capture same day
};
