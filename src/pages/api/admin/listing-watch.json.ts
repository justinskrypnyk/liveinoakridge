// Backs /admin/my-listings/ (weekly competition reports for Justin's own
// listings, 2026-10-12). Gated by ?key=HEATMAP_KEY like the other admin APIs.
//   GET                                  -> ticked listings + every active/conditional Chapman listing
//   POST {action:'save', listings:[{k, seller}]}
//   POST {action:'preview', k}           -> that listing's report HTML, nothing sent or saved
//   POST {action:'send', k?}             -> email the report(s) to Justin now and save state
// Report logic: src/lib/listing-watch.mjs (shared with the Tuesday job).
import type { APIRoute } from 'astro';
import { getStore } from '@netlify/blobs';
import { runListingWatch } from '@/lib/listing-watch.mjs';

export const prerender = false;

type Row = { k: string; a: string; lp: number | null; st: 'A' | 'C' | 'S'; ld: string | null; off: string | null };
type Watched = { k: string; a: string; seller: string; addedAt: string };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });

function authorized(url: URL) {
  const expected = import.meta.env.HEATMAP_KEY;
  return Boolean(expected) && url.searchParams.get('key') === expected;
}

async function loadList(): Promise<Watched[]> {
  const doc = (await getStore('listing-watch').get('list', { type: 'json' }).catch(() => null)) as { listings?: Watched[] } | null;
  return doc?.listings || [];
}

async function chapmanRows(): Promise<Row[]> {
  const index = (await getStore('comps-index').get('latest', { type: 'json' })) as { rows: Row[] } | null;
  return (index?.rows || []).filter((r) => r.st !== 'S' && /chapman/i.test(r.off || ''));
}

export const GET: APIRoute = async ({ url }) => {
  if (!authorized(url)) return json({ error: 'Not found' }, 404);
  const [listings, chapman] = await Promise.all([loadList(), chapmanRows()]);
  return json({ listings, chapman: chapman.map(({ k, a, lp, st, ld }) => ({ k, a, lp, st, ld })) });
};

export const POST: APIRoute = async ({ url, request }) => {
  if (!authorized(url)) return json({ error: 'Not found' }, 404);
  const body = (await request.json().catch(() => null)) as { action?: string; k?: string; listings?: { k: string; seller?: string }[] } | null;
  if (!body?.action) return json({ error: 'Missing action' }, 400);

  if (body.action === 'save') {
    const chapman = new Map((await chapmanRows()).map((r) => [r.k, r]));
    const before = new Map((await loadList()).map((w) => [w.k, w]));
    const now = new Date().toISOString();
    const listings: Watched[] = [];
    for (const item of body.listings || []) {
      const k = String(item.k || '');
      const known = chapman.get(k) || before.get(k);
      if (!known) continue; // only Chapman listings from the index, or ones already ticked
      listings.push({ k, a: known.a, seller: String(item.seller || '').trim().slice(0, 40), addedAt: before.get(k)?.addedAt || now });
    }
    await getStore('listing-watch').setJSON('list', { listings });
    return json({ ok: true, listings });
  }

  if (body.action === 'preview' || body.action === 'send') {
    try {
      const out = await runListingWatch({ getStore, only: body.k || null, dryRun: body.action === 'preview' });
      return json(out);
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
  }
  return json({ error: 'Unknown action' }, 400);
};
