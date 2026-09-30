// "Your lead is back" (Justin, 2026-09-29). attribution-client.ts sends one
// beacon per page when a known lead's browser comes back to the site: one
// that has sent a form here (browser_id, linked to the GHL contact by
// ghl-lead.ts) or arrived from a GHL email link carrying ?lid=<contact id>.
// Each page is stored as its own blob under lead-activity/<contactId>/...,
// and lead-back-alerts-background.mjs emails Justin once the visit is over.
//
// Public and anonymous like api/hm.ts: everything is validated and capped,
// and anything unrecognised is dropped with a 204.
import type { APIRoute } from 'astro';
import { getStore } from '@netlify/blobs';

export const prerender = false;

const BOT_UA = /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|monitor/i;
// Smile's own testing (same rule as api/hm.ts).
const EXCLUDED_COUNTRIES = new Set(['PH']);
// The visit that sent the form isn't "coming back".
const SAME_VISIT_HOURS = 3;

function placeOf(request: Request, locals: any): string {
  let g: any = locals?.netlify?.context?.geo;
  if (!g) {
    try {
      g = JSON.parse(Buffer.from(request.headers.get('x-nf-geo') || '', 'base64').toString('utf8'));
    } catch {
      g = null;
    }
  }
  const co = String(g?.country?.code || request.headers.get('x-country') || '').toUpperCase().slice(0, 2);
  const reg = String(g?.subdivision?.code || '').toUpperCase().slice(0, 3);
  const city = String(g?.city || '').slice(0, 60);
  if (!co) return '';
  const where = co === 'CA' || co === 'US' ? reg || co : co;
  return city ? `${city}, ${where}` : where;
}

export const POST: APIRoute = async ({ request, locals }) => {
  const ok = new Response(null, { status: 204 });
  if (BOT_UA.test(request.headers.get('user-agent') || '')) return ok;
  const place = placeOf(request, locals);
  if (EXCLUDED_COUNTRIES.has(place.slice(-2))) return ok;
  const raw = await request.text();
  if (raw.length > 4000) return ok;
  let b: any;
  try {
    b = JSON.parse(raw);
  } catch {
    return ok;
  }
  if (typeof b?.p !== 'string' || !b.p.startsWith('/') || b.p.length > 200 || b.p.startsWith('/admin')) return ok;

  let contactId = '';
  let via = '';
  try {
    if (/^[a-z0-9]{16,32}$/.test(String(b.bt || ''))) {
      const link = (await getStore('lead-browsers').get(b.bt, { type: 'json' })) as { contactId: string; at: string } | null;
      if (link?.contactId) {
        if (Date.now() - new Date(link.at).getTime() < SAME_VISIT_HOURS * 3600000) return ok;
        contactId = link.contactId;
        via = 'form';
      }
    }
    if (!contactId && /^[A-Za-z0-9]{15,40}$/.test(String(b.lid || ''))) {
      contactId = b.lid;
      via = 'email';
    }
    if (!contactId) return ok;

    const at = new Date().toISOString();
    const q = b.q && typeof b.q === 'object'
      ? Object.fromEntries(['area', 'minPrice', 'maxPrice', 'types', 'minBeds', 'minBaths']
          .filter((k) => typeof b.q[k] === 'string').map((k) => [k, b.q[k].slice(0, 60)]))
      : null;
    const record = { at, p: b.p.split('?')[0], ti: String(b.ti || '').slice(0, 120), q, place, via };
    await getStore('lead-activity').setJSON(`${contactId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, record);
  } catch (err) {
    console.error('lead-back: store failed', err instanceof Error ? err.message : err);
  }
  return ok;
};
