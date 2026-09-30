// Receives public/hm.js beacons (the in-house heatmap, 2026-09-27) and
// stores each one as its own blob under heatmap-raw/<date>/..., so
// concurrent visitors never overwrite each other. heatmap-rollup-background
// folds them into weekly per-page summaries every hour and deletes them.
//
// Public and anonymous by design, so everything is validated and capped:
// a malformed or oversized body is dropped with a 204 (a beacon never
// reads the response anyway).
import type { APIRoute } from 'astro';
import { getStore } from '@netlify/blobs';

export const prerender = false;

const MAX_BODY = 25000;
const BOT_UA = /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|monitor/i;
// Team testing isn't real visitor behaviour: Smile (Justin's VA) works from
// the Philippines, and the site has no real audience there (Justin, 2026-09-27).
const EXCLUDED_COUNTRIES = new Set(['PH']);

// Netlify's geo lookup for this request (the adapter's context when present,
// else the x-nf-geo / x-country headers Netlify adds in front of functions).
// Only country, province/state and city are kept -- never the IP address,
// which Canadian privacy law treats as personal information. City is the
// visitor's internet provider's best guess: good for "London vs Toronto",
// not exact (phones on cell data often show as Toronto).
type Geo = { co: string; reg: string; city: string };
function geoOf(request: Request, locals: any): Geo {
  let g: any = locals?.netlify?.context?.geo;
  if (!g) {
    try {
      g = JSON.parse(Buffer.from(request.headers.get('x-nf-geo') || '', 'base64').toString('utf8'));
    } catch {
      g = null;
    }
  }
  return {
    co: String(g?.country?.code || request.headers.get('x-country') || '').toUpperCase().slice(0, 2),
    reg: String(g?.subdivision?.code || '').toUpperCase().slice(0, 3),
    city: String(g?.city || '').slice(0, 60),
  };
}

// Listing detail pages are one layout with thousands of URLs; grouping them
// makes their heatmap readable instead of 1 view per URL.
function normalizePath(p: string): string {
  return p
    .replace(/^\/(search|properties|sold-map)\/[A-Za-z0-9]{5,20}\/?$/, '/$1/[listing]/')
    .replace(/\/?$/, '/');
}

const clampInt = (n: unknown, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(Number(n) || 0)));

export const POST: APIRoute = async ({ request, locals }) => {
  const ok = new Response(null, { status: 204 });
  if (BOT_UA.test(request.headers.get('user-agent') || '')) return ok;
  const geo = geoOf(request, locals);
  if (EXCLUDED_COUNTRIES.has(geo.co)) return ok;
  const raw = await request.text();
  if (raw.length > MAX_BODY) return ok;
  let b: any;
  try {
    b = JSON.parse(raw);
  } catch {
    return ok;
  }
  if (typeof b?.p !== 'string' || !b.p.startsWith('/') || b.p.length > 200 || b.p.startsWith('/admin')) return ok;
  if (b.d !== 'm' && b.d !== 'd') return ok;

  const bands: Record<string, number> = {};
  for (const [k, v] of Object.entries(b.a && typeof b.a === 'object' ? b.a : {})) {
    const band = clampInt(k, 0, 1000);
    if (String(band) === k) bands[k] = clampInt(v, 0, 3600);
  }
  const path = b.p.split('?')[0];
  const record = {
    id: String(b.id || '').slice(0, 20),
    p: normalizePath(path),
    ex: path, // a real URL the viewer can show for grouped listing pages
    d: b.d,
    w: clampInt(b.w, 200, 4000),
    h: clampInt(b.h, 200, 100000),
    v: b.v === 1 ? 1 : 0,
    c: (Array.isArray(b.c) ? b.c : []).slice(0, 200)
      .filter((c: unknown) => Array.isArray(c) && c.length >= 2)
      // [x, y, label, seconds after the page opened]
      .map((c: unknown[]) => [clampInt(c[0], 0, 4000), clampInt(c[1], 0, 100000), String(c[2] ?? '').slice(0, 80), clampInt(c[3], 0, 86400)]),
    a: bands,
    s: clampInt(b.s, 0, 100000),
    t: clampInt(b.t, 0, 3600),
    g: geo,
    q: b.q && typeof b.q === 'object' && b.v === 1
      ? Object.fromEntries(['area', 'minPrice', 'maxPrice', 'types', 'minBeds', 'minBaths']
          .filter((k) => typeof b.q[k] === 'string').map((k) => [k, b.q[k].slice(0, 80)]))
      : null,
    f: Object.fromEntries(Object.entries(b.f && typeof b.f === 'object' ? b.f : {}).slice(0, 10)
      .map(([k, v]: [string, any]) => [String(k).slice(0, 40), { s: v?.s === 1 ? 1 : 0, l: String(v?.l || '').slice(0, 40) }])),
    at: new Date().toISOString(),
    // For the visitor-sessions view (2026-09-28): the anonymous visit id,
    // when the page was opened (worked out from the gap between the
    // device's own "opened" and "sent" times, so a wrong device clock
    // doesn't matter), its title, and where the visit came from.
    sid: /^[a-z0-9]{4,20}$/.test(String(b.sid || '')) ? String(b.sid) : '',
    opened: '',
    ti: String(b.ti || '').slice(0, 100),
    r: /^[a-z0-9.-]{1,80}$/i.test(String(b.r || '')) ? String(b.r).toLowerCase() : '',
    u: String(b.u || '').slice(0, 80),
    // Real-world speed (2026-09-29): LCP and INP in ms, CLS as a score.
    pf: b.pf && typeof b.pf === 'object' && Number(b.pf.l) > 0
      ? { l: clampInt(b.pf.l, 1, 60000), i: clampInt(b.pf.i, 0, 10000), c: Math.min(10, Math.max(0, Number(b.pf.c) || 0)) }
      : null,
  };
  const openedAgo = Number(b.n) - Number(b.st);
  if (Number.isFinite(openedAgo) && openedAgo >= 0 && openedAgo < 86400000) {
    record.opened = new Date(Date.parse(record.at) - openedAgo).toISOString();
  }

  try {
    const key = `${record.at.slice(0, 10)}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    await getStore('heatmap-raw').setJSON(key, record);
  } catch (err) {
    console.error('hm: store failed', err instanceof Error ? err.message : err);
  }
  return ok;
};
