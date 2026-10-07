// Backs /admin/comps/ (Justin's comparable-homes finder). Gated by
// ?key=HEATMAP_KEY like the admin pages. Three calls:
//   GET  ?q=<address or MLS#>  -> the subject home's starting specs
//   POST {subject, weights, filters} -> scored comps: sold / conditional / active
//   GET  ?photos=<ListingKey>  -> that listing's photos (VOW Media)
// Reads the nightly index written by netlify/functions/comps-index-background.mjs.
import type { APIRoute } from 'astro';
import { getStore } from '@netlify/blobs';
import { odataGet, getSoldListingPhotos } from '@/lib/vow-listing';
import { COMPS_SELECT, statusOf, slim, placeOf } from '@/lib/comps-shared.mjs';
import { geocodeFreeformAddress } from '@/lib/ddf';
import {
  rankComps, subjectFromRow, km, DEFAULT_WEIGHTS,
  type CompRow, type Subject, type Weights, type Filters,
} from '@/lib/comps-score';

export const prerender = false;

type Index = { builtAt: string; soldSince: string; counts: Record<string, number>; rows: CompRow[] };
let cache: { at: number; index: Index } | null = null;
let inFlight: Promise<Index | null> | null = null;
const TTL_MS = 10 * 60 * 1000;

