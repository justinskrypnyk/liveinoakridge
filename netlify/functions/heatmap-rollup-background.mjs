// Hourly -- folds the in-house heatmap's raw beacons (heatmap-raw, written
// by src/pages/api/hm.ts) into one summary per week and device
// (heatmap-weeks/<monday>/<d|m>), then deletes the raw beacons it used.
// The viewer (src/pages/admin/heatmap.astro) only ever reads the summaries,
// so it stays fast however much traffic comes in, and is at most an hour
// behind.
//
// Per page, a week summary holds: views, visible seconds, click points
// (x, y, and the page width they were recorded at, capped), click counts by
// label, seconds on screen per 100px band (attention), how far each view
// got (scroll depth), and a sample of real-world speed readings (perf).

import { getStore } from '@netlify/blobs';

const MAX_RAW_PER_RUN = 20000;
const MAX_CLICK_POINTS = 5000; // per page per week per device
const MAX_PERF_SAMPLES = 500; // speed readings kept per page per week per device
const KEEP_WEEKS = 26;
const BAND = 100;
// Visitor sessions (2026-09-28): one doc per Toronto day in heatmap-sessions,
// listing each anonymous visit's pages in order, for admin/sessions.astro.
const KEEP_SESSION_DAYS = 60;
const MAX_SESSIONS_PER_DAY = 3000;
const MAX_VIEWS_PER_SESSION = 100;
const MAX_CLICKS_PER_VIEW = 40;

const torontoDay = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });

// Monday (Toronto) of the week an ISO timestamp falls in, as YYYY-MM-DD.
function weekOf(iso) {
  const local = new Date(new Date(iso).toLocaleString('en-US', { timeZone: 'America/Toronto' }));
  const day = (local.getDay() + 6) % 7; // Mon=0
  const monday = new Date(Date.UTC(local.getFullYear(), local.getMonth(), local.getDate() - day));
  return monday.toISOString().slice(0, 10);
}

function emptyPage() {
  return { views: 0, secs: 0, clicks: [], labels: {}, bands: {}, depth: {}, heightSum: 0, heightN: 0, places: {} };
}

// Buyer-demand labels for a /search filter set.
const k50 = (n) => `$${Math.round(Number(n) / 1000)}K`;
function priceBand(q) {
  const lo = Number(q.minPrice) || 0, hi = Number(q.maxPrice) || 0;
  if (lo && hi) return `${k50(lo)}–${k50(hi)}`;
  if (hi) return `Under ${k50(hi)}`;
  if (lo) return `${k50(lo)}+`;
  return null;
}
const titleCase = (s) => String(s).replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

function emptySite() {
  return {
    searches: 0, areas: {}, prices: {}, beds: {}, types: {}, combos: {},
    forms: {}, // formName -> { started, sent, lastField: { field: abandons } }
  };
}

// "London, ON", "Toronto, ON", "Calgary, AB", "Detroit, MI", "Manila, PH"
function placeOf(g) {
  if (!g || !g.co) return 'Unknown';
  const where = g.co === 'CA' || g.co === 'US' ? (g.reg || g.co) : g.co;
  return g.city ? `${g.city}, ${where}` : `(somewhere in) ${where}`;
}

