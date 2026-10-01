// Static imports so esbuild inlines them into each function (same as
// alert-helpers.mjs) -- an import.meta.url path would break once bundled.
import { getStore } from '@netlify/blobs';
import areaBoundaries from '../data/area-boundaries.json' with { type: 'json' };

// Every London residential for-sale listing, from the VOW feed rather than
// the DDF/IDX one. Checked 2026-10-01 against an MLS Quick CMA: the DDF feed
// was missing 8 of Oakridge's 58 active listings (~15% citywide, 1,837 vs
// 2,156), all present here with internet display allowed. Used for market
// STATS only (counts, medians) -- the site's listing pages and emails still
// show DDF listings.
//
// The VOW feed also keeps every status (Closed, Cancelled, ...), which is
// what makes "new listings this month" countable at all: a listing that came
// on and sold within the month is gone from any active-only pull.
//
// AMPRE quirks (confirmed 2026-10-01): $filter takes exactly one contains()
// -- no `and`, no `eq` on strings, no date comparisons -- so status, type and
// date filtering all happen here. contains(UnparsedAddress,'London') also
// matches "London Road" in other towns, hence the City check. ~31k rows in 7
// pages, ~17s.

const PAGE_SIZE = 5000;

// Not homes, so never counted as homes for sale or home sales -- found
// 2026-10-01 when vacant lots showed up in Byron's active count. 'Vacant
// Land Condo' stays: in London that's mostly new houses in a condo
// development (5 of September 2026's sales).
const NOT_A_HOME = new Set(['Vacant Land', 'Farm', 'Store W Apt/Office', 'Other']);

function isHomeForSale(l) {
  return l.PropertyType !== 'Commercial' && l.TransactionType === 'For Sale' && !NOT_A_HOME.has(String(l.PropertySubType || '').trim());
}

export function isLondonResiSale(l) {
  return /^London\b/.test(l.City || '') && isHomeForSale(l);
}

/**
 * London residential for-sale listings, every status.
 * @param {{ baseUrl: string, token: string, select: string[] }} opts
 */
export async function fetchVowLondonListings({ baseUrl, token, select }) {
  return fetchVow({ baseUrl, token, select, filter: "contains(UnparsedAddress,'London')", keep: isLondonResiSale });
}

/** Residential for-sale listings (every status) in one outlying MLS City, e.g. 'St. Thomas'. */
export async function fetchVowCityListings({ baseUrl, token, select, city }) {
  const keep = (l) => l.City === city && isHomeForSale(l);
  return fetchVow({ baseUrl, token, select, filter: `contains(City,'${city.replace(/'/g, "''")}')`, keep });
}

async function fetchVow({ baseUrl, token, select, filter, keep }) {
  const fields = [...new Set([...select, 'City', 'PropertyType', 'PropertySubType', 'TransactionType', 'StandardStatus'])].join(',');
  const first = new URL(`${baseUrl}Property`);
  first.searchParams.set('$filter', filter);
  first.searchParams.set('$select', fields);
  first.searchParams.set('$top', String(PAGE_SIZE));
  const out = [];
  for (let url = first.toString(); url; ) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) throw new Error(`VOW Property fetch -> HTTP ${res.status}: ${await res.text().catch(() => '')}`);
    const data = await res.json();
    out.push(...(data.value || []).filter(keep));
    url = data['@odata.nextLink'];
  }
  return out;
}

/** Start/end (ms) of a calendar month in London's own time zone, so a listing entered at 11pm on the 31st counts in that month. */
export function torontoMonthBounds(year, monthIndex) {
  const offsetMs = (y, m) => {
    // Toronto's UTC offset at midnight on the 1st (EDT -4h / EST -5h).
    const probe = new Date(Date.UTC(y, m, 1, 12));
    const local = new Date(probe.toLocaleString('en-US', { timeZone: 'America/Toronto' }));
    const utc = new Date(probe.toLocaleString('en-US', { timeZone: 'UTC' }));
    return utc - local;
  };
  const start = Date.UTC(year, monthIndex, 1) + offsetMs(year, monthIndex);
  const end = Date.UTC(year, monthIndex + 1, 1) + offsetMs(year, monthIndex + 1);
  return { start, end };
}

