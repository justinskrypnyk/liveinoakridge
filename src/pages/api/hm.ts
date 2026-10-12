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
import { reverse } from 'node:dns/promises';

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

// What kind of internet connection the visit came from (2026-10-12): the
// provider's domain from a reverse-DNS lookup ("rogers.com", "amazonaws.com"),
// and whether that's a cloud server. Only the provider's domain is kept,
// never the IP. Added after 45 "(somewhere in) US" views on Forest City Homes on Oct 11 that never
// scrolled and looped Hyde Park -> Sunningdale: likely automated, maybe an AI
// assistant browsing for someone, and we had no way to tell.
const CLOUD_DOMAINS = new Set([
  'amazonaws.com', 'googleusercontent.com', '1e100.net', 'cloudapp.net', 'azure.com', 'linode.com',
  'akamaitechnologies.com', 'digitalocean.com', 'vultrusercontent.com', 'choopa.net', 'your-server.de',
  'hetzner.com', 'ovh.net', 'ovh.ca', 'contaboserver.net', 'oraclecloud.com', 'scaleway.com',
  'leaseweb.com', 'leaseweb.net', 'm247.com', 'colocrossing.com', 'hostwindsdns.com', 'servers.com',
]);
type Net = { k: 'cloud' | 'isp' | 'none'; dom: string };
const netCache = new Map<string, Net>();
async function netOf(ip: string): Promise<Net> {
  if (!ip) return { k: 'none', dom: '' };
  const hit = netCache.get(ip);
  if (hit) return hit;
  let host = '';
  try {
    const names = await Promise.race([reverse(ip), new Promise<string[]>((r) => setTimeout(() => r([]), 500))]);
    host = String(names[0] || '').toLowerCase().replace(/\.$/, '');
  } catch {
    host = '';
  }
  const parts = host.split('.').filter(Boolean);
  // "cpe-1-2.rogers.com" -> "rogers.com"; keep 3 labels for "x.co.uk"-style endings.
  const n = parts.length > 2 && /^(co|com|net|ne|or|org)$/.test(parts[parts.length - 2]) && parts[parts.length - 1].length === 2 ? 3 : 2;
  const dom = parts.slice(-n).join('.').slice(0, 60);
  const net: Net = { k: !dom ? 'none' : CLOUD_DOMAINS.has(dom) ? 'cloud' : 'isp', dom };
  if (netCache.size > 1000) netCache.clear();
  netCache.set(ip, net);
  return net;
}

// "Chrome 129 · Windows" -- enough to spot a pattern, not a fingerprint.
function browserOf(ua: string): string {
  const v = (re: RegExp) => ua.match(re)?.[1] || '';
  const name = /Edg\//.test(ua) ? `Edge ${v(/Edg\/(\d+)/)}`
    : /OPR\//.test(ua) ? `Opera ${v(/OPR\/(\d+)/)}`
    : /Firefox\//.test(ua) ? `Firefox ${v(/Firefox\/(\d+)/)}`
    : /CriOS\//.test(ua) ? `Chrome ${v(/CriOS\/(\d+)/)}`
    : /Chrome\//.test(ua) ? `Chrome ${v(/Chrome\/(\d+)/)}`
    : /Safari\//.test(ua) ? `Safari ${v(/Version\/(\d+)/)}`
    : 'Other';
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android'
    : /Windows/.test(ua) ? 'Windows' : /CrOS/.test(ua) ? 'Chromebook' : /Macintosh/.test(ua) ? 'Mac'
    : /Linux/.test(ua) ? 'Linux' : 'Other';
  return `${name.trim()} · ${os}`;
}

// Listing detail pages are one layout with thousands of URLs; grouping them
// makes their heatmap readable instead of 1 view per URL.
function normalizePath(p: string): string {
  return p
    .replace(/^\/(search|properties|sold-map)\/[A-Za-z0-9]{5,20}\/?$/, '/$1/[listing]/')
    .replace(/\/?$/, '/');
}

const clampInt = (n: unknown, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(Number(n) || 0)));

export const POST: APIRoute = async ({ request, locals, clientAddress }) => {
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
  // Who's on the other end (2026-10-12): connection type, browser, and the
  // two signals automation gives away -- the browser's own "I'm being driven
  // by software" flag, and the Signature-Agent header AI agents like
  // ChatGPT's send. `auto` holds the reason when any of them fire.
  let ip = '';
  try {
    ip = String(locals?.netlify?.context?.ip || clientAddress || '');
  } catch {
    ip = '';
  }
  const net = await netOf(ip);
  const agent = String(request.headers.get('signature-agent') || '').replace(/["<>]/g, '').replace(/^https?:\/\//, '').slice(0, 60);
  const extra = {
    net,
    br: browserOf(request.headers.get('user-agent') || ''),
    auto: agent ? `AI agent (${agent})` : b.wd === 1 ? 'Automated browser' : net.k === 'cloud' ? `Cloud server (${net.dom})` : '',
  };
  Object.assign(record, extra);
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
