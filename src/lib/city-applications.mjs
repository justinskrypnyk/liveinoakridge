// City of London planning applications inside our 7 areas (Justin, 2026-10-15).
//
// Source is the City's own public map server, the same one the comps finder's
// zoning/heritage layers use -- no scraping of anything that blocks bots:
//   Planning_Application_Sites/MapServer   one layer per application type, each
//                                          record = file number + boundary + dates
//   london.ca planning-applications pages  plain-English "What is proposed?" for
//                                          the bigger files (rezonings, OPAs);
//                                          matched to map records by file number
//   Addresses/MapServer/0                  street address for files with no page
//                                          (site plans, subdivisions, condos)
//
// Building permits are NOT here: London only publishes quarterly city-wide
// totals, never per-address permits (checked 2026-10-15). Committee of
// Adjustment files (minor variances, severances) are on the map but sparsely --
// the City stopped mapping most of them after 2024.
//
// Blobs (store `city-applications`):
//   seen    { [key]: { edited, status } } for every in-area file at the last run
//   pages   { [slug]: { files, title, proposed, fetchedAt } } london.ca page cache
import areaBoundaries from '../data/area-boundaries.json' with { type: 'json' };

const MAP = 'https://maps.london.ca/server/rest/services';
const CITY_PAGES = 'https://london.ca/business-development/planning-development-applications/planning-applications';
const UA = { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LiveInOakridge planning alerts)' } };
const PAGE_REFRESH_MS = 7 * 24 * 3600 * 1000;
const BASELINE_DAYS = 365;

export const OUR_AREAS = ['oakridge', 'west-london', 'whitehills', 'byron', 'westmount', 'riverbend', 'lambeth'];

const areas = areaBoundaries.features
  .filter((f) => OUR_AREAS.includes(f.properties.slug))
  .map((f) => ({ slug: f.properties.slug, name: f.properties.name, ring: f.geometry.coordinates[0] }));

// Layer id -> what the application type means, in Justin's words for clients.
export const LAYERS = {
  27: { type: 'Subdivision', what: 'New subdivision: land being divided into new streets and lots.' },
  28: { type: 'Condominium', what: 'New condo plan: a site being set up as condo units.' },
  29: { type: 'Site Plan', what: 'Detailed design for a new building or addition (usually townhomes, apartments or commercial).' },
  30: { type: 'Rezoning', what: 'The owner wants to change what is allowed to be built here.' },
  31: { type: 'Official Plan + Rezoning', what: 'A bigger change: the long-term land-use plan and the zoning both need to change.' },
  32: { type: 'Official Plan Amendment', what: 'A change to the long-term land-use plan for this site.' },
  33: { type: 'Minor Variance', what: 'A small exception to the zoning rules (setbacks, height, an extra unit).' },
  34: { type: 'Severance (Consent)', what: 'An owner wants to split one lot into two or more.' },
  35: { type: 'Removal of Holding', what: 'The final zoning green light: building can start once this clears.' },
  36: { type: 'Part Lot Control', what: 'Townhouse or semi lots being split for sale, often means new homes hitting the market soon.' },
};

const STATUS_WORDS = { DA: 'Draft approved', UR: 'Under review', R: 'Registered', REG: 'Registered' };

function pointInRing(lat, lng, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

async function getJson(url) {
  const res = await fetch(url, UA);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const d = await res.json();
  if (d.error) throw new Error(`ArcGIS error for ${url}: ${JSON.stringify(d.error)}`);
  return d;
}

const isoDay = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : null);

/** Every application on the City map whose centre falls inside one of our 7 areas. */
export async function fetchAreaApplications() {
  const byKey = new Map();
  let cityTotal = 0;
  for (const [layerId, info] of Object.entries(LAYERS)) {
    const d = await getJson(
      `${MAP}/Planning_Application_Sites/MapServer/${layerId}/query?` +
        new URLSearchParams({ where: '1=1', outFields: '*', returnGeometry: 'true', outSR: '4326', f: 'json' })
    );
    cityTotal += d.features.length;
    for (const f of d.features) {
      // Joined layers prefix fields with the table name; keep the last segment.
      const a = Object.fromEntries(Object.entries(f.attributes).map(([k, v]) => [k.split('.').pop(), v]));
      const rings = f.geometry?.rings;
      if (!a.FileNumber || !rings?.length) continue;
      const pts = rings.flat();
      const lng = pts.reduce((s, p) => s + p[0], 0) / pts.length;
      const lat = pts.reduce((s, p) => s + p[1], 0) / pts.length;
      const area = areas.find((ar) => pointInRing(lat, lng, ar.ring));
      if (!area) continue;
      const file = a.FileNumber.trim();
      const key = `${layerId}:${a.FileNumber_Phase || file}`;
      const app = {
        key,
        layerId: Number(layerId),
        type: info.type,
        what: info.what,
        file,
        phase: a.Phase || null,
        yearOpened: a.YearOpened || null,
        edited: isoDay(a.LastEditDate),
        registered: isoDay(a.RegisteredDate),
        status: a.Status ? STATUS_WORDS[a.Status.trim()] ?? titleCase(a.Status) : null,
        statusCode: a.StatusCode ?? null,
        area: area.slug,
        areaName: area.name,
        lat,
        lng,
        rings,
      };
      // The same file can be drawn more than once; keep the most recently edited.
      const prev = byKey.get(key);
      if (!prev || (app.edited || '') > (prev.edited || '')) byKey.set(key, app);
    }
  }
  if (cityTotal === 0) throw new Error('City map returned 0 applications city-wide -- service changed or down');
  return { apps: [...byKey.values()], cityTotal };
}