// ---- Sales, counted the way the MLS counts them ----------------------------
// A sale belongs to the month it went FIRM (PurchaseContractDate, the MLS
// "Sold Date"), not the month it closed. Until 2026-10-01 every report used
// vow_sold_listings.close_date (possession day), so "September sales" were
// mostly deals made in May-August -- Oakridge showed 19 where the MLS shows
// 11. That table also lacks deals that are firm but not yet closed. Checked
// against an MLS sold Quick CMA: this rule matches it listing for listing.
// A listing's StandardStatus turns 'Closed' (MlsStatus 'Sold') once firm.

export const MIN_PLAUSIBLE_SALE_PRICE = 30000;
export const SALE_FIELDS = ['ListPrice', 'ClosePrice', 'PurchaseContractDate'];

/** Sales that went firm between two dates, inclusive ('YYYY-MM-DD', local dates as the MLS records them). */
export function firmSales(listings, startDate, endDate) {
  return listings.filter((l) => l.StandardStatus === 'Closed'
    && l.PurchaseContractDate >= startDate && l.PurchaseContractDate <= endDate
    && Number(l.ClosePrice) >= MIN_PLAUSIBLE_SALE_PRICE);
}

/** Today's date in London ('YYYY-MM-DD'), and the date n days before it. */
export function torontoDate(daysAgo = 0) {
  return new Date(Date.now() - daysAgo * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
}

/**
 * Neighbourhood slug for each sale, keyed by ListingKey. Uses the slug
 * vow-sold-sync already stored when there is one; deals that are firm but
 * not closed aren't in that table yet, so those fall back to the shared
 * geocode cache (warmed by warm-geocode-cache-background.mjs) and the real
 * neighbourhood polygons. Unplaced sales are simply missing from the map.
 */
export async function placeSales(supabase, sales) {
  const placed = new Map();
  const keys = [...new Set(sales.map((l) => l.ListingKey))];
  for (let i = 0; i < keys.length; i += 200) {
    const { data, error } = await supabase
      .from('vow_sold_listings')
      .select('listing_key, area_slug')
      .in('listing_key', keys.slice(i, i + 200));
    if (error) throw new Error(`vow_sold_listings area lookup failed: ${error.message}`);
    for (const r of data || []) if (r.area_slug) placed.set(r.listing_key, r.area_slug);
  }
  const rest = sales.filter((l) => !placed.has(l.ListingKey) && l.UnparsedAddress);
  if (rest.length === 0) return placed;
  const rings = areaBoundaries.features.map((f) => ({ slug: f.properties.slug, ring: f.geometry.coordinates[0] }));
  const inRing = (lat, lng, ring) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  const store = getStore('ddf-geocode-cache');
  for (const l of rest) {
    const geo = await store.get(l.UnparsedAddress, { type: 'json' }).catch(() => null);
    const hit = geo && rings.find((r) => inRing(Number(geo.lat), Number(geo.lng), r.ring));
    if (hit) placed.set(l.ListingKey, hit.slug);
  }
  return placed;
}

/**
 * The same date range one month earlier ('YYYY-MM-DD'), for month-over-month
 * sales comparisons straight from the feed. A range ending on a month's last
 * day maps to the previous month's last day (Sept 1-30 -> Aug 1-31).
 */
export function previousMonthRange(startDate, endDate) {
  const shift = (ymd, isEnd) => {
    const [y, m, d] = ymd.split('-').map(Number);
    const lastOfThis = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const lastOfPrev = new Date(Date.UTC(y, m - 1, 0)).getUTCDate();
    const day = isEnd && d === lastOfThis ? lastOfPrev : Math.min(d, lastOfPrev);
    return new Date(Date.UTC(y, m - 2, day)).toISOString().slice(0, 10);
  };
  return [shift(startDate, false), shift(endDate, true)];
}

// Citywide rows saved before this date used the old rules (DDF listings,
// sales by closing date), so they're never the "previous" row for MoM.
export const CITYWIDE_METHOD_SINCE = '2026-10-01';
