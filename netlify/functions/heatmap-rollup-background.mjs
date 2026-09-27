// Hourly -- folds the in-house heatmap's raw beacons (heatmap-raw, written
// by src/pages/api/hm.ts) into one summary per week and device
// (heatmap-weeks/<monday>/<d|m>), then deletes the raw beacons it used.
// The viewer (src/pages/admin/heatmap.astro) only ever reads the summaries,
// so it stays fast however much traffic comes in, and is at most an hour
// behind.
//
// Per page, a week summary holds: views, visible seconds, click points
// (x, y, and the page width they were recorded at, capped), click counts by
// label, seconds on screen per 100px band (attention), and how far each view
// got (scroll depth).

import { getStore } from '@netlify/blobs';

const MAX_RAW_PER_RUN = 20000;
const MAX_CLICK_POINTS = 5000; // per page per week per device
const KEEP_WEEKS = 26;
const BAND = 100;

// Monday (Toronto) of the week an ISO timestamp falls in, as YYYY-MM-DD.
function weekOf(iso) {
  const local = new Date(new Date(iso).toLocaleString('en-US', { timeZone: 'America/Toronto' }));
  const day = (local.getDay() + 6) % 7; // Mon=0
  const monday = new Date(Date.UTC(local.getFullYear(), local.getMonth(), local.getDate() - day));
  return monday.toISOString().slice(0, 10);
}

function emptyPage() {
  return { views: 0, secs: 0, clicks: [], labels: {}, bands: {}, depth: {}, heightSum: 0, heightN: 0 };
}

export default async () => {
  const raw = getStore('heatmap-raw');
  const weeks = getStore('heatmap-weeks');

  const { blobs } = await raw.list();
  const keys = blobs.map((b) => b.key).sort().slice(0, MAX_RAW_PER_RUN);
  if (keys.length === 0) return new Response('heatmap-rollup: nothing new');

  // Load week docs lazily, write them all back at the end.
  const docs = new Map();
  const docFor = async (docKey) => {
    if (!docs.has(docKey)) docs.set(docKey, (await weeks.get(docKey, { type: 'json' }).catch(() => null)) || { pages: {} });
    return docs.get(docKey);
  };

  // One view can send several beacons (tab switches) -- keep its deepest scroll once.
  const depthByView = new Map();
  const used = [];
  for (const key of keys) {
    const r = await raw.get(key, { type: 'json' }).catch(() => null);
    used.push(key);
    if (!r || !r.p || !r.d) continue;
    const doc = await docFor(`${weekOf(r.at)}/${r.d}`);
    const page = (doc.pages[r.p] ||= emptyPage());

    if (r.ex) page.example = r.ex;
    page.views += r.v === 1 ? 1 : 0;
    page.secs += r.t || 0;
    if (r.h) { page.heightSum += r.h; page.heightN += 1; }
    for (const [x, y, label] of r.c || []) {
      if (page.clicks.length < MAX_CLICK_POINTS) page.clicks.push([x, y, r.w]);
      else page.clicks[Math.floor(Math.random() * MAX_CLICK_POINTS)] = [x, y, r.w]; // keep a fair sample
      const l = label || '(not a link)';
      page.labels[l] = (page.labels[l] || 0) + 1;
    }
    for (const [band, secs] of Object.entries(r.a || {})) page.bands[band] = (page.bands[band] || 0) + secs;

    const viewKey = `${r.d}|${r.p}|${r.id || key}`;
    const prev = depthByView.get(viewKey);
    if (!prev || r.s > prev.s) depthByView.set(viewKey, { s: r.s, page });
  }
  for (const { s, page } of depthByView.values()) {
    const band = Math.floor(s / BAND);
    page.depth[band] = (page.depth[band] || 0) + 1;
  }

  for (const [docKey, doc] of docs) {
    doc.updatedAt = new Date().toISOString();
    await weeks.setJSON(docKey, doc);
  }
  for (const key of used) await raw.delete(key).catch(() => {});

  // Drop summaries older than KEEP_WEEKS.
  const cutoff = new Date(Date.now() - KEEP_WEEKS * 7 * 86400000).toISOString().slice(0, 10);
  const { blobs: weekBlobs } = await weeks.list();
  for (const b of weekBlobs) if (b.key.slice(0, 10) < cutoff) await weeks.delete(b.key).catch(() => {});

  const summary = `heatmap-rollup: ${used.length} beacons into ${docs.size} week summaries`;
  console.log(summary);
  return new Response(summary);
};

export const config = {
  schedule: '5 * * * *', // hourly
};
