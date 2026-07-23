// Viewport-driven sold-listing search backing /sold-map/'s live map. Reads
// pre-synced data from Supabase (vow_sold_listings -- see
// vow-sold-sync-background.mjs), not a live AMPRE call.
//
// Gating happens HERE, server-side, not just in the UI: an unauthenticated
// request gets jittered coordinates (+/- ~150m), a masked price, and a
// street-name-only address (no house number/unit -- a teaser, not the real
// gated value) -- never the exact address or real price, so opening
// devtools' network tab doesn't defeat the login gate. Article 6.3(b) of
// the VOW agreement also caps any single response to a consumer at 100
// listings -- enforced below regardless of auth state.
import type { APIRoute } from 'astro';
import { getServiceRoleClient } from '@/lib/supabase';
import { getVowSession } from '@/lib/vow-session';
import { subtypesForCategories } from '@/lib/vow-property-types';

export const prerender = false;

const RESPONSE_CAP = 100; // Article 6.3(b)
const JITTER_DEGREES = 0.0013; // ~150m at this latitude

function jitter(value: number): number {
  return value + (Math.random() * 2 - 1) * JITTER_DEGREES;
}

function maskPrice(price: number | null): string {
  if (price == null) return '$???,???';
  const digits = String(Math.round(price)).length;
  return `$${'X'.repeat(digits - 3)},XXX`;
}

// Street name without the house number or unit -- a common teaser pattern
// (Zillow/HouseSigma do the same for locked listings): specific enough to
// feel real, not specific enough to identify which exact house. Full
// address stays gated behind sign-in, same as price.
function streetNameOnly(address: string | null): string | null {
  if (!address) return null;
  return address
    .replace(/^\d+\s*-\s*/, '') // leading "16 - " unit prefix
    .replace(/^\d+[A-Za-z]?\s+/, '') // leading street number, e.g. "1260 " or "123A "
    .trim() || null;
}

/** 'd90' -> a from-date 90 days back; 'y2025' -> Jan 1 / Dec 31 of that year; 'all' -> no bound. */
function dateRangeBounds(dateRange: string | null): { from: string | null; to: string | null } {
  if (!dateRange || dateRange === 'all') return { from: null, to: null };
  const daysMatch = dateRange.match(/^d(\d+)$/);
  if (daysMatch) {
    const days = Number(daysMatch[1]);
    const from = new Date();
    from.setDate(from.getDate() - days);
    return { from: from.toISOString().slice(0, 10), to: null };
  }
  const yearMatch = dateRange.match(/^y(\d{4})$/);
  if (yearMatch) {
    const year = yearMatch[1];
    return { from: `${year}-01-01`, to: `${year}-12-31` };
  }
  return { from: null, to: null };
}

