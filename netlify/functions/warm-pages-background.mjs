// Loads the CDN-cached server-rendered pages (src/lib/cdn-cache.ts) once
// right after each production deploy, because a deploy clears Netlify's
// cache and the first visitor to each page would otherwise wait on a cold
// function: up to ~7s on area pages (measured 2026-10-06). Started by
// deploy-succeeded.mjs. Only plain public GETs, so it's harmless if anyone
// else triggers it.
//
// Listing pages (/search/<key>/) are too many to load here; they're the
// ~2-3s case. Keep AREA_SLUGS in step with the served areas in
// src/data/areas.ts (deprecated ones 301 and need no warming).
const SITE = 'https://www.liveinoakridge.ca';
const AREA_SLUGS = ['oakridge', 'west-london', 'whitehills', 'byron', 'westmount', 'riverbend', 'lambeth'];
const PATHS = [...AREA_SLUGS.map((s) => `/areas/${s}/`), '/properties/', '/market-map/', '/market-faq/'];

async function warm(path) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const started = Date.now();
    try {
      const res = await fetch(SITE + path, { signal: AbortSignal.timeout(60000), headers: { 'User-Agent': 'liveinoakridge-cache-warmer' } });
      await res.arrayBuffer();
      const cache = res.headers.get('cache-status') || '';
      if (res.ok) return `${path} ${res.status} ${Date.now() - started}ms ${cache.includes('hit') ? 'hit' : 'stored'}`;
      if (attempt === 3) return `${path} FAILED HTTP ${res.status}`;
    } catch (err) {
      if (attempt === 3) return `${path} FAILED ${err instanceof Error ? err.message : err}`;
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
}

export default async () => {
  // Oakridge first and alone: it pulls the MLS listings into the function's
  // memory, so the area pages after it render fast instead of each pulling
  // them in parallel.
  const results = [await warm(PATHS[0])];
  for (let i = 1; i < PATHS.length; i += 3) results.push(...(await Promise.all(PATHS.slice(i, i + 3).map(warm))));
  console.log(`warm-pages: ${results.join(' | ')}`);
  return new Response('ok');
};