async function loadIndex(): Promise<Index | null> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.index;
  inFlight ??= (async () => {
    try {
      // Local dev has no Blobs access; point COMPS_INDEX_FILE at a saved copy.
      const devFile = import.meta.env.DEV ? process.env.COMPS_INDEX_FILE : undefined;
      const index = devFile
        ? (JSON.parse((await import('node:fs')).readFileSync(devFile, 'utf8')) as Index)
        : ((await getStore('comps-index').get('latest', { type: 'json' })) as Index | null);
      if (index) cache = { at: Date.now(), index };
      return index;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
  });

function authorized(url: URL) {
  const expected = import.meta.env.HEATMAP_KEY;
  return Boolean(expected) && url.searchParams.get('key') === expected;
}

// "520 Oakridge Dr, London" -> { num: '520', street: 'oakridge' }
function parseAddress(q: string) {
  const clean = q.toLowerCase().replace(/[#,.]/g, ' ').replace(/\s+/g, ' ').trim();
  const m = clean.match(/(?:^|\s|-)(\d+[a-z]?)\s+([a-z0-9'][a-z0-9' ]*)/);
  if (!m) return null;
  const street = m[2].split(' ').filter((w) => !/^(london|on|ontario|n\d\w)$/.test(w))[0];
  return street ? { num: m[1], street } : null;
}
function addressMatches(address: string, p: { num: string; street: string }) {
  const a = address.toLowerCase().replace(/[#,.]/g, ' ').replace(/\s+/g, ' ');
  return new RegExp(`(^|\\s|-)${p.num}\\s+${p.street}\\b`).test(a);
}
const newest = (rows: CompRow[]) => [...rows].sort((x, y) => (y.d || '').localeCompare(x.d || ''))[0];

async function liveLookup(filter: string, keep: (r: Record<string, unknown>) => boolean): Promise<CompRow | null> {
  try {
    const data = await odataGet('Property', { $filter: filter, $select: COMPS_SELECT.join(','), $top: '1000' });
    const rows = ((data.value || []) as Record<string, unknown>[])
      .filter(keep)
      .map((l) => slim(l, statusOf(l, '0000-00-00') || 'S') as CompRow);
    return rows.length ? newest(rows) : null;
  } catch (err) {
    console.error('comps live lookup failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

async function findSubject(q: string, index: Index | null) {
  const rows = index?.rows || [];
  const isMls = /^[a-z]?\d{6,9}$/i.test(q.trim());

  let row: CompRow | null = null;
  let source = '';
  if (isMls) {
    row = rows.find((r) => r.k.toLowerCase() === q.trim().toLowerCase()) || null;
    if (!row) row = await liveLookup(`contains(ListingKey,'${q.trim().toUpperCase()}')`, (l) => String(l.ListingKey).toLowerCase() === q.trim().toLowerCase());
    source = row ? `MLS® ${row.k} (${row.mls || ''}${row.d ? `, ${row.d}` : ''})` : '';
  } else {
    const p = parseAddress(q);
    if (p) {
      const hits = rows.filter((r) => addressMatches(r.a, p));
      row = hits.length ? newest(hits) : null;
      // Not listed in the last 2 years -- the feed still has its older history.
      if (!row) row = await liveLookup(`contains(UnparsedAddress,'${p.street.replace(/'/g, "''")}')`, (l) => addressMatches(String(l.UnparsedAddress || ''), p));
      if (row) source = `Found in MLS®: ${row.mls || row.st} ${row.d || ''} (MLS® ${row.k}). Check the details; the home may have changed since.`;
    }
  }

  let subject: Subject;
  if (row) {
    subject = subjectFromRow(row, row.a);
    if (row.gp !== 'exact' || subject.lat == null) {
      const g = await geocodeFreeformAddress(row.a).catch(() => null);
      if (g) Object.assign(subject, { lat: g.lat, lng: g.lng }, placeOf(g.lat, g.lng));
    }
  } else {
    let g = isMls ? null : await geocodeFreeformAddress(q).catch(() => null);
    // Google will "find" a typo'd street somewhere else in Ontario -- only
    // trust a match within ~60 km of London.
    if (g && km(g.lat, g.lng, 42.9849, -81.2453) > 60) g = null;
    subject = {
      address: q, lat: g?.lat ?? null, lng: g?.lng ?? null, ...(g ? placeOf(g.lat, g.lng) : { ar: null, arn: null }),
      subType: 'Detached', style: null, beds: null, bedsBelow: null, baths: null,
      sqft: null, age: null, lot: null, rural: false, basement: null, garage: null,
    };
    source = g ? 'Not found in MLS®. Location found; fill in the home\'s details below.' : 'Couldn\'t find that address. Check the spelling or try the MLS® number.';
  }
  return { subject, source, mlsRow: row };
}

export const GET: APIRoute = async ({ url }) => {
  if (!authorized(url)) return json({ error: 'Not found' }, 404);

  const photosFor = url.searchParams.get('photos');
  if (photosFor) return json({ photos: await getSoldListingPhotos(photosFor) });

  const q = (url.searchParams.get('q') || '').trim();
  const index = await loadIndex();
  const meta = index ? { builtAt: index.builtAt, soldSince: index.soldSince, counts: index.counts } : null;
  if (!q) return json({ index: meta });
  return json({ index: meta, ...(await findSubject(q, index)) });
};

export const POST: APIRoute = async ({ url, request }) => {
  if (!authorized(url)) return json({ error: 'Not found' }, 404);
  const index = await loadIndex();
  if (!index) return json({ error: 'The comps list hasn\'t been built yet. It builds nightly.' }, 503);

  const body = (await request.json().catch(() => null)) as { subject?: Subject; weights?: Partial<Weights>; filters?: Partial<Filters>; exclude?: string } | null;
  if (!body?.subject) return json({ error: 'Missing subject' }, 400);

  const weights = { ...DEFAULT_WEIGHTS, ...(body.weights || {}) } as Weights;
  const filters: Filters = { maxKm: 3, soldMonths: 6, sameTypeOnly: true, minBeds: null, maxBeds: null, ...(body.filters || {}) };
  // Never compare the subject with its own listing (or its own last sale).
  const own = body.subject.address.toLowerCase();
  const rows = index.rows.filter((r) => r.k !== body.exclude && r.a.toLowerCase() !== own);
  const ranked = rankComps(body.subject, rows, weights, filters);
  const LIMIT = { S: 40, C: 20, A: 30 } as const;
  return json({
    totals: { S: ranked.S.length, C: ranked.C.length, A: ranked.A.length },
    S: ranked.S.slice(0, LIMIT.S),
    C: ranked.C.slice(0, LIMIT.C),
    A: ranked.A.slice(0, LIMIT.A),
  });
};