export default async () => {
  const raw = getStore('heatmap-raw');
  const weeks = getStore('heatmap-weeks');
  const sessionStore = getStore('heatmap-sessions');

  const { blobs } = await raw.list();
  const keys = blobs.map((b) => b.key).sort().slice(0, MAX_RAW_PER_RUN);
  if (keys.length === 0) return new Response('heatmap-rollup: nothing new');

  // Load week docs lazily, write them all back at the end.
  const docs = new Map();
  const docFor = async (docKey) => {
    if (!docs.has(docKey)) docs.set(docKey, (await weeks.get(docKey, { type: 'json' }).catch(() => null)) || { pages: {} });
    return docs.get(docKey);
  };

  const dayDocs = new Map();
  const dayDoc = async (day) => {
    if (!dayDocs.has(day)) dayDocs.set(day, (await sessionStore.get(day, { type: 'json' }).catch(() => null)) || { sessions: {} });
    return dayDocs.get(day);
  };

  // One view can send several beacons (tab switches) -- keep its deepest scroll once.
  const depthByView = new Map();
  const formsByView = new Map(); // viewKey -> { site, forms: { name: { s, l } } }
  const used = [];
  for (const key of keys) {
    const r = await raw.get(key, { type: 'json' }).catch(() => null);
    used.push(key);
    if (!r || !r.p || !r.d) continue;
    const doc = await docFor(`${weekOf(r.at)}/${r.d}`);
    const page = (doc.pages[r.p] ||= emptyPage());

    if (r.ex) page.example = r.ex;
    page.views += r.v === 1 ? 1 : 0;
    if (r.v === 1) {
      page.places ||= {};
      const place = placeOf(r.g);
      page.places[place] = (page.places[place] || 0) + 1;
    }
    page.secs += r.t || 0;
    if (r.h) { page.heightSum += r.h; page.heightN += 1; }
    if (r.pf) {
      // Real-world speed samples, one per view: LCP ms, INP ms, CLS score.
      page.perf ||= { l: [], i: [], c: [] };
      for (const [k, v] of [['l', r.pf.l], ['i', r.pf.i], ['c', r.pf.c]]) {
        if (page.perf[k].length < MAX_PERF_SAMPLES) page.perf[k].push(v);
        else page.perf[k][Math.floor(Math.random() * MAX_PERF_SAMPLES)] = v;
      }
    }
    for (const [x, y, label] of r.c || []) {
      if (page.clicks.length < MAX_CLICK_POINTS) page.clicks.push([x, y, r.w]);
      else page.clicks[Math.floor(Math.random() * MAX_CLICK_POINTS)] = [x, y, r.w]; // keep a fair sample
      const l = label || '(not a link)';
      page.labels[l] = (page.labels[l] || 0) + 1;
    }
    for (const [band, secs] of Object.entries(r.a || {})) page.bands[band] = (page.bands[band] || 0) + secs;

    const viewKey = `${r.d}|${r.p}|${r.id || key}`;

    // Site-wide, both devices: buyer search demand and form drop-off.
    const site = ((await docFor(`${weekOf(r.at)}/site`)).site ||= emptySite());
    // Page views per Toronto day -- site-health compares yesterday's count with GA4.
    if (r.v === 1) {
      const day = new Date(r.at).toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
      site.daily ||= {};
      site.daily[day] = (site.daily[day] || 0) + 1;
    }
    if (r.q) {
      const q = r.q;
      site.searches += 1;
      const area = q.area ? titleCase(q.area) : 'All areas';
      const price = priceBand(q);
      const beds = q.minBeds ? `${q.minBeds}+ bed` : null;
      site.areas[area] = (site.areas[area] || 0) + 1;
      if (price) site.prices[price] = (site.prices[price] || 0) + 1;
      if (beds) site.beds[beds] = (site.beds[beds] || 0) + 1;
      for (const t of String(q.types || '').split(',').filter(Boolean)) site.types[titleCase(t)] = (site.types[titleCase(t)] || 0) + 1;
      const combo = [area, beds, price].filter(Boolean).join(' · ');
      site.combos[combo] = (site.combos[combo] || 0) + 1;
    }
    if (r.f && Object.keys(r.f).length) {
      const prevForms = formsByView.get(viewKey)?.forms || {};
      for (const [name, st] of Object.entries(r.f)) {
        const p = prevForms[name] || { s: 0, l: '' };
        prevForms[name] = { s: p.s || st.s, l: st.l || p.l };
      }
      formsByView.set(viewKey, { site, forms: prevForms });
    }
    const prev = depthByView.get(viewKey);
    if (!prev || r.s > prev.s) depthByView.set(viewKey, { s: r.s, page });

    // Visitor sessions. Beacons from before the visit id existed become a
    // one-page visit each.
    const opened = r.opened || r.at;
    const day = await dayDoc(torontoDay(opened));
    const sid = r.sid || `v${r.id || key.slice(-8)}`;
    let sess = day.sessions[sid];
    if (!sess) {
      if (Object.keys(day.sessions).length >= MAX_SESSIONS_PER_DAY) continue;
      sess = day.sessions[sid] = { place: placeOf(r.g), d: r.d, ref: '', camp: '', views: [] };
    }
    if (!sess.ref && r.r) sess.ref = r.r;
    if (!sess.camp && r.u) sess.camp = r.u;
    const viewId = r.id || key;
    let v = sess.views.find((x) => x.id === viewId);
    if (!v) {
      if (sess.views.length >= MAX_VIEWS_PER_SESSION) continue;
      v = { id: viewId, at: opened, p: r.ex || r.p, ti: '', secs: 0, depth: 0, h: 0, clicks: [], forms: {}, q: null };
      sess.views.push(v);
    }
    if (opened < v.at) v.at = opened;
    if (r.ti) v.ti = r.ti;
    v.secs += r.t || 0;
    if (r.h) v.h = r.h;
    if (r.s > v.depth) v.depth = r.s;
    for (const [, , label, t] of r.c || []) {
      if (v.clicks.length < MAX_CLICKS_PER_VIEW) v.clicks.push([label || '(not a link)', Number.isFinite(t) ? t : null]);
    }
    for (const [name, st] of Object.entries(r.f || {})) {
      const p = v.forms[name] || { s: 0, l: '' };
      v.forms[name] = { s: p.s || st.s, l: st.l || p.l };
    }
    if (r.q) v.q = r.q;
  }
  for (const { site, forms } of formsByView.values()) {
    for (const [name, st] of Object.entries(forms)) {
      const f = (site.forms[name] ||= { started: 0, sent: 0, lastField: {} });
      f.started += 1;
      if (st.s) f.sent += 1;
      else if (st.l) f.lastField[st.l] = (f.lastField[st.l] || 0) + 1;
    }
  }
  for (const { s, page } of depthByView.values()) {
    const band = Math.floor(s / BAND);
    page.depth[band] = (page.depth[band] || 0) + 1;
  }

  for (const [docKey, doc] of docs) {
    doc.updatedAt = new Date().toISOString();
    await weeks.setJSON(docKey, doc);
  }
  for (const [day, doc] of dayDocs) {
    for (const s of Object.values(doc.sessions)) s.views.sort((a, b) => a.at.localeCompare(b.at));
    doc.updatedAt = new Date().toISOString();
    await sessionStore.setJSON(day, doc);
  }
  for (const key of used) await raw.delete(key).catch(() => {});

  const dayCutoff = new Date(Date.now() - KEEP_SESSION_DAYS * 86400000).toISOString().slice(0, 10);
  const { blobs: dayBlobs } = await sessionStore.list();
  for (const b of dayBlobs) if (b.key < dayCutoff) await sessionStore.delete(b.key).catch(() => {});

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