function titleCase(s) {
  return String(s).toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function pageText(html) {
  const main = html.match(/<main[\s\S]*?<\/main>/)?.[0] ?? html;
  return main
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#0?39;|&rsquo;/g, "'")
    .replace(/&[a-z]+;|&#\d+;/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

/**
 * london.ca's application pages, keyed by file number. Pages are cached in the
 * blob and only re-read weekly, so a normal day costs ~7 list-page requests.
 */
export async function fetchCityPages(cache = {}) {
  const slugs = new Set();
  for (let p = 0; p < 50; p++) {
    const res = await fetch(`${CITY_PAGES}?page=${p}`, UA);
    if (!res.ok) break;
    const html = await res.text();
    const before = slugs.size;
    for (const m of html.matchAll(/planning-applications\/([a-z0-9-]+)"/g)) {
      if (m[1] !== 'neighbourhood-planning') slugs.add(m[1]);
    }
    if (slugs.size === before) break;
  }
  const now = Date.now();
  const pages = {};
  for (const slug of slugs) {
    const hit = cache[slug];
    if (hit && now - hit.fetchedAt < PAGE_REFRESH_MS) {
      pages[slug] = hit;
      continue;
    }
    try {
      const res = await fetch(`${CITY_PAGES}/${slug}`, UA);
      if (!res.ok) continue;
      const html = await res.text();
      const lines = pageText(html);
      const start = lines.findIndex((l) => /^What is proposed\??$/i.test(l));
      const end = lines.findIndex((l, i) => i > start && /^Notices? of|^Applicant|^Staff Planning|^Council/i.test(l));
      const files = [...new Set([...html.matchAll(/\b((?:OZ|MZ|TZ|Z|SPA|O|39T|39CD|P)-\d{3,5}(?:-\d+)?)\b/g)].map((m) => m[1]))];
      pages[slug] = {
        files,
        title: lines[0] || slug,
        proposed: start === -1 ? '' : lines.slice(start + 1, end === -1 ? start + 8 : end).join(' ').replace(/\s*•\s*/g, ' • ').trim(),
        fetchedAt: now,
      };
    } catch (err) {
      console.warn('city-applications: page fetch failed', slug, err.message);
      if (hit) pages[slug] = hit;
    }
  }
  return pages;
}

/** Street address inside the application boundary, or "near <closest>" for raw land. */
export async function lookupAddress(app) {
  const pts = app.rings.flat();
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const pad = 0.002; // ~200 m, so raw land with no addresses of its own still finds a neighbour
  const env = [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad].join(',');
  const d = await getJson(
    `${MAP}/Addresses/MapServer/0/query?` +
      new URLSearchParams({
        geometry: env,
        geometryType: 'esriGeometryEnvelope',
        inSR: '4326',
        outSR: '4326',
        outFields: 'MunicipalNumberDisplay,StreetName,StreetType,StreetDirection,UnitNumber',
        returnGeometry: 'true',
        f: 'json',
      })
  );
  const found = d.features
    .filter((f) => !String(f.attributes.UnitNumber || '').trim())
    .map((f) => {
      const x = f.attributes;
      return {
        label: [x.MunicipalNumberDisplay, x.StreetName, x.StreetType, x.StreetDirection].filter((v) => String(v || '').trim()).join(' '),
        inside: app.rings.some((r) => pointInRing(f.geometry.y, f.geometry.x, r)),
        dist: Math.hypot(f.geometry.x - app.lng, f.geometry.y - app.lat),
      };
    })
    .sort((a, b) => b.inside - a.inside || a.dist - b.dist);
  if (!found.length) return null;
  if (!found[0].inside) return `near ${found[0].label}`;
  const inside = found.filter((f) => f.inside).map((f) => f.label);
  return inside.length > 2 ? `${inside[0]} (+${inside.length - 1} more addresses)` : inside.join(' & ');
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function card(app) {
  const maps = `https://www.google.com/maps/search/?api=1&query=${app.lat.toFixed(6)},${app.lng.toFixed(6)}`;
  const meta = [
    app.areaName,
    `File ${app.file}${app.phase ? `, phase ${app.phase}` : ''}`,
    app.yearOpened && `opened ${app.yearOpened}`,
    app.status,
    app.edited && `City last updated ${app.edited}`,
  ].filter(Boolean);
  return `<div style="border:1px solid #e3e1db;border-radius:8px;padding:14px 16px;margin:0 0 12px">
  <div style="font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:#7a6f5c">${esc(app.type)}</div>
  <div style="font-size:17px;font-weight:600;margin:2px 0 6px">${esc(app.address || app.pageTitle || 'Address not listed')}</div>
  <div style="font-size:13px;color:#555;margin-bottom:8px">${esc(meta.join(' · '))}</div>
  ${app.proposed ? `<div style="font-size:14px;margin-bottom:6px"><b>Proposed:</b> ${esc(app.proposed)}</div>` : ''}
  <div style="font-size:13px;color:#555;margin-bottom:8px">${esc(app.what)}</div>
  <div style="font-size:13px">${app.pageUrl ? `<a href="${esc(app.pageUrl)}">City page + documents</a> · ` : ''}<a href="${maps}">Map</a></div>
</div>`;
}

export function buildEmail({ fresh, updated, baseline }) {
  const total = fresh.length + updated.length;
  const subject = baseline
    ? `City planning files in your 7 areas: ${total} active in the last year`
    : `City planning: ${fresh.length ? `${fresh.length} new` : ''}${fresh.length && updated.length ? ', ' : ''}${updated.length ? `${updated.length} updated` : ''} in your areas`;
  const section = (title, list) =>
    list.length ? `<h2 style="font-size:18px;margin:22px 0 10px">${title}</h2>${list.map(card).join('')}` : '';
  const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:640px;margin:0 auto;color:#222">
  <p style="font-size:15px">${
    baseline
      ? 'Starting list: every City of London planning file inside Oakridge, West London, Whitehills, Byron, Westmount, Riverbend and Lambeth that the City touched in the last 12 months. From now on you only get an email when something is new or changes.'
      : 'New or changed City of London planning files inside your 7 areas since yesterday.'
  }</p>
  ${baseline ? section('Active files', fresh) : section('New applications', fresh) + section('Updated by the City', updated)}
  <p style="font-size:12px;color:#888;margin-top:24px">Source: City of London planning map + london.ca application pages. "Updated" means the City edited the file (a new report, status or boundary), so open the City page to see what changed. Building permits aren't published by address, so they can't be tracked.</p>
</div>`;
  return { subject, html };
}

async function sendEmail(to, subject, html) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'Live In Oakridge Alerts <reports@mail.liveinoakridge.ca>', to: [to], subject, html }),
  });
  if (!res.ok) throw new Error(`Resend HTTP ${res.status}: ${await res.text().catch(() => '')}`);
}

/**
 * Compare today's in-area files with the last run and email what's new or
 * changed. First run (no `seen` blob) sends a one-time starting list instead.
 * State is saved only after the email goes out, so a failed send retries tomorrow.
 */
export async function runCityApplications({ getStore, dryRun = false, to = process.env.DIGEST_TO_EMAIL || 'info@homeswithjustin.ca' }) {
  const store = getStore('city-applications');
  const seen = (await store.get('seen', { type: 'json' })) || null;
  const pageCache = (await store.get('pages', { type: 'json' })) || {};

  const { apps, cityTotal } = await fetchAreaApplications();
  const pages = await fetchCityPages(pageCache);
  const pageByFile = {};
  for (const [slug, p] of Object.entries(pages)) for (const f of p.files) pageByFile[f] ??= { slug, ...p };

  const baseline = !seen;
  const cutoff = new Date(Date.now() - BASELINE_DAYS * 86400000).toISOString().slice(0, 10);
  const fresh = [];
  const updated = [];
  for (const app of apps) {
    const before = seen?.[app.key];
    if (baseline) {
      if ((app.edited || '') >= cutoff) fresh.push(app);
    } else if (!before) fresh.push(app);
    else if (before.edited !== app.edited || before.status !== (app.status ?? app.statusCode)) updated.push(app);
  }

  for (const app of [...fresh, ...updated]) {
    const page = pageByFile[app.file];
    if (page) {
      app.pageUrl = `${CITY_PAGES}/${page.slug}`;
      app.pageTitle = page.title;
      app.proposed = page.proposed;
    }
    try {
      app.address = page?.title && /^\d/.test(page.title) ? page.title : await lookupAddress(app);
    } catch (err) {
      console.warn('city-applications: address lookup failed', app.file, err.message);
    }
  }
  const newestFirst = (a, b) => (b.edited || '').localeCompare(a.edited || '');
  fresh.sort(newestFirst);
  updated.sort(newestFirst);

  const result = { cityTotal, inArea: apps.length, fresh: fresh.length, updated: updated.length, baseline };
  let email = null;
  if (fresh.length || updated.length) {
    email = buildEmail({ fresh, updated, baseline });
    if (!dryRun) await sendEmail(to, email.subject, email.html);
  }
  if (!dryRun) {
    await store.setJSON('seen', Object.fromEntries(apps.map((a) => [a.key, { edited: a.edited, status: a.status ?? a.statusCode }])));
    await store.setJSON('pages', pages);
  }
  return { ...result, email };
}