export const GET: APIRoute = async ({ url, cookies }) => {
  const params = url.searchParams;
  const north = Number(params.get('north'));
  const south = Number(params.get('south'));
  const east = Number(params.get('east'));
  const west = Number(params.get('west'));

  if (![north, south, east, west].every((n) => Number.isFinite(n))) {
    return new Response(JSON.stringify({ error: 'Invalid bounds' }), { status: 400 });
  }

  const minPrice = Number(params.get('minPrice')) || undefined;
  const maxPrice = Number(params.get('maxPrice')) || undefined;
  const minBeds = Number(params.get('minBeds')) || undefined;
  const minBaths = Number(params.get('minBaths')) || undefined;
  const minParking = Number(params.get('minParking')) || undefined;
  const minSqft = Number(params.get('minSqft')) || undefined;
  const maxSqft = Number(params.get('maxSqft')) || undefined;
  const typeSlugs = (params.get('types') || '').split(',').filter(Boolean);
  const subtypes = typeSlugs.length > 0 ? subtypesForCategories(typeSlugs) : [];
  const { from: dateFrom, to: dateTo } = dateRangeBounds(params.get('dateRange'));
  // 'exclude' (default) -> resale only, capped at today; 'only' -> just
  // pre-construction/assignment sales. There's no reliable board flag for
  // this (AssignmentYN is null even on obvious builder sales -- verified
  // empirically), so a future CloseDate is the signal: ~7.5% of synced
  // listings have one, since new-build/assignment closings get recorded
  // months to years ahead of the actual possession date. Mixing those into
  // "recently sold" comps would badly skew them (a 2027 closing can reflect
  // a price locked in back in 2022).
  const preConstruction = params.get('preConstruction') === 'only' ? 'only' : 'exclude';
  const today = new Date().toISOString().slice(0, 10);

  const supabase = getServiceRoleClient();
  if (!supabase) {
    return new Response(JSON.stringify({ listings: [], total: 0, capped: false, authenticated: false }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let query = supabase
    .from('vow_sold_listings')
    .select('listing_key,address,city,lat,lng,close_price,close_date,list_price,beds,baths,sqft,parking_total,property_sub_type,photo_url', {
      count: 'exact',
    })
    .gte('lat', south)
    .lte('lat', north)
    .gte('lng', west)
    .lte('lng', east)
    .not('lat', 'is', null)
    .order('close_date', { ascending: false })
    .limit(RESPONSE_CAP);

  if (minPrice) query = query.gte('close_price', minPrice);
  if (maxPrice) query = query.lte('close_price', maxPrice);
  if (minBeds) query = query.gte('beds', minBeds);
  if (minBaths) query = query.gte('baths', minBaths);
  if (minParking) query = query.gte('parking_total', minParking);
  if (minSqft) query = query.gte('sqft', minSqft);
  if (maxSqft) query = query.lte('sqft', maxSqft);
  if (subtypes.length > 0) query = query.in('property_sub_type', subtypes);

  if (preConstruction === 'only') {
    // Pre-construction view ignores the normal sold-date-range control
    // entirely (that control means "resale activity in this window", a
    // different question from "what's pre-selling") and just shows every
    // future-dated closing, most recent first regardless of window.
    query = query.gt('close_date', today);
  } else {
    if (dateFrom) query = query.gte('close_date', dateFrom);
    query = query.lte('close_date', dateTo && dateTo < today ? dateTo : today);
  }

  const { data, error, count } = await query;

  if (error) {
    console.error('sold-listings query failed:', error.message);
    return new Response(JSON.stringify({ error: 'Query failed' }), { status: 500 });
  }

  const authenticated = getVowSession(cookies) !== null;
  const total = count ?? data?.length ?? 0;

  const listings = (data ?? []).map((row) => {
    const isPreConstruction = row.close_date != null && row.close_date > today;
    if (authenticated) {
      return {
        mls: row.listing_key,
        lat: row.lat,
        lng: row.lng,
        address: row.address,
        city: row.city,
        closePrice: row.close_price,
        closeDate: row.close_date,
        listPrice: row.list_price,
        beds: row.beds,
        baths: row.baths,
        sqft: row.sqft,
        type: row.property_sub_type,
        locked: false,
        isPreConstruction,
        photoUrl: row.photo_url,
      };
    }
    return {
      mls: null,
      lat: jitter(row.lat),
      lng: jitter(row.lng),
      address: streetNameOnly(row.address),
      city: row.city,
      closePrice: maskPrice(row.close_price),
      closeDate: row.close_date ? row.close_date.slice(0, 7) : null, // month-only, not the exact day
      listPrice: null,
      photoUrl: row.photo_url, // opaque hashed AMPRE path, doesn't leak the address -- safe to send; the client blurs it via CSS
      isPreConstruction,
      beds: row.beds,
      baths: row.baths,
      sqft: null,
      type: row.property_sub_type,
      locked: true,
    };
  });

  return new Response(
    JSON.stringify({ listings, total, capped: total > RESPONSE_CAP, authenticated }),
    { headers: { 'Content-Type': 'application/json' } }
  );
};
